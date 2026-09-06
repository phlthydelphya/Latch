import { useEffect, useState, useCallback } from 'react';

export interface MediaDeviceInfoExtended extends MediaDeviceInfo {
  label: string;
}

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfoExtended[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setLoading(true);
      if (!navigator.mediaDevices?.enumerateDevices) {
        setError('Media devices are not supported in this browser');
        return;
      }

      // Check if devices already have labels (permission previously granted)
      let initialList: MediaDeviceInfo[] = [];
      try {
        initialList = await navigator.mediaDevices.enumerateDevices();
      } catch {}

      const hasLabels = initialList.some(
        (d) => (d.kind === 'audioinput' || d.kind === 'videoinput') && Boolean(d.label)
      );

      // Only request dummy stream if labels are missing and getUserMedia is available
      if (!hasLabels && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch (mediaErr) {
          // In Firefox / Windows, if camera is in use or fails to allocate, fallback to audio-only probe
          console.warn('[useMediaDevices] Video/audio probe failed, attempting audio-only probe:', mediaErr);
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStream.getTracks().forEach((t) => t.stop());
          } catch (audioErr) {
            console.warn('[useMediaDevices] Audio probe failed or access denied:', audioErr);
          }
        }
      }

      const deviceList = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        deviceList
          .filter((d): d is MediaDeviceInfoExtended => 
            d.kind === 'audioinput' || d.kind === 'videoinput'
          )
          .map((d) => ({
            ...d,
            label: d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${d.deviceId ? d.deviceId.slice(0, 8) : ''}`,
          }))
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enumerate devices');
    } finally {
      setLoading(false);
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

  return { devices, getUserMedia, error, loading, refreshDevices };
}