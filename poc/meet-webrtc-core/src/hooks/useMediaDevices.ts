import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { deriveAvailability } from '../devices/deriveAvailability';

export interface MediaDeviceInfoExtended extends MediaDeviceInfo {
  label: string;
}

function categorizeError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (!name) return 'unknown';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'permission-denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'not-found';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'not-readable';
  }
  if (name === 'TypeError' || name === 'NotSupportedError') {
    return 'unsupported';
  }
  return 'unknown';
}

export function useMediaDevices(
  activeStream: MediaStream | null = null,
  cameraError: DOMException | string | null = null,
  audioError: DOMException | string | null = null,
  videoEnabled: boolean = true,
  audioEnabled: boolean = true
) {
  const [devices, setDevices] = useState<MediaDeviceInfoExtended[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalAudioError, setInternalAudioError] = useState<DOMException | null>(null);
  const [internalVideoError, setInternalVideoError] = useState<DOMException | null>(null);
  const [audioPermissionGranted, setAudioPermissionGranted] = useState(false);
  const [videoPermissionGranted, setVideoPermissionGranted] = useState(false);
  const sequenceRef = useRef(0);

  const finalAudioError = audioError || internalAudioError;
  const finalCameraError = cameraError || internalVideoError;

  const refreshDevices = useCallback(async (requestPerms = false) => {
    const sequence = ++sequenceRef.current;
    const emit = (event: string, payload: Record<string, unknown>) => {
      console.info(`[MEDIA ENUM ${event}]`, payload);
    };

    emit('START', {
      sequence,
      requestPermissions: requestPerms,
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      mediaDevicesAvailable: Boolean(navigator.mediaDevices),
    });

    let exitReason: 'completed' | 'failed' = 'completed';

    try {
      setLoading(true);
      if (!navigator.mediaDevices?.enumerateDevices) {
        setError('Media devices are not supported in this browser');
        exitReason = 'failed';
        return;
      }

      // Provisional enumeration (before permission)
      let deviceList: MediaDeviceInfo[] = [];
      try {
        deviceList = await navigator.mediaDevices.enumerateDevices();
      } catch (err) {
        emit('ERROR', { sequence, category: categorizeError(err) });
        deviceList = [];
      }

      const rawCounts = {
        audioInputCount: deviceList.filter((d) => d.kind === 'audioinput').length,
        videoInputCount: deviceList.filter((d) => d.kind === 'videoinput').length,
        audioOutputCount: deviceList.filter((d) => d.kind === 'audiooutput').length,
      };

      emit('RAW', { sequence, ...rawCounts });

      // Request microphone and camera independently so each kind's outcome is captured
      if (requestPerms && navigator.mediaDevices.getUserMedia) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioStream.getTracks().forEach((t) => t.stop());
          setInternalAudioError(null);
          setAudioPermissionGranted(true);
        } catch (audioErr) {
          setInternalAudioError(audioErr as DOMException);
          setAudioPermissionGranted(false);
          emit('ERROR', { sequence, category: categorizeError(audioErr) });
        }

        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          videoStream.getTracks().forEach((t) => t.stop());
          setInternalVideoError(null);
          setVideoPermissionGranted(true);
        } catch (videoErr) {
          setInternalVideoError(videoErr as DOMException);
          setVideoPermissionGranted(false);
          emit('ERROR', { sequence, category: categorizeError(videoErr) });
        }

        // BHS-001C Fix A: snapshot before authorized enumeration to guard empty overwrite
        const preAuthDeviceList = [...deviceList];

        // Authorized enumeration (after permission)
        try {
          deviceList = await navigator.mediaDevices.enumerateDevices();
        } catch (err) {
          emit('ERROR', { sequence, category: categorizeError(err) });
          deviceList = [];
        }

        // BHS-001C Fix A: prevent valid list destroyed by empty authorized result
        if (deviceList.length === 0 && preAuthDeviceList.length > 0) {
          deviceList = preAuthDeviceList;
        }
      }

      const filtered = deviceList.filter((d): d is MediaDeviceInfoExtended =>
        d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput'
      );

      let camCount = 1;
      let micCount = 1;

      const formatted = filtered
        .map((d) => {
          let fallbackLabel = d.label;
          if (!fallbackLabel) {
            if (d.kind === 'audioinput') {
              fallbackLabel = micCount === 1 ? 'Default microphone' : `Microphone ${micCount}`;
              micCount++;
            } else if (d.kind === 'videoinput') {
              fallbackLabel = `Camera ${camCount++}`;
            } else if (d.kind === 'audiooutput') {
              fallbackLabel = 'System default output';
            }
          }
          return {
            ...d,
            deviceId: d.deviceId,
            groupId: d.groupId,
            kind: d.kind,
            label: fallbackLabel,
            toJSON: d.toJSON?.bind(d) ?? (() => ({ deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: fallbackLabel })),
          } as MediaDeviceInfoExtended;
        });

      const formattedCounts = {
        audioInputCount: formatted.filter((d) => d.kind === 'audioinput').length,
        videoInputCount: formatted.filter((d) => d.kind === 'videoinput').length,
        audioOutputCount: formatted.filter((d) => d.kind === 'audiooutput').length,
      };

      const staleAtCommit = sequence < sequenceRef.current;
      emit('COMMIT', {
        sequence,
        latestSequence: sequenceRef.current,
        staleAtCommit,
        requestPermissions: requestPerms,
        ...formattedCounts,
      });

      // BHS-001C Fix B: stale results must never update device state
      if (staleAtCommit) {
        return;
      }

      setDevices(formatted);
      setError(null);
    } catch (err) {
      exitReason = 'failed';
      emit('ERROR', { sequence, category: categorizeError(err) });
      setError(err instanceof Error ? err.message : 'Failed to enumerate devices');
    } finally {
      setLoading(false);
      emit('EXIT', { sequence, reason: exitReason });
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) {
      setLoading(false);
      setError('Media devices are not supported in this browser');
      return;
    }

    refreshDevices();

    const handleChange = () => refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleChange);
  }, [refreshDevices]);

  const getUserMedia = useCallback(async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices are not supported in this browser');
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  const supportsSinkId = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  const microphoneAvailability = useMemo(
    () => deriveAvailability('audioinput', devices, activeStream, finalAudioError, audioPermissionGranted, audioEnabled),
    [devices, activeStream, finalAudioError, audioPermissionGranted, audioEnabled]
  );

  const cameraAvailability = useMemo(
    () => deriveAvailability('videoinput', devices, activeStream, finalCameraError, videoPermissionGranted, videoEnabled),
    [devices, activeStream, finalCameraError, videoPermissionGranted, videoEnabled]
  );

  const speakerAvailability = useMemo(
    () => deriveAvailability('audiooutput', devices, activeStream, null),
    [devices, activeStream]
  );

  return {
    devices,
    getUserMedia,
    error,
    loading,
    refreshDevices,
    supportsSinkId,
    microphoneAvailability,
    cameraAvailability,
    speakerAvailability,
  };
}