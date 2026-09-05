import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { CollaborationAdapter } from '../src/collaboration/collaborationAdapter';
import { useCollaborationStore } from '../src/collaboration/collaborationStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import {
  CHAT_TOPIC,
  REACTION_TOPIC,
  ANNOUNCEMENT_TOPIC,
  HAND_ACTION_TOPIC,
} from '../src/collaboration/types';

class MockLiveKitRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-alice',
    name: 'Alice Local',
  };
  remoteParticipants: Map<string, any> = new Map();
}

describe('M2 Phase C: LiveKit Collaboration Adapter', () => {
  let mockRoom: MockLiveKitRoom;
  let adapter: CollaborationAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    useCollaborationStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    mockRoom = new MockLiveKitRoom();
    adapter = new CollaborationAdapter();
  });

  afterEach(() => {
    adapter.detach();
    vi.useRealTimers();
  });

  it('C-10: Processes incoming chat DataChannel frame and populates store', () => {
    adapter.attach(mockRoom as any);

    // Setup participant in PresenceStore to test identity resolution
    usePresenceStore.getState().upsertParticipant({
      id: 'remote-bob',
      name: 'Bob Builder',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: Date.now(),
    });

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'chat',
        id: 'msg-remote-1',
        text: 'Hello from remote Bob!',
        timestamp: 1700000000000,
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'remote-bob', name: 'Bob Builder' },
      undefined,
      CHAT_TOPIC
    );

    const msgs = useCollaborationStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg-remote-1');
    expect(msgs[0].senderId).toBe('remote-bob');
    expect(msgs[0].senderName).toBe('Bob Builder');
    expect(msgs[0].text).toBe('Hello from remote Bob!');
    expect(msgs[0].isLocal).toBe(false);
    expect(useCollaborationStore.getState().unreadCount).toBe(1);
  });

  it('C-11: Processes reaction DataChannel frame and auto-prunes after 3.5s', () => {
    adapter.attach(mockRoom as any);

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'reaction',
        id: 'rx-remote-1',
        emoji: '🎉',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'remote-charlie', name: 'Charlie' },
      undefined,
      REACTION_TOPIC
    );

    const reactions = useCollaborationStore.getState().activeReactions;
    expect(reactions).toHaveLength(1);
    expect(reactions[0].id).toBe('rx-remote-1');
    expect(reactions[0].emoji).toBe('🎉');
    expect(reactions[0].senderName).toBe('Charlie');

    // Advance timers by 3400ms (still active)
    vi.advanceTimersByTime(3400);
    expect(useCollaborationStore.getState().activeReactions).toHaveLength(1);

    // Advance by another 200ms (total 3600ms > 3500ms)
    vi.advanceTimersByTime(200);
    expect(useCollaborationStore.getState().activeReactions).toHaveLength(0);
  });

  it('C-12: Accepts announcement from Host and populates banner', () => {
    adapter.attach(mockRoom as any);

    // Set Alice as Host in PresenceStore
    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice Host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'announcement',
        id: 'ann-1',
        message: 'Important: wrap up in 2 mins',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'local-alice', name: 'Alice Host' },
      undefined,
      ANNOUNCEMENT_TOPIC
    );

    const ann = useCollaborationStore.getState().currentAnnouncement;
    expect(ann).not.toBeNull();
    expect(ann?.id).toBe('ann-1');
    expect(ann?.message).toBe('Important: wrap up in 2 mins');
    expect(ann?.active).toBe(true);
  });

  it('C-13: Rejects unauthorized announcement from non-host participant', () => {
    adapter.attach(mockRoom as any);

    // Alice is host
    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice Host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    // Remote-eve (not host) attempts announcement
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'announcement',
        id: 'ann-fake',
        message: 'Fake announcement',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'remote-eve', name: 'Eve' },
      undefined,
      ANNOUNCEMENT_TOPIC
    );

    expect(useCollaborationStore.getState().currentAnnouncement).toBeNull();
  });

  it('C-14: Processes host hand action "lower-hand" for specific participant', () => {
    adapter.attach(mockRoom as any);

    // Setup host and participant with raised hand
    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice Host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    usePresenceStore.getState().upsertParticipant({
      id: 'remote-bob',
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
    usePresenceStore.getState().setHandRaised('remote-bob', true);

    expect(usePresenceStore.getState().raisedHands).toHaveLength(1);

    // Host sends lower-hand for Bob
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'hand-action',
        action: 'lower-hand',
        targetParticipantId: 'remote-bob',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'local-alice' },
      undefined,
      HAND_ACTION_TOPIC
    );

    expect(usePresenceStore.getState().raisedHands).toHaveLength(0);
    expect(usePresenceStore.getState().participants.get('remote-bob')?.isHandRaised).toBe(false);
  });

  it('C-15: Processes host hand action "lower-all"', () => {
    adapter.attach(mockRoom as any);

    // Setup host
    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice Host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    // Two participants with raised hands
    usePresenceStore.getState().upsertParticipant({
      id: 'remote-bob',
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
    usePresenceStore.getState().setHandRaised('remote-bob', true);

    usePresenceStore.getState().upsertParticipant({
      id: 'remote-charlie',
      name: 'Charlie',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: Date.now(),
    });
    usePresenceStore.getState().setHandRaised('remote-charlie', true);

    expect(usePresenceStore.getState().raisedHands).toHaveLength(2);

    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'hand-action',
        action: 'lower-all',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'local-alice' },
      undefined,
      HAND_ACTION_TOPIC
    );

    expect(usePresenceStore.getState().raisedHands).toHaveLength(0);
  });

  it('C-16: Rejects hand actions from non-host participants', () => {
    adapter.attach(mockRoom as any);

    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice Host',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    usePresenceStore.getState().upsertParticipant({
      id: 'remote-bob',
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
    usePresenceStore.getState().setHandRaised('remote-bob', true);

    // Eve (non-host) sends lower-all
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'hand-action',
        action: 'lower-all',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit(
      'dataReceived',
      payload,
      { identity: 'remote-eve' },
      undefined,
      HAND_ACTION_TOPIC
    );

    // Hand still raised
    expect(usePresenceStore.getState().raisedHands).toHaveLength(1);
  });

  it('C-17: Detaches listeners and clears timers cleanly', () => {
    adapter.attach(mockRoom as any);
    expect(mockRoom.listenerCount('dataReceived')).toBeGreaterThan(0);

    adapter.detach();
    expect(mockRoom.listenerCount('dataReceived')).toBe(0);
  });
});
