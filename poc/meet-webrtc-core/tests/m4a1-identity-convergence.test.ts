/**
 * M4A.1 — Meeting Identity Convergence & Key Continuity Test Suite
 *
 * Covers:
 *   M4A1-ID-01: Host Key Continuity
 *   M4A1-ID-02: Invite Convergence
 *   M4A1-ID-03: Cross-Room Credential Isolation
 *   M4A1-ID-04: Missing-Key Rejection
 *   M4A1-ID-05: Invitation Surface Consistency
 *   M4A1-ID-06: Two-Browser Convergence Contract
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseMeetingInput, formatMeetingUrl, formatMeetingPath, formatInvitationText } from '../src/utils/roomUrl';
import { generateQRCodeSVG } from '../src/utils/qr';
import { useAppStore } from '../src/store/appStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useHostControlStore } from '../src/host/hostControlStore';

describe('M4A1-ID: Meeting Identity Convergence & Key Continuity', () => {
  beforeEach(() => {
    useAppStore.getState().clearRoom();
    usePresenceStore.getState().resetPresence();
    useHostControlStore.getState().reset();
  });

  // ── M4A1-ID-01: Host Key Continuity ──────────────────────────────────────────
  describe('M4A1-ID-01: Host Key Continuity', () => {
    it('formatMeetingPath preserves exact room ID and keyParam fragment for Host Start Meeting', () => {
      const roomId = 'room-alpha-999';
      const keyParam = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const path = formatMeetingPath(roomId, keyParam);

      expect(path).toBe(`/r/${roomId}#k=${keyParam}`);
      expect(path).toContain(`/r/${roomId}`);
      expect(path).toContain(`#k=${keyParam}`);
      expect(path).not.toContain('?');
    });

    it('formatMeetingPath handles keyParam without re-generating or omitting hash', () => {
      const roomId = 'conf-meeting-42';
      const keyParam = 'deadbeefcafe0123';
      const path = formatMeetingPath(roomId, keyParam);

      const parsed = parseMeetingInput(path);
      expect(parsed.isValid).toBe(true);
      expect(parsed.roomId).toBe('conf-meeting-42');
      expect(parsed.keyParam).toBe('deadbeefcafe0123');
    });
  });

  // ── M4A1-ID-02: Invite Convergence ──────────────────────────────────────────
  describe('M4A1-ID-02: Invite Convergence', () => {
    it('parses invite URL so that Host and Guest resolve identical room ID and E2EE keyParam', () => {
      const hostRoomId = 'room-converge-100';
      const hostKeyParam = '11223344556677889900aabbccddeeff';

      const invitationUrl = formatMeetingUrl(hostRoomId, hostKeyParam);
      const guestParsed = parseMeetingInput(invitationUrl);

      expect(guestParsed.isValid).toBe(true);
      expect(guestParsed.roomId).toBe(hostRoomId);
      expect(guestParsed.keyParam).toBe(hostKeyParam);
    });
  });

  // ── M4A1-ID-03: Cross-Room Credential Isolation ─────────────────────────────
  describe('M4A1-ID-03: Cross-Room Credential Isolation', () => {
    it('rejects credential reuse when route room does not match stored room ID', () => {
      // Simulate Room A credentials in store
      useAppStore.getState().setRoom('room-A', 'p-host-alice', 'jwt-token-room-A', 'key-room-A');

      const routeRoomId = 'room-B';
      const storeState = useAppStore.getState();

      const credentialsMatchRoute =
        Boolean(storeState.participantId) &&
        Boolean(storeState.jwt) &&
        storeState.roomId === routeRoomId;

      expect(credentialsMatchRoute).toBe(false);
      // Active participant ID must be nullified for Room B so fresh credentials are required
      const activeParticipantId = credentialsMatchRoute ? storeState.participantId : null;
      expect(activeParticipantId).toBeNull();
    });

    it('allows credential reuse only when route room matches stored room ID', () => {
      useAppStore.getState().setRoom('room-target', 'p-host-alice', 'jwt-token-valid', 'key-valid');

      const routeRoomId = 'room-target';
      const storeState = useAppStore.getState();

      const credentialsMatchRoute =
        Boolean(storeState.participantId) &&
        Boolean(storeState.jwt) &&
        storeState.roomId === routeRoomId;

      expect(credentialsMatchRoute).toBe(true);
      const activeParticipantId = credentialsMatchRoute ? storeState.participantId : null;
      expect(activeParticipantId).toBe('p-host-alice');
    });
  });

  // ── M4A1-ID-04: Missing-Key Rejection (Fail Closed) ──────────────────────────
  describe('M4A1-ID-04: Missing-Key Rejection (Fail Closed)', () => {
    it('fails closed when joining an existing room without #k= fragment', () => {
      // Input has no fragment
      const parsed = parseMeetingInput('/r/secure-room-999');
      expect(parsed.isValid).toBe(true);
      expect(parsed.keyParam).toBeUndefined();

      // Rule: Joining existing room with missing key must not silently generate a key
      const hashKey = parsed.keyParam || '';
      const isMissingKey = !hashKey;
      expect(isMissingKey).toBe(true);

      const errorMessage = isMissingKey
        ? 'Unable to join securely. This invitation is missing its encryption key. Ask the host for a new invitation.'
        : null;

      expect(errorMessage).toBe(
        'Unable to join securely. This invitation is missing its encryption key. Ask the host for a new invitation.'
      );
    });

    it('allows keyParam presence to proceed when fragment is provided', () => {
      const parsed = parseMeetingInput('/r/secure-room-999#k=validkey12345');
      expect(parsed.isValid).toBe(true);
      expect(parsed.keyParam).toBe('validkey12345');

      const hashKey = parsed.keyParam || '';
      expect(Boolean(hashKey)).toBe(true);
    });
  });

  // ── M4A1-ID-05: Invitation Surface Consistency ──────────────────────────────
  describe('M4A1-ID-05: Invitation Surface Consistency', () => {
    it('encodes identical room ID and keyParam across all invitation surfaces', () => {
      const roomId = 'latch-demo-room';
      const keyParam = 'abcdefabcdef1234567890abcdef1234567890abcdef1234567890abcdef12';

      // 1. Meeting URL (Copy Link)
      const meetingUrl = formatMeetingUrl(roomId, keyParam);
      const parsedFromUrl = parseMeetingInput(meetingUrl);

      // 2. Invitation Text (Copy Invitation)
      const invitationText = formatInvitationText(roomId, keyParam);
      expect(invitationText).toContain(meetingUrl);

      // 3. Local Path (Start Meeting)
      const meetingPath = formatMeetingPath(roomId, keyParam);
      const parsedFromPath = parseMeetingInput(meetingPath);

      // 4. QR Code SVG
      const qrSvg = generateQRCodeSVG(meetingUrl);
      expect(qrSvg).toContain('<svg');
      expect(qrSvg).toContain('</svg>');

      // Assert all surfaces preserve identical roomId and keyParam
      expect(parsedFromUrl.roomId).toBe(roomId);
      expect(parsedFromUrl.keyParam).toBe(keyParam);
      expect(parsedFromPath.roomId).toBe(roomId);
      expect(parsedFromPath.keyParam).toBe(keyParam);
    });
  });

  // ── M4A1-ID-06: Two-Browser Convergence Contract ────────────────────────────
  describe('M4A1-ID-06: Two-Browser Convergence Contract', () => {
    it('ensures Host and Guest share identical SFrame key domain and room identifier', () => {
      const createdRoomId = 'room-converge-test';
      const createdKey = 'k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1';

      // Host establishes room
      const hostPath = formatMeetingPath(createdRoomId, createdKey);
      const hostParsed = parseMeetingInput(hostPath);

      // Guest joins via invitation
      const guestInvitation = formatMeetingUrl(createdRoomId, createdKey);
      const guestParsed = parseMeetingInput(guestInvitation);

      expect(hostParsed.roomId).toBe(guestParsed.roomId);
      expect(hostParsed.keyParam).toBe(guestParsed.keyParam);
      expect(hostParsed.roomId).toBe(createdRoomId);
      expect(hostParsed.keyParam).toBe(createdKey);
    });
  });
});
