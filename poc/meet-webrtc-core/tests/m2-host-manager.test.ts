import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { HostControlManager } from '../src/host/hostControlManager';
import { useHostControlStore } from '../src/host/hostControlStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useAppStore } from '../src/store/appStore';
import { HOST_CONTROL_TOPIC, HostDirectiveMessage } from '../src/host/types';

class MockLiveKitRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-host',
    name: 'Host Alice',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    setMicrophoneEnabled: vi.fn(),
    publishData: vi.fn().mockResolvedValue(undefined),
  };
  remoteParticipants: Map<string, any> = new Map();
}

describe('M2 Phase E: HostControlManager', () => {
  let mockRoom: MockLiveKitRoom;
  let manager: HostControlManager;

  beforeEach(() => {
    useHostControlStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'local-host',
      isConnected: true,
      localParticipant: {
        id: 'local-host',
        name: 'Host Alice',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
      },
      participants: new Map(),
    });

    // Set local-host as initial host
    usePresenceStore.setState({
      localParticipantId: 'local-host',
      hostId: 'local-host',
    });

    mockRoom = new MockLiveKitRoom();
    manager = HostControlManager.getInstance();
    manager.setSessionContext({
      roomId: 'test-room',
      localParticipantId: 'local-host',
      hostToken: createMockHostToken('local-host'),
    });
    manager.attach(mockRoom as any);
  });

  afterEach(() => {
    manager.detach();
  });

  function createMockHostToken(sub: string, room: string = 'test-room'): string {
    const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).replace(/=/g, '');
    const payload = btoa(
      JSON.stringify({
        sub,
        room,
        aud: room,
        role: 'host',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).replace(/=/g, '');
    const signature = btoa('mock-signature-bytes').replace(/=/g, '');
    return `${header}.${payload}.${signature}`;
  }

  function emitDirective(msg: Partial<HostDirectiveMessage>, senderId: string, senderIsHost: boolean = false) {
    if (!usePresenceStore.getState().participants.has(senderId)) {
      usePresenceStore.getState().upsertParticipant({
        id: senderId,
        name: `User ${senderId}`,
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isSpeaking: false,
        connectionQuality: 'good',
        isHandRaised: false,
        isHost: senderIsHost,
        joinedAt: Date.now(),
      });
    }

    const hostToken = senderIsHost ? (msg.hostToken || createMockHostToken(senderId)) : msg.hostToken;

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'host-directive',
        timestamp: Date.now(),
        hostToken,
        ...msg,
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: senderId, name: `User ${senderId}` },
      undefined,
      HOST_CONTROL_TOPIC
    );
  }

  it('E-11: Processes room lock directive from host and rejects from unauthorized attendees', () => {
    // Non-host sends lock -> should be ignored
    emitDirective({ action: 'lock-room', isLocked: true }, 'remote-attendee-bob', false);
    expect(useHostControlStore.getState().isRoomLocked).toBe(false);

    // Host sends lock -> should be accepted
    emitDirective({ action: 'lock-room', isLocked: true }, 'local-host', true);
    expect(useHostControlStore.getState().isRoomLocked).toBe(true);

    const toasts = usePresenceStore.getState().toastQueue;
    expect(toasts.some((t) => t.message.includes('locked'))).toBe(true);
  });

  it('E-12: Sets waiting room enabled/disabled via host directive', () => {
    emitDirective({ action: 'set-waiting-room', isWaitingRoomEnabled: true }, 'local-host', true);
    expect(useHostControlStore.getState().isWaitingRoomEnabled).toBe(true);

    emitDirective({ action: 'set-waiting-room', isWaitingRoomEnabled: false }, 'local-host', true);
    expect(useHostControlStore.getState().isWaitingRoomEnabled).toBe(false);
  });

  it('E-13: Handles waiting-room-knock from knocking attendee', () => {
    emitDirective(
      {
        action: 'waiting-room-knock',
        targetParticipantId: 'knocker-guest-1',
        participantName: 'Guest David',
      },
      'knocker-guest-1',
      false
    );

    const queue = useHostControlStore.getState().waitingQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].participantId).toBe('knocker-guest-1');
    expect(queue[0].name).toBe('Guest David');

    const toasts = usePresenceStore.getState().toastQueue;
    expect(toasts.some((t) => t.message.includes('Guest David is waiting to join'))).toBe(true);
  });

  it('E-14: Host admits waiting guest and removes from waiting queue', () => {
    useHostControlStore.getState().addWaitingParticipant({
      participantId: 'guest-charlie',
      name: 'Charlie',
      timestamp: Date.now(),
    });
    expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);

    emitDirective(
      {
        action: 'waiting-room-admit',
        targetParticipantId: 'guest-charlie',
      },
      'local-host',
      true
    );

    expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);
  });

  it('E-15: Host declines waiting guest', () => {
    useHostControlStore.getState().addWaitingParticipant({
      participantId: 'guest-charlie',
      name: 'Charlie',
      timestamp: Date.now(),
    });

    emitDirective(
      {
        action: 'waiting-room-reject',
        targetParticipantId: 'guest-charlie',
      },
      'local-host',
      true
    );

    expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);
  });

  it('E-16: Remote mute directive mutes targeted local participant', () => {
    // Switch self to attendee
    usePresenceStore.setState({
      localParticipantId: 'local-attendee',
      hostId: 'remote-host',
    });

    useAppStore.setState({
      participantId: 'local-attendee',
      localParticipant: {
        id: 'local-attendee',
        name: 'Attendee',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
      },
    });

    emitDirective(
      {
        action: 'mute-participant',
        targetParticipantId: 'local-attendee',
      },
      'remote-host',
      true
    );

    expect(useAppStore.getState().localParticipant?.audioEnabled).toBe(false);
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);

    const toasts = usePresenceStore.getState().toastQueue;
    expect(toasts.some((t) => t.message.includes('muted your microphone'))).toBe(true);
  });

  it('E-17: Remote remove directive sets isKicked and disconnects local user', () => {
    usePresenceStore.setState({
      localParticipantId: 'local-attendee',
      hostId: 'remote-host',
    });

    emitDirective(
      {
        action: 'remove-participant',
        targetParticipantId: 'local-attendee',
      },
      'remote-host',
      true
    );

    expect(useHostControlStore.getState().isKicked).toBe(true);
    expect(useAppStore.getState().roomId).toBeNull(); // leave() was invoked
  });

  it('E-18: Transfer host directive assigns new host in presence store', () => {
    usePresenceStore.getState().upsertParticipant({
      id: 'bob-new-host',
      name: 'Bob',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: Date.now(),
    });

    emitDirective(
      {
        action: 'transfer-host',
        targetParticipantId: 'bob-new-host',
      },
      'local-host',
      true
    );

    expect(usePresenceStore.getState().hostId).toBe('bob-new-host');
    const toasts = usePresenceStore.getState().toastQueue;
    expect(toasts.some((t) => t.message.includes('Bob is now the meeting host'))).toBe(true);
  });

  it('E-19: Updates permissions and stops local screen share if disallowed for attendees', () => {
    // Switch to attendee with active screen share
    usePresenceStore.setState({
      localParticipantId: 'local-attendee',
      hostId: 'remote-host',
    });

    useAppStore.setState({
      localParticipant: {
        id: 'local-attendee',
        name: 'Attendee',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: true,
        isLocal: true,
        isSpeaking: false,
      },
    });

    emitDirective(
      {
        action: 'update-permissions',
        permissions: { canShareScreen: false },
      },
      'remote-host',
      true
    );

    expect(useHostControlStore.getState().permissions.canShareScreen).toBe(false);
    expect(useAppStore.getState().localParticipant?.screenSharing).toBe(false);

    const toasts = usePresenceStore.getState().toastQueue;
    expect(toasts.some((t) => t.message.includes('restricted screen sharing'))).toBe(true);
  });

  it('E-20: Outgoing publish directives transmit reliably over DataChannel', async () => {
    await manager.muteParticipant('peer-1');
    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1);
    const [payloadBytes, options] = mockRoom.localParticipant.publishData.mock.calls[0];
    expect(payloadBytes).toBeDefined();
    expect(options).toMatchObject({ reliable: true, topic: HOST_CONTROL_TOPIC });

    const decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
    expect(decoded.action).toBe('mute-participant');
    expect(decoded.targetParticipantId).toBe('peer-1');

    await manager.setRoomLocked(true);
    expect(useHostControlStore.getState().isRoomLocked).toBe(true);

    await manager.setWaitingRoomEnabled(true);
    expect(useHostControlStore.getState().isWaitingRoomEnabled).toBe(true);

    await manager.updatePermissions({ canChat: false });
    expect(useHostControlStore.getState().permissions.canChat).toBe(false);
  });

  it('E-21: Strictly rejects directives when hostId is null or undefined', () => {
    usePresenceStore.getState().upsertParticipant({
      id: 'existing-peer',
      name: 'Existing Peer',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: Date.now(),
    });
    usePresenceStore.setState({
      hostId: null,
    });

    emitDirective({ action: 'lock-room', isLocked: true }, 'remote-attacker', false);
    expect(useHostControlStore.getState().isRoomLocked).toBe(false);

    emitDirective({ action: 'mute-participant', targetParticipantId: 'local-host' }, 'remote-attacker', false);
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('E-22: Rejects directives when sender claims isHost but conflicting hostId is established', () => {
    usePresenceStore.setState({
      hostId: 'legitimate-host',
    });
    usePresenceStore.getState().upsertParticipant({
      id: 'impostor',
      name: 'Impostor',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    emitDirective({ action: 'lock-room', isLocked: true }, 'impostor', true);
    expect(useHostControlStore.getState().isRoomLocked).toBe(false);

    emitDirective({ action: 'mute-participant', targetParticipantId: 'legitimate-host' }, 'impostor', true);
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});
