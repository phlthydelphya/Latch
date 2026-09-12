/**
 * SEC-01A Emergency Containment Hotfix Test Suite
 *
 * Test Coverage:
 * - V1: Forged host-announce rejected (hostId+key unchanged)
 * - V2: Server-relayed valid host-changed accepted
 * - V3: Key-overwrite attempt rejected
 * - V4: Replay >10s rejected (freshness window)
 * - V5: Tokenless establishedHostId spoof rejected
 * - ORDER: No setAuthoritativeHost before verifyDirective
 * - SENDER: Spoofed msg.senderId ignored (only participant?.identity used)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HostControlManager } from '../src/host/hostControlManager';
import { HostTokenVerifier } from '../src/host/hostTokenVerifier';
import { useHostControlStore } from '../src/host/hostControlStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useAppStore } from '../src/store/appStore';
import { HOST_CONTROL_TOPIC, HostDirectiveMessage } from '../src/host/types';
import { PresenceAdapter } from '../src/presence/presenceAdapter';
import { EventEmitter } from 'events';

class MockRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-user',
    name: 'Local User',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    setMicrophoneEnabled: vi.fn(),
    publishData: vi.fn().mockResolvedValue(undefined),
  };
  remoteParticipants: Map<string, any> = new Map();
}

function createMockToken(sub: string, room: string, expOffsetSec: number = 3600): string {
  const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(
    JSON.stringify({
      sub,
      room,
      aud: room,
      role: 'host',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    })
  ).replace(/=/g, '');
  const signature = btoa('mock-signature-bytes').replace(/=/g, '');
  return `${header}.${payload}.${signature}`;
}

function createHostDirective(
  action: HostDirectiveMessage['action'],
  overrides: Partial<HostDirectiveMessage> = {}
): HostDirectiveMessage {
  return {
    type: 'host-directive',
    action,
    senderId: overrides.senderId || 'alice-host',
    targetParticipantId: overrides.targetParticipantId,
    newHostId: overrides.newHostId,
    hostToken: overrides.hostToken,
    hostKey: overrides.hostKey,
    nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    timestamp: overrides.timestamp ?? Date.now(),
    isLocked: overrides.isLocked,
    isWaitingRoomEnabled: overrides.isWaitingRoomEnabled,
    permissions: overrides.permissions,
    participantName: overrides.participantName,
  };
}

describe('SEC-01A: Emergency Containment Hotfix', () => {
  let mockRoom: MockRoom;
  let manager: HostControlManager;

  beforeEach(() => {
    useHostControlStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    useAppStore.setState(useAppStore.getInitialState());

    mockRoom = new MockRoom();
    manager = HostControlManager.getInstance();
    manager.reset();
    manager.attach(mockRoom as any);
  });

  afterEach(() => {
    manager.detach();
    vi.restoreAllMocks();
  });

  const setupHostContext = (roomId: string, hostId: string, localId: string) => {
    useAppStore.setState({
      roomId,
      participantId: localId,
      isConnected: true,
      localParticipant: {
        id: localId,
        name: 'Local User',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
      },
    });

    usePresenceStore.setState({
      localParticipantId: localId,
      hostId,
      participants: new Map([
        [
          hostId,
          {
            id: hostId,
            name: hostId === localId ? 'You (Host)' : 'Host',
            isLocal: hostId === localId,
            isHost: true,
            audioEnabled: true,
            videoEnabled: true,
            screenSharing: false,
            isSpeaking: false,
            connectionQuality: 'good',
            isHandRaised: false,
            joinedAt: 1,
          },
        ],
      ]),
    });

    manager.setSessionContext({
      roomId,
      localParticipantId: localId,
    });
  };

  describe('V1: Forged host-announce rejected (hostId+key unchanged)', () => {
    it('rejects host-announce without hostToken and preserves existing hostId and hostKey', () => {
      setupHostContext('room-v1', 'alice-host', 'local-user');
      const initialHostId = usePresenceStore.getState().hostId;
      const initialHostKey = manager.getHostPublicKey();

      // Attacker sends forged host-announce without hostToken
      const forgedAnnounce = createHostDirective('host-announce', {
        newHostId: 'mallory-attacker',
        hostKey: 'attacker-key-hex',
        timestamp: Date.now(),
        // No hostToken!
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(forgedAnnounce)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host state must remain unchanged
      expect(usePresenceStore.getState().hostId).toBe(initialHostId);
      expect(manager.getHostPublicKey()).toBe(initialHostKey);
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
    });
  });

  describe('V2: Server-relayed valid host-changed accepted', () => {
    it('accepts valid host-changed with proper hostToken from server', () => {
      setupHostContext('room-v2', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-v2');

      const serverHostChanged = createHostDirective('host-changed', {
        newHostId: 'bob-new-host',
        targetParticipantId: 'bob-new-host',
        hostToken: validToken,
        hostKey: 'server-issued-key-hex',
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(serverHostChanged)),
        { identity: 'system' }, // Server sends as system
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host should be updated to new host
      expect(usePresenceStore.getState().hostId).toBe('bob-new-host');
      // BLOCKER 1: hostKey is NOT adopted from DataChannel messages.
      // Keys originate only from /room/create, /room/transfer-host, /room/authority (via setSessionContext).
      expect(manager.getHostPublicKey()).toBeNull();
    });
  });

  describe('V3: Key-overwrite attempt rejected', () => {
    it('rejects host-changed with attacker-provided hostKey when hostToken is valid but key differs', () => {
      setupHostContext('room-v3', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-v3');
      const originalHostKey = manager.getHostPublicKey();

      // Attacker tries to overwrite hostKey with their own key while providing valid token
      const keyOverwriteAttempt = createHostDirective('host-changed', {
        newHostId: 'mallory-attacker',
        targetParticipantId: 'mallory-attacker',
        hostToken: validToken, // Valid token from alice
        hostKey: 'attacker-malicious-key', // But tries to inject their own key
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(keyOverwriteAttempt)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // HostKey must remain the original server-issued key (or null if none was set)
      // The attacker's hostKey must NOT be adopted
      expect(manager.getHostPublicKey()).toBe(originalHostKey);
      // Host should not be changed since the token sub (alice-host) doesn't match sender (mallory)
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
    });

    it('rejects host-announce attempting to inject attacker hostKey', () => {
      setupHostContext('room-v3b', 'alice-host', 'local-user');
      const originalHostKey = manager.getHostPublicKey();

      const keyOverwriteAnnounce = createHostDirective('host-announce', {
        newHostId: 'mallory-attacker',
        hostKey: 'attacker-key-injection',
        hostToken: createMockToken('alice-host', 'room-v3b'), // Valid token
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(keyOverwriteAnnounce)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      expect(manager.getHostPublicKey()).toBe(originalHostKey);
    });
  });

  describe('V4: Replay >60s rejected (freshness window)', () => {
    it('rejects directive with timestamp older than 60 seconds', () => {
      setupHostContext('room-v4', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-v4');

      // Timestamp 65 seconds in the past (exceeds 60s freshness window)
      const staleTimestamp = Date.now() - 65000;
      const replayedDirective = createHostDirective('lock-room', {
        hostToken: validToken,
        isLocked: true,
        timestamp: staleTimestamp,
      });

      const result = HostTokenVerifier.verifyClaimsSync(replayedDirective, 'room-v4', 'alice-host');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Directive timestamp outside freshness window');
    });

    it('rejects directive with timestamp 65 seconds in the future', () => {
      setupHostContext('room-v4b', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-v4b');

      const futureTimestamp = Date.now() + 65000;
      const futureDirective = createHostDirective('lock-room', {
        hostToken: validToken,
        isLocked: true,
        timestamp: futureTimestamp,
      });

      const result = HostTokenVerifier.verifyClaimsSync(futureDirective, 'room-v4b', 'alice-host');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Directive timestamp outside freshness window');
    });

    it('accepts directive with timestamp within 60 seconds', () => {
      setupHostContext('room-v4c', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-v4c');

      const recentTimestamp = Date.now() - 50000; // 50 seconds ago
      const freshDirective = createHostDirective('lock-room', {
        hostToken: validToken,
        isLocked: true,
        timestamp: recentTimestamp,
      });

      const result = HostTokenVerifier.verifyClaimsSync(freshDirective, 'room-v4c', 'alice-host');
      expect(result.valid).toBe(true);
    });
  });

  describe('V5: Tokenless establishedHostId spoof rejected', () => {
    it('rejects moderation directive without hostToken even when senderId matches established hostId', () => {
      setupHostContext('room-v5', 'alice-host', 'local-user');

      // Attacker spoofs as established host but provides no hostToken
      const tokenlessDirective = createHostDirective('mute-participant', {
        targetParticipantId: 'local-user',
        senderId: 'alice-host', // Matches established hostId
        timestamp: Date.now(),
        // No hostToken!
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(tokenlessDirective)),
        { identity: 'alice-host' }, // Participant identity matches
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Local audio must remain enabled (no mute executed)
      expect(useAppStore.getState().localParticipant?.audioEnabled).toBe(true);
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('rejects transfer-host without hostToken even from established host', () => {
      setupHostContext('room-v5b', 'alice-host', 'local-user');

      const tokenlessTransfer = createHostDirective('transfer-host', {
        targetParticipantId: 'mallory-attacker',
        newHostId: 'mallory-attacker',
        senderId: 'alice-host',
        timestamp: Date.now(),
        // No hostToken!
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(tokenlessTransfer)),
        { identity: 'alice-host' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host must remain unchanged
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
    });

    it('rejects lock-room without hostToken', () => {
      setupHostContext('room-v5c', 'alice-host', 'local-user');
      const initialLocked = useHostControlStore.getState().isRoomLocked;

      const tokenlessLock = createHostDirective('lock-room', {
        isLocked: true,
        senderId: 'alice-host',
        timestamp: Date.now(),
        // No hostToken!
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(tokenlessLock)),
        { identity: 'alice-host' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      expect(useHostControlStore.getState().isRoomLocked).toBe(initialLocked);
    });
  });

  describe('ORDER: No setAuthoritativeHost before verifyDirective', () => {
    it('does not call setAuthoritativeHost for host-changed before verification completes', () => {
      setupHostContext('room-order', 'alice-host', 'local-user');
      const setAuthoritativeHostSpy = vi.spyOn(usePresenceStore.getState(), 'setAuthoritativeHost');

      const validToken = createMockToken('alice-host', 'room-order');

      const serverHostChanged = createHostDirective('host-changed', {
        newHostId: 'bob-new-host',
        targetParticipantId: 'bob-new-host',
        hostToken: validToken,
        // No hostKey - uses sync verification (claims only)
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(serverHostChanged)),
        { identity: 'system' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // setAuthoritativeHost should only be called AFTER successful verification
      // (i.e., within the verification success path, not before)
      // The call count should be 1 (for the successful transfer to bob-new-host)
      // and NOT called prematurely during early return
      expect(setAuthoritativeHostSpy).toHaveBeenCalledTimes(1);
      expect(setAuthoritativeHostSpy).toHaveBeenCalledWith('bob-new-host');
    });

    it('does not call setAuthoritativeHost for host-announce before verification', () => {
      setupHostContext('room-order2', 'alice-host', 'local-user');
      const setAuthoritativeHostSpy = vi.spyOn(usePresenceStore.getState(), 'setAuthoritativeHost');

      const validToken = createMockToken('alice-host', 'room-order2');

      const serverHostAnnounce = createHostDirective('host-announce', {
        newHostId: 'alice-host',
        hostToken: validToken,
        // No hostKey - uses sync verification (claims only)
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(serverHostAnnounce)),
        { identity: 'system' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should not call setAuthoritativeHost since host is already established
      // (The test verifies no premature call before verification)
      // In SEC01 mode, host-announce falls through to M4A pipeline
      // If verification passes and no established host, it would set - but here host is established
      expect(setAuthoritativeHostSpy).not.toHaveBeenCalled();
    });
  });

  describe('SENDER: Spoofed msg.senderId ignored (only participant?.identity used)', () => {
    it('uses participant?.identity for senderId, ignores msg.senderId field', () => {
      setupHostContext('room-sender', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-sender');

      // Attacker sends directive with msg.senderId = 'alice-host' but participant.identity = 'mallory'
      const spoofedDirective = createHostDirective('lock-room', {
        senderId: 'alice-host', // This should be IGNORED
        hostToken: validToken,  // Valid token for alice-host
        isLocked: true,
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(spoofedDirective)),
        { identity: 'mallory-attacker' }, // Actual participant identity
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Directive must be rejected because actual sender (mallory) != token sub (alice)
      expect(useHostControlStore.getState().isRoomLocked).toBe(false);
    });

    it('rejects directive when participant identity is missing/falsy', () => {
      setupHostContext('room-sender2', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-sender2');

      const directive = createHostDirective('lock-room', {
        hostToken: validToken,
        isLocked: true,
        timestamp: Date.now(),
      });

      // Emit with no participant (falsy identity)
      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(directive)),
        undefined, // No participant
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Must be dropped with warning
      expect(useHostControlStore.getState().isRoomLocked).toBe(false);
    });
  });

  describe('ORDER: Both listeners (HostControlManager + PresenceAdapter)', () => {
    it('rejects forged host-changed from DataChannel when HostControlManager active (exploit blocked)', () => {
      // HostControlManager provides SEC01 token verification that blocks forged host-changed
      // even when PresenceAdapter is configured - HostControlManager's early return
      // in the verification pipeline prevents PresenceAdapter's direct
      // setAuthoritativeHost from executing on forged messages
      setupHostContext('room-order-both', 'alice-host', 'local-user');
      const initialHostId = usePresenceStore.getState().hostId;
      const initialHostKey = HostControlManager.getInstance().getHostPublicKey();

      // Forge a host-changed directive over DataChannel WITHOUT hostToken
      // This simulates an attacker sending a forged DataChannel message
      const forgedDirective = createHostDirective('host-changed', {
        newHostId: 'mallory-attacker',
        targetParticipantId: 'mallory-attacker',
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(forgedDirective)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // HostControlManager SEC01 verification blocks missing hostToken;
      // PresenceAdapter's direct setAuthoritativeHost is prevented by HostControlManager's
      // early return in the verification pipeline
      expect(usePresenceStore.getState().hostId).toBe(initialHostId);
      expect(HostControlManager.getInstance().getHostPublicKey()).toBe(initialHostKey);
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
    });

    it('accepts valid server-relayed host-changed when HostControlManager active', () => {
      setupHostContext('room-order-valid-both', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-order-valid-both');

      const serverHostChanged = createHostDirective('host-changed', {
        newHostId: 'bob-new-host',
        targetParticipantId: 'bob-new-host',
        hostToken: validToken,
        hostKey: 'server-issued-key-hex',
        timestamp: Date.now(),
      });

      // Server-relayed message: participant "system" with senderId in directive
      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(serverHostChanged)),
        { identity: 'system' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Valid host-changed with proper hostToken is accepted through HostControlManager
      // verification pipeline, which then updates PresenceAdapter state
      expect(usePresenceStore.getState().hostId).toBe('bob-new-host');
    });
  });

  describe('Additional SEC01 containment behaviors', () => {
    it('host-query only replies if self holds valid host token', () => {
      // Non-host queries - should get no response
      setupHostContext('room-query1', 'alice-host', 'local-user'); // local-user is NOT host

      const queryDirective = createHostDirective('host-query', {
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(queryDirective)),
        { identity: 'guest-bob' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // No host-announce should be published (non-host has no localHostToken)
      expect(mockRoom.localParticipant.publishData).not.toHaveBeenCalled();
    });

    it('host-query replies with host-announce including hostToken when self IS host', () => {
      setupHostContext('room-query2', 'local-host', 'local-host'); // local-host IS host
      manager.setSessionContext({
        roomId: 'room-query2',
        localParticipantId: 'local-host',
        hostToken: 'valid-host-token-hex',
        hostKey: 'host-pub-key-hex',
      });

      const queryDirective = createHostDirective('host-query', {
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(queryDirective)),
        { identity: 'guest-bob' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should publish host-announce with hostToken and hostKey
      expect(mockRoom.localParticipant.publishData).toHaveBeenCalled();
      const publishedData = mockRoom.localParticipant.publishData.mock.calls[0][0];
      const publishedMsg = JSON.parse(new TextDecoder().decode(publishedData));
      expect(publishedMsg.action).toBe('host-announce');
      expect(publishedMsg.hostToken).toBe('valid-host-token-hex');
      expect(publishedMsg.hostKey).toBe('host-pub-key-hex');
    });

    it('host-query never broadcasts hostPublicKey to unauthenticated queryers when no host token', () => {
      setupHostContext('room-query3', 'local-host', 'local-host');
      manager.setSessionContext({
        roomId: 'room-query3',
        localParticipantId: 'local-host',
        hostToken: null, // No host token
        hostKey: 'should-not-be-broadcast',
      });

      const queryDirective = createHostDirective('host-query', {
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(queryDirective)),
        { identity: 'guest-bob' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should not publish anything since no host token
      expect(mockRoom.localParticipant.publishData).not.toHaveBeenCalled();
    });

    it('waiting-room-knock still works without hostToken (explicitly allowed)', () => {
      setupHostContext('room-knock', 'alice-host', 'alice-host'); // local is host
      useHostControlStore.getState().setWaitingRoomEnabled(true);

      const knockDirective = createHostDirective('waiting-room-knock', {
        targetParticipantId: 'guest-charlie',
        participantName: 'Charlie',
        timestamp: Date.now(),
        // No hostToken required for knock
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(knockDirective)),
        { identity: 'guest-charlie' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should be added to waiting queue
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);
      expect(useHostControlStore.getState().waitingQueue[0].participantId).toBe('guest-charlie');
    });

    it('waiting-room-admit/reject require verified hostToken (no tokenless fallback)', () => {
      // No host established yet
      usePresenceStore.setState({
        localParticipantId: 'local-user',
        hostId: null,
        participants: new Map(),
      });
      useHostControlStore.getState().setWaitingRoomEnabled(true);
      useHostControlStore.getState().addWaitingParticipant({
        participantId: 'guest-charlie',
        name: 'Charlie',
        timestamp: Date.now(),
      });

      const admitDirective = createHostDirective('waiting-room-admit', {
        targetParticipantId: 'guest-charlie',
        timestamp: Date.now(),
        // No hostToken - should be rejected per BLOCKER 3
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(admitDirective)),
        { identity: 'system' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should NOT admit - tokenless directives are rejected (BLOCKER 3)
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);
    });
  });
});