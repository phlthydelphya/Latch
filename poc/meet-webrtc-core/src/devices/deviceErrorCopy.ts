/**
 * Device error copy — unified, user-facing getUserMedia failure messaging.
 *
 * Consumed by PreJoinPage (per-device acquisition) and VideoPreviewTile
 * (in-meeting camera preview) so both surfaces show identical, actionable,
 * privacy-safe wording. Messages never leak device labels, IDs, or raw
 * exception text beyond the browser's own fallback message.
 *
 * Error-name categories follow the codebase convention established in
 * hooks/useMediaDevices.ts `categorizeError` (permission-denied / not-found /
 * not-readable), extended with OverconstrainedError for device switching.
 */

export type DeviceErrorKind = 'camera' | 'microphone';

export interface DeviceErrorCopy {
  /** Normalized DOMException/Error name ('Unknown' when not derivable). */
  name: string;
  /** User-facing message, safe for alerts and aria-live regions. */
  message: string;
}

interface DeviceCopySet {
  busy: string;
  denied: string;
  notFound: string;
  overconstrained: string;
  fallback: string;
}

const CAMERA_COPY: DeviceCopySet = {
  busy: 'Your camera is unavailable or in use by another app. Close that app and try again.',
  denied: 'Camera access denied — please allow camera permission in your browser.',
  notFound: 'No camera device found. Please check your camera connection.',
  overconstrained: 'Camera constraints could not be satisfied. Try another camera.',
  fallback: 'Failed to access camera',
};

const MICROPHONE_COPY: DeviceCopySet = {
  busy: 'Your microphone is unavailable or in use by another app. Close that app and try again.',
  denied: 'Microphone access denied — please allow microphone permission in your browser.',
  notFound: 'No microphone device found. Please check your microphone connection.',
  overconstrained: 'Microphone constraints could not be satisfied. Try another microphone.',
  fallback: 'Failed to access microphone',
};

/**
 * Map an unknown getUserMedia rejection onto a user-facing message for the
 * given device kind. Falls back to the browser's own error message, then to a
 * generic per-device string.
 */
export function describeDeviceError(err: unknown, device: DeviceErrorKind): DeviceErrorCopy {
  const copy = device === 'microphone' ? MICROPHONE_COPY : CAMERA_COPY;
  const name = (err as { name?: string } | null | undefined)?.name ?? '';
  const rawMessage = (err as { message?: string } | null | undefined)?.message ?? '';

  let message: string;
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    message = copy.busy;
  } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    message = copy.denied;
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    message = copy.notFound;
  } else if (name === 'OverconstrainedError') {
    message = copy.overconstrained;
  } else {
    message = rawMessage || copy.fallback;
  }

  return { name: name || 'Unknown', message };
}
