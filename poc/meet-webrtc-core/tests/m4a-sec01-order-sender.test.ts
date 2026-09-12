/**
 * SEC-01B: ORDER + SENDER Test Suite
 *
 * Test Coverage:
 * - ORDER: Both PresenceAdapter and HostControlManager listeners instantiated; verified path wins, unverified dropped
 * - SENDER: Spoofed msg.senderId ignored (only participant?.identity used for verification)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceAdapter, HAND_RAISE_TOPIC } from '../src/presence/presenceAdapter';
import { HostControlManager } from '../src/host/hostControlManager';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useHostControlStore } from '../src/host/hostControlStore';
import { useAppStore } from '../src/store/appStore';
import { HOST_CONTROL_TOPIC, HostDirectiveMessage } from '../src/host/types';
import { EventEmitter } from 'events';

class MockRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-user',
    name: 'Local User',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    isScreenShareEnabled: false,
    isSpeaking: false,
    connectionQuality: 0,
    publishData: vi.fn().mockResolvedValue(undefined),
    setMicrophoneEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
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

describe('SEC-01B: ORDER + SENDER', () => {
  let mockRoom: MockRoom;
  let presenceAdapter: PresenceAdapter;
  let hostControlManager: HostControlManager;

  beforeEach(() => {
    useHostControlStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    useAppStore.setState(useAppStore.getInitialState());

    mockRoom = new MockRoom();
    hostControlManager = HostControlManager.getInstance();
    hostControlManager.reset();
    hostControlManager.attach(mockRoom as any);

    presenceAdapter = new PresenceAdapter();
    presenceAdapter.attach(mockRoom as any);
  });

  afterEach(() => {
    hostControlManager.detach();
    presenceAdapter.detach();
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

    hostControlManager.setSessionContext({
      roomId,
      localParticipantId: localId,
    });
  };

  describe('ORDER: Verified path wins, unverified dropped', () => {
    it('host-changed via PresenceAdapter (unverified) is dropped, HostControlManager (verified) processes correctly', () => {
      setupHostContext('room-order', 'alice-host', 'local-user');
      const initialHostId = usePresenceStore.getState().hostId;
      expect(initialHostId).toBe('alice-host');

      // Spy on setAuthoritativeHost to track calls
      const setAuthoritativeHostSpy = vi.spyOn(usePresenceStore.getState(), 'setAuthoritativeHost');

      // 1. Attacker sends forged host-changed WITHOUT valid hostToken via DataChannel
      // This would have been processed by the old PresenceAdapter unverified path
      const forgedHostChanged = createHostDirective('host-changed', {
        newHostId: 'mallory-attacker',
        targetParticipantId: 'mallory-attacker',
        // NO hostToken!
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(forgedHostChanged)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host state must remain unchanged (unverified path dropped)
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
      expect(setAuthoritativeHostSpy).not.toHaveBeenCalled();

      // 2. Now send a VALID host-changed WITH hostToken from server (system participant)
      // This should be processed by HostControlManager verified path
      const validToken = createMockToken('alice-host', 'room-order');
      const validHostChanged = createHostDirective('host-changed', {
        newHostId: 'bob-new-host',
        targetParticipantId: 'bob-new-host',
        hostToken: validToken,
        hostKey: 'server-issued-key-hex',
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(validHostChanged)),
        { identity: 'system' }, // Server-relayed
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host should be updated to new host via verified path
      expect(usePresenceStore.getState().hostId).toBe('bob-new-host');
      expect(hostControlManager.getHostPublicKey()).toBeNull();
      // setAuthoritativeHost should have been called exactly once (for the valid transfer)
      expect(setAuthoritativeHostSpy).toHaveBeenCalledTimes(1);
      expect(setAuthoritativeHostSpy).toHaveBeenCalledWith('bob-new-host');
    });

    it('host-announce via PresenceAdapter (unverified) is dropped, HostControlManager (verified) processes correctly', () => {
      setupHostContext('room-order-announce', 'alice-host', 'local-user');
      const initialHostId = usePresenceStore.getState().hostId;
      expect(initialHostId).toBe('alice-host');

      const setAuthoritativeHostSpy = vi.spyOn(usePresenceStore.getState(), 'setAuthoritativeHost');

      // 1. Attacker sends forged host-announce WITHOUT valid hostToken
      const forgedAnnounce = createHostDirective('host-announce', {
        newHostId: 'mallory-attacker',
        hostKey: 'attacker-key-hex',
        // NO hostToken!
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(forgedAnnounce)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host state must remain unchanged
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
      expect(hostControlManager.getHostPublicKey()).toBeNull();
      expect(setAuthoritativeHostSpy).not.toHaveBeenCalled();

      // 2. Valid host-announce from server with hostToken
      const validToken = createMockToken('alice-host', 'room-order-announce');
      const validAnnounce = createHostDirective('host-announce', {
        newHostId: 'alice-host',
        hostToken: validToken,
        hostKey: 'server-announce-key',
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(validAnnounce)),
        { identity: 'system' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Host remains the same (already established), but hostKey is NOT adopted from DataChannel messages
      // (Blocker 1: Keys originate only from /room/create, /room/transfer-host, /room/authority via setSessionContext)
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
      expect(hostControlManager.getHostPublicKey()).toBeNull();
      // setAuthoritativeHost should NOT be called since host already established
      expect(setAuthoritativeHostSpy).not.toHaveBeenCalled();
    });

    it('both listeners receive DataReceived but only verified path mutates hostId', () => {
      setupHostContext('room-both-listeners', 'alice-host', 'local-user');

      const setAuthoritativeHostSpy = vi.spyOn(usePresenceStore.getState(), 'setAuthoritativeHost');

      // Send a directive that would pass PresenceAdapter's old logic (has newHostId)
      // but fails HostControlManager verification (no hostToken)
      const ambiguousDirective = createHostDirective('host-changed', {
        newHostId: 'mallory-attacker',
        targetParticipantId: 'mallory-attacker',
        // No hostToken - should be rejected by HostControlManager
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(ambiguousDirective)),
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Verify: hostId unchanged, setAuthoritativeHost never called
      expect(usePresenceStore.getState().hostId).toBe('alice-host');
      expect(setAuthoritativeHostSpy).not.toHaveBeenCalled();

      // Verify: no toast about host transfer (which would indicate mutation)
      const hostToasts = usePresenceStore.getState().toastQueue.filter((t) => t.type === 'host');
      expect(hostToasts).toHaveLength(0);
    });
  });

  describe('SENDER: Spoofed msg.senderId ignored', () => {
    it('uses participant?.identity for senderId, ignores msg.senderId field in HostControlManager', () => {
      setupHostContext('room-sender', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-sender');

      // Attacker sends directive with msg.senderId = 'alice-host' but participant.identity = 'mallory'
      const spoofedDirective = createHostDirective('lock-room', {
        senderId: 'alice-host', // This should be IGNORED by HostControlManager
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

    it('server-relayed messages use msg.senderId for verification when participant is system', () => {
      setupHostContext('room-sender3', 'alice-host', 'local-user');
      const validToken = createMockToken('alice-host', 'room-sender3');

      // Server sends as 'system' participant with msg.senderId = 'alice-host'
      const serverDirective = createHostDirective('lock-room', {
        senderId: 'alice-host',
        hostToken: validToken,
        isLocked: true,
        timestamp: Date.now(),
      });

      mockRoom.emit(
        'dataReceived',
        new TextEncoder().encode(JSON.stringify(serverDirective)),
        { identity: 'system' }, // Server participant
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Should be accepted because verificationSenderId = msg.senderId = 'alice-host' matches token sub
      expect(useHostControlStore.getState().isRoomLocked).toBe(true);
    });
  });

  describe('Exploit Regression: Original forged host-changed cannot mutate hostId', () => {
    it('ATTENDEE EXPLOIT: Forged host-changed via DataChannel does NOT mutate presenceStore.hostId', () => {
      // This test directly validates the SUCCESS CRITERIA:
      // "Attendee cannot execute original exploit — forged host-changed via DataChannel does NOT mutate presenceStore.hostId"
      setupHostContext('room-exploit', 'alice-host', 'local-user');
      expect(usePresenceStore.getState().hostId).toBe('alice-host');

      // Original exploit: attendee sends host-changed with newHostId but no hostToken
      const exploitPayload = new TextEncoder().encode(
        JSON.stringify({
          type: 'host-directive',
          action: 'host-changed',
          newHostId: 'mallory-attacker',
          targetParticipantId: 'mallory-attacker',
          timestamp: Date.now(),
          // No hostToken - this is the exploit
        })
      );

      mockRoom.emit(
        'dataReceived',
        exploitPayload,
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Binary YES/NO: Can attendee execute original exploit?
      // Expected: NO - hostId must remain 'alice-host'
      const finalHostId = usePresenceStore.getState().hostId;
      expect(finalHostId).toBe('alice-host');
      expect(finalHostId).not.toBe('mallory-attacker');
    });

    it('ATTENDEE EXPLOIT: host-announce variant also blocked', () => {
      setupHostContext('room-exploit2', 'alice-host', 'local-user');
      expect(usePresenceStore.getState().hostId).toBe('alice-host');

      const exploitPayload = new TextEncoder().encode(
        JSON.stringify({
          type: 'host-directive',
          action: 'host-announce',
          newHostId: 'mallory-attacker',
          timestamp: Date.now(),
          // No hostToken
        })
      );

      mockRoom.emit(
        'dataReceived',
        exploitPayload,
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      const finalHostId = usePresenceStore.getState().hostId;
      expect(finalHostId).toBe('alice-host');
      expect(finalHostId).not.toBe('mallory-attacker');
    });
  });
});