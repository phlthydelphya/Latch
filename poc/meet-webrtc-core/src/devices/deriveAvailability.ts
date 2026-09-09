import { DeviceAvailability } from './deviceStore';

export function deriveAvailability(
  kind: 'audioinput' | 'videoinput' | 'audiooutput',
  devices: MediaDeviceInfo[],
  activeStream: MediaStream | null,
  lastError: DOMException | string | null,
  permissionGranted = false,
  enabled = true
): DeviceAvailability {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return 'unsupported';
  }

  // 1. Strongest signal: if we have a live track of the requested kind, it's available
  if (activeStream && (kind === 'audioinput' || kind === 'videoinput')) {
    const hasLiveTrack = activeStream.getTracks().some(
      (t) => t.readyState === 'live' && (kind === 'audioinput' ? t.kind === 'audio' : t.kind === 'video')
    );
    if (hasLiveTrack) {
      return 'available';
    }
  }

  // 2. Explicit error handling
  if (lastError) {
    const errorName = typeof lastError === 'string' ? lastError : lastError.name;
    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
      return 'denied';
    }
    if (errorName === 'NotFoundError' || errorName === 'NotReadableError') {
      return 'unavailable';
    }
    return 'error';
  }

  // 3. System default is always available for outputs even if enumeration is restricted
  if (kind === 'audiooutput') {
    return 'available';
  }

  // 4. Permission granted but user intentionally disabled → disabled (recoverable)
  if (permissionGranted && !enabled) {
    return 'disabled';
  }

  const hasDevice = devices.some((d) => d.kind === kind);

  // 5. Permission granted: the device is available even if labels are still empty
  if (permissionGranted && hasDevice) {
    return 'available';
  }

  if (!hasDevice) {
    return 'unavailable';
  }

  const hasLabels = devices.some((d) => d.kind === kind && d.label.trim().length > 0);

  if (!hasLabels) {
    return 'permission-required';
  }

  return 'available';
}
