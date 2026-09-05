/**
 * Presence Domain & Store Unit Tests (M2 Phase A1)
 *
 * Verifies PresenceStore state transitions, hand raise queue ordering,
 * active speaker propagation, host leadership, toast queuing, and
 * ConnectionQualityAggregator deterministic tier evaluations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePresenceStore } from '../src/presence/presenceStore';
import { ConnectionQualityAggregator } from '../src/presence/connectionQuality';

describe('M2 Phase A1: Presence Domain & Store', () => {
  beforeEach(() => {
    usePresenceStore.getState().resetPresence();
  });

  it('A1-1: Manages local participant and automatic initial host election', () => {
    const store = usePresenceStore.getState();

    store.setLocalParticipant({
      id: 'alice-1',
      name: 'Alice Local',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: false,
      joinedAt: 1000,
    });

    const state = usePresenceStore.getState();
    expect(state.localParticipantId).toBe('alice-1');
    expect(state.hostId).toBe('alice-1'); // First participant elected host
    expect(state.participants.get('alice-1')?.isHost).toBe(true);
    expect(state.participants.get('alice-1')?.isLocal).toBe(true);
  });

  it('A1-2: Upserts remote participants without displacing existing host', () => {
    const store = usePresenceStore.getState();

    // Alice joins first as host
    store.setLocalParticipant({
      id: 'alice-1',
      name: 'Alice',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: 1000,
    });

    // Bob joins second
    store.upsertParticipant({
      id: 'bob-2',
      name: 'Bob Remote',
      isLocal: false,
      audioEnabled: false,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: 2000,
    });

    const state = usePresenceStore.getState();
    expect(state.participants.size).toBe(2);
    expect(state.hostId).toBe('alice-1');
    expect(state.participants.get('bob-2')?.isHost).toBe(false);
  });

  it('A1-3: Propagates active speaker set to individual participant flags', () => {
    const store = usePresenceStore.getState();

    store.upsertParticipant({
      id: 'user-1',
      name: 'User One',
      isLocal: true,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: 1000,
    });

    store.upsertParticipant({
      id: 'user-2',
      name: 'User Two',
      isLocal: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'good',
      isHandRaised: false,
      isHost: false,
      joinedAt: 2000,
    });

    // User Two starts speaking
    store.setActiveSpeakers(['user-2']);

    let state = usePresenceStore.getState();
    expect(state.activeSpeakers.has('user-2')).toBe(true);
    expect(state.participants.get('user-2')?.isSpeaking).toBe(true);
    expect(state.participants.get('user-1')?.isSpeaking).toBe(false);

    // Both speaking
    store.setActiveSpeakers(['user-1', 'user-2']);
    state = usePresenceStore.getState();
    expect(state.participants.get('user-1')?.isSpeaking).toBe(true);
    expect(state.participants.get('user-2')?.isSpeaking).toBe(true);

    // Silence
    store.setActiveSpeakers([]);
    state = usePresenceStore.getState();
    expect(state.participants.get('user-1')?.isSpeaking).toBe(false);
    expect(state.participants.get('user-2')?.isSpeaking).toBe(false);
  });

  it('A1-4: Manages chronological hand raise queue and lowerAllHands', () => {
    const store = usePresenceStore.getState();

    store.upsertParticipant({
      id: 'charlie',
      name: 'Charlie',
      isLocal: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: 1000,
    });

    store.upsertParticipant({
      id: 'dave',
      name: 'Dave',
      isLocal: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: false,
      joinedAt: 1000,
    });

    // Dave raises hand at t=100
    store.setHandRaised('dave', true, 100);
    // Charlie raises hand at t=150
    store.setHandRaised('charlie', true, 150);

    let state = usePresenceStore.getState();
    expect(state.raisedHands.length).toBe(2);
    expect(state.raisedHands[0].participantId).toBe('dave'); // Earlier timestamp first
    expect(state.raisedHands[1].participantId).toBe('charlie');
    expect(state.participants.get('dave')?.isHandRaised).toBe(true);

    // Dave lowers hand
    store.setHandRaised('dave', false);
    state = usePresenceStore.getState();
    expect(state.raisedHands.length).toBe(1);
    expect(state.raisedHands[0].participantId).toBe('charlie');
    expect(state.participants.get('dave')?.isHandRaised).toBe(false);

    // Host lowers all hands
    store.lowerAllHands();
    state = usePresenceStore.getState();
    expect(state.raisedHands.length).toBe(0);
    expect(state.participants.get('charlie')?.isHandRaised).toBe(false);
  });

  it('A1-5: Ephemeral toast queueing and capacity capping', () => {
    const store = usePresenceStore.getState();

    store.pushToast({ type: 'join', title: 'User 1 joined', durationMs: 4000 });
    store.pushToast({ type: 'join', title: 'User 2 joined', durationMs: 4000 });
    store.pushToast({ type: 'leave', title: 'User 3 left', durationMs: 4000 });
    store.pushToast({ type: 'hand', title: 'User 4 raised hand', durationMs: 4000 });
    store.pushToast({ type: 'host', title: 'User 5 is host', durationMs: 4000 });

    let state = usePresenceStore.getState();
    expect(state.toastQueue.length).toBe(5);

    // Push 6th toast: should cap at max 5
    store.pushToast({ type: 'info', title: 'User 6 info', durationMs: 4000 });
    state = usePresenceStore.getState();
    expect(state.toastQueue.length).toBe(5);
    expect(state.toastQueue[4].title).toBe('User 6 info');

    // Dismiss specific toast
    const firstId = state.toastQueue[0].id;
    store.dismissToast(firstId);
    state = usePresenceStore.getState();
    expect(state.toastQueue.length).toBe(4);
    expect(state.toastQueue.find((t) => t.id === firstId)).toBeUndefined();

    // Clear all
    store.clearToasts();
    expect(usePresenceStore.getState().toastQueue.length).toBe(0);
  });

  it('A1-6: Host migration upon current host disconnection', () => {
    const store = usePresenceStore.getState();

    store.upsertParticipant({
      id: 'host-alice',
      name: 'Alice',
      isLocal: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: 1000,
    });

    store.upsertParticipant({
      id: 'user-bob',
      name: 'Bob',
      isLocal: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: false,
      joinedAt: 2000,
    });

    expect(usePresenceStore.getState().hostId).toBe('host-alice');

    // Alice disconnects
    store.removeParticipant('host-alice');

    const state = usePresenceStore.getState();
    expect(state.participants.has('host-alice')).toBe(false);
    expect(state.hostId).toBe('user-bob');
    expect(state.participants.get('user-bob')?.isHost).toBe(true);
  });

  it('A1-7: ConnectionQualityAggregator produces deterministic, vendor-agnostic ratings', () => {
    // 1. Excellent: RTT <= 80ms, loss <= 0.8%
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 35, packetLossPct: 0.1 })).toBe('excellent');

    // 2. Good: RTT 110ms, loss 0.5%
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 110, packetLossPct: 0.5 })).toBe('good');

    // 3. Fair: RTT 220ms OR loss 4.0%
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 220, packetLossPct: 1.0 })).toBe('fair');
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 60, packetLossPct: 3.5 })).toBe('fair');

    // 4. Poor: RTT 400ms OR loss 10.0%
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 400, packetLossPct: 0.5 })).toBe('poor');
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 50, packetLossPct: 9.0 })).toBe('poor');

    // 5. Disconnected: ICE failed or loss >= 50%
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 40, packetLossPct: 0.0, iceState: 'disconnected' })).toBe('disconnected');
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 40, packetLossPct: 0.0, iceState: 'failed' })).toBe('disconnected');
    expect(ConnectionQualityAggregator.evaluate({ rttMs: 40, packetLossPct: 55.0 })).toBe('disconnected');

    // Details helper
    const excellentDetails = ConnectionQualityAggregator.getRatingDetails('excellent');
    expect(excellentDetails.label).toBe('Excellent');
    expect(excellentDetails.bars).toBe(4);

    const poorDetails = ConnectionQualityAggregator.getRatingDetails('poor');
    expect(poorDetails.label).toBe('Poor');
    expect(poorDetails.bars).toBe(1);
  });
});
