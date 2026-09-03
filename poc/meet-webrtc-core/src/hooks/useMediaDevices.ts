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
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Media devices are not supported in this browser');
        return;
      }
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        deviceList
          .filter((d): d is MediaDeviceInfoExtended => 
            d.kind === 'audioinput' || d.kind === 'videoinput'
          )
          .map((d) => ({ ...d, label: d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${d.deviceId.slice(0, 8)}` }))
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