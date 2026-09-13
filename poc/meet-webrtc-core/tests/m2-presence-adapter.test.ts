/**
 * LiveKit Presence Adapter Tests (M2 Phase A2)
 *
 * Verifies that PresenceAdapter correctly translates LiveKit room events
 * and DataChannel messages into PresenceStore state updates and toasts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PresenceAdapter, HAND_RAISE_TOPIC } from '../src/presence/presenceAdapter';
import { usePresenceStore } from '../src/presence/presenceStore';
import { ConnectionQuality as LKConnectionQuality } from 'livekit-client';

class MockLiveKitRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-alice',
    name: 'Alice Local',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    isScreenShareEnabled: false,
    isSpeaking: false,
    connectionQuality: LKConnectionQuality.Excellent,
    publishData: vi.fn().mockResolvedValue(undefined),
  };

  remoteParticipants: Map<string, any> = new Map();
}

describe('M2 Phase A2: LiveKit Presence Adapter', () => {
  let mockRoom: MockLiveKitRoom;
  let adapter: PresenceAdapter;

  beforeEach(() => {
    usePresenceStore.getState().resetPresence();
    mockRoom = new MockLiveKitRoom();
    adapter = new PresenceAdapter();
  });

  afterEach(() => {
    adapter.detach();
  });

  it('A2-1: Synchronizes initial local participant on attach', () => {
    adapter.attach(mockRoom as any);

    const state = usePresenceStore.getState();
    expect(state.localParticipantId).toBe('local-alice');
    expect(state.participants.has('local-alice')).toBe(true);
    expect(state.participants.get('local-alice')?.name).toBe('Alice Local');
    expect(state.participants.get('local-alice')?.connectionQuality).toBe('excellent');
  });

  it('A2-2: Translates ParticipantConnected into presence upsert and join toast', () => {
    adapter.attach(mockRoom as any);

    const remoteBob = {
      identity: 'remote-bob',
      name: 'Bob Remote',
      isMicrophoneEnabled: false,
      isCameraEnabled: true,
      isScreenShareEnabled: false,
      isSpeaking: false,
      connectionQuality: LKConnectionQuality.Good,
    };

    mockRoom.emit('participantConnected', remoteBob);

    const state = usePresenceStore.getState();
    expect(state.participants.has('remote-bob')).toBe(true);
    expect(state.participants.get('remote-bob')?.connectionQuality).toBe('good');

    expect(state.toastQueue.length).toBe(1);
    expect(state.toastQueue[0].type).toBe('join');
    expect(state.toastQueue[0].title).toBe('Bob Remote joined');
  });

  it('A2-3: Translates ParticipantDisconnected into removal and leave toast', () => {
    adapter.attach(mockRoom as any);

    const remoteBob = {
      identity: 'remote-bob',
      name: 'Bob Remote',
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      isScreenShareEnabled: false,
      isSpeaking: false,
      connectionQuality: LKConnectionQuality.Good,
    };

    mockRoom.emit('participantConnected', remoteBob);
    expect(usePresenceStore.getState().participants.has('remote-bob')).toBe(true);

    mockRoom.emit('participantDisconnected', remoteBob);

    const state = usePresenceStore.getState();
    expect(state.participants.has('remote-bob')).toBe(false);

    const leaveToast = state.toastQueue.find((t) => t.type === 'leave');
    expect(leaveToast).toBeDefined();
    expect(leaveToast?.title).toBe('Bob Remote left');
  });

  it('A2-4: Translates ActiveSpeakersChanged event into store updates', () => {
    adapter.attach(mockRoom as any);

    const remoteBob = { identity: 'remote-bob', name: 'Bob' };
    mockRoom.emit('participantConnected', remoteBob);

    mockRoom.emit('activeSpeakersChanged', [remoteBob]);

    const state = usePresenceStore.getState();
    expect(state.activeSpeakers.has('remote-bob')).toBe(true);
    expect(state.participants.get('remote-bob')?.isSpeaking).toBe(true);

    mockRoom.emit('activeSpeakersChanged', []);
    expect(usePresenceStore.getState().activeSpeakers.size).toBe(0);
  });

  it('A2-5: Receives and processes hand-raise DataChannel events', () => {
    adapter.attach(mockRoom as any);

    const remoteBob = { identity: 'remote-bob', name: 'Bob' };
    mockRoom.emit('participantConnected', remoteBob);

    // Incoming hand raise
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'hand-raise',
        participantId: 'remote-bob',
        raised: true,
        timestamp: 5000,
      })
    );

    mockRoom.emit('dataReceived', payload, remoteBob, null, HAND_RAISE_TOPIC);

    const state = usePresenceStore.getState();
    expect(state.participants.get('remote-bob')?.isHandRaised).toBe(true);
    expect(state.raisedHands.length).toBe(1);
    expect(state.raisedHands[0].participantId).toBe('remote-bob');

    const handToast = state.toastQueue.find((t) => t.type === 'hand');
    expect(handToast).toBeDefined();
    expect(handToast?.title).toBe('Bob raised hand');
  });

  it('A2-6: Publishes local hand raise over reliable DataChannel', async () => {
    adapter.attach(mockRoom as any);

    await adapter.publishHandRaise(true);

    expect(mockRoom.localParticipant.publishData).toHaveBeenCalledTimes(1);
    const [payload, options] = mockRoom.localParticipant.publishData.mock.calls[0];

    expect(options.reliable).toBe(true);
    expect(options.topic).toBe(HAND_RAISE_TOPIC);

    const data = JSON.parse(new TextDecoder().decode(payload));
    expect(data.type).toBe('hand-raise');
    expect(data.participantId).toBe('local-alice');
    expect(data.raised).toBe(true);

    // Local state updated
    expect(usePresenceStore.getState().participants.get('local-alice')?.isHandRaised).toBe(true);
  });

  it('UX-C06: a second client reflects remote publication mute and unmute events', () => {
    adapter.attach(mockRoom as any);
    const remoteBob = {
      identity: 'remote-bob', name: 'Bob Remote', isMicrophoneEnabled: true,
      isCameraEnabled: true, isScreenShareEnabled: false, isSpeaking: false,
      connectionQuality: LKConnectionQuality.Good,
    };
    mockRoom.emit('participantConnected', remoteBob);
    mockRoom.emit('trackMuted', { kind: 'audio', source: 'microphone' }, remoteBob);
    mockRoom.emit('trackMuted', { kind: 'video', source: 'camera' }, remoteBob);
    expect(usePresenceStore.getState().participants.get('remote-bob')?.audioEnabled).toBe(false);
    expect(usePresenceStore.getState().participants.get('remote-bob')?.videoEnabled).toBe(false);
    mockRoom.emit('trackUnmuted', { kind: 'audio', source: 'microphone' }, remoteBob);
    mockRoom.emit('trackUnmuted', { kind: 'video', source: 'camera' }, remoteBob);
    expect(usePresenceStore.getState().participants.get('remote-bob')?.audioEnabled).toBe(true);
    expect(usePresenceStore.getState().participants.get('remote-bob')?.videoEnabled).toBe(true);
  });
});
