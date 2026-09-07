/**
 * Room URL & Meeting Invitation Utilities (M4A.1)
 *
 * Handles parsing, validation, and generation of canonical shareable meeting URLs
 * and formatted human-readable meeting invitations.
 */

export interface ParsedMeetingInput {
  roomId: string;
  keyParam?: string;
  isValid: boolean;
  error?: string;
}

export const ROOM_ID_REGEX = /^[a-z0-9-]{6,64}$/i;

/**
 * Parses user-provided meeting input, which may be:
 * - A raw room ID: "abc-123-xyz"
 * - A relative URL: "/r/abc-123-xyz#k=..."
 * - A full meeting URL: "https://meet.secure/r/abc-123-xyz#k=..."
 * - A room ID with hash key: "abc-123-xyz#k=..."
 */
export function parseMeetingInput(rawInput: string): ParsedMeetingInput {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      roomId: '',
      isValid: false,
      error: 'Please enter a meeting link or ID.',
    };
  }

  let working = trimmed;
  let keyParam: string | undefined;

  // Extract hash parameter if present (#k=...)
  const hashIdx = working.indexOf('#');
  if (hashIdx !== -1) {
    const hashPart = working.slice(hashIdx + 1);
    working = working.slice(0, hashIdx);
    const kMatch = hashPart.match(/(?:^|&)k=([a-zA-Z0-9_-]+)/);
    if (kMatch) {
      keyParam = kMatch[1];
    }
  }

  // Strip protocol and hostname if full URL (e.g., https://domain.com/r/roomId)
  try {
    if (working.includes('://')) {
      const url = new URL(working);
      working = url.pathname;
    }
  } catch {
    // If URL parsing fails, continue with raw string
  }

  // Extract path segment after /r/
  const rMatch = working.match(/(?:\/r\/|^r\/)([^/?#]+)/i);
  if (rMatch) {
    working = rMatch[1];
  } else {
    // Strip leading and trailing slashes
    working = working.replace(/^\/+|\/+$/g, '');
  }

  // Remove any query string remaining
  const queryIdx = working.indexOf('?');
  if (queryIdx !== -1) {
    working = working.slice(0, queryIdx);
  }

  const normalizedRoomId = working.trim().toLowerCase();

  if (normalizedRoomId.length < 6) {
    return {
      roomId: normalizedRoomId,
      keyParam,
      isValid: false,
      error: 'Meeting identifier must be at least 6 characters.',
    };
  }

  if (normalizedRoomId.length > 64) {
    return {
      roomId: normalizedRoomId,
      keyParam,
      isValid: false,
      error: 'Meeting identifier must be 64 characters or fewer.',
    };
  }

  if (!ROOM_ID_REGEX.test(normalizedRoomId)) {
    return {
      roomId: normalizedRoomId,
      keyParam,
      isValid: false,
      error: 'Invalid meeting identifier. Use only letters, numbers, and hyphens.',
    };
  }

  return {
    roomId: normalizedRoomId,
    keyParam,
    isValid: true,
  };
}

/**
 * Formats a canonical meeting URL including optional E2EE hash parameter.
 */
export function formatMeetingUrl(roomId: string, keyParam?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://meet.secure';
  const cleanRoom = roomId.trim().toLowerCase();
  const hash = keyParam ? `#k=${keyParam}` : '';
  return `${origin}/r/${cleanRoom}${hash}`;
}

/**
 * Formats full human-readable invitation text (INV-02).
 */
export function formatInvitationText(
  roomId: string,
  keyParam?: string,
  options?: { meetingName?: string; hostName?: string }
): string {
  const meetingUrl = formatMeetingUrl(roomId, keyParam);
  const hostPrefix = options?.hostName ? `${options.hostName} invited you to join a secure meeting.` : "You're invited to join a secure meeting.";
  const titleLine = options?.meetingName ? `\nMeeting: ${options.meetingName}` : '';

  return `${hostPrefix}${titleLine}

Join Meeting:
${meetingUrl}

Meeting ID: ${roomId}
Security: End-to-end encrypted (SFrame RFC 9605). No server recording or logs.`;
}
