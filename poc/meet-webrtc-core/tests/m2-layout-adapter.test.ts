import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { LayoutAdapter, SPOTLIGHT_TOPIC } from '../src/layout/layoutAdapter';
import { useLayoutStore } from '../src/layout/layoutStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { Track } from 'livekit-client';

class MockLiveKitRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-alice',
    name: 'Alice Local',
    isScreenShareEnabled: false,
    publishData: vi.fn().mockResolvedValue(undefined),
  };

  remoteParticipants: Map<string, any> = new Map();
}

describe('M2 Phase B: LiveKit Layout Adapter', () => {
  let mockRoom: MockLiveKitRoom;
  let adapter: LayoutAdapter;

  beforeEach(() => {
    useLayoutStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    mockRoom = new MockLiveKitRoom();
    adapter = new LayoutAdapter();
  });

  afterEach(() => {
    adapter.detach();
  });

  it('B-1: Translates remote screen share track subscription to content mode', () => {
    adapter.attach(mockRoom as any);
    expect(useLayoutStore.getState().mode).toBe('gallery');

    const mockTrack = { source: Track.Source.ScreenShare };
    const mockPublication = {};
    const mockParticipant = { identity: 'remote-bob' };

    mockRoom.emit('trackSubscribed', mockTrack, mockPublication, mockParticipant);

    expect(useLayoutStore.getState().screenShareOwnerId).toBe('remote-bob');
    expect(useLayoutStore.getState().mode).toBe('content');

    // Remote screen share unpublishes
    mockRoom.emit('trackUnsubscribed', mockTrack, mockPublication, mockParticipant);
    expect(useLayoutStore.getState().screenShareOwnerId).toBeNull();
    expect(useLayoutStore.getState().mode).toBe('gallery');
  });

  it('B-2: Handles local screen share published and unpublished events', () => {
    adapter.attach(mockRoom as any);
    useLayoutStore.getState().setLayoutMode('speaker');

    mockRoom.emit('localTrackPublished', { source: Track.Source.ScreenShare });
    expect(useLayoutStore.getState().screenShareOwnerId).toBe('local-alice');
    expect(useLayoutStore.getState().mode).toBe('content');
    expect(useLayoutStore.getState().previousMode).toBe('speaker');

    mockRoom.emit('localTrackUnpublished', { source: Track.Source.ScreenShare });
    expect(useLayoutStore.getState().screenShareOwnerId).toBeNull();
    expect(useLayoutStore.getState().mode).toBe('speaker');
  });

  it('B-3: Synchronizes active speakers from PresenceStore', () => {
    adapter.attach(mockRoom as any);

    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    usePresenceStore.getState().setActiveSpeakers(['remote-charlie']);
    expect(useLayoutStore.getState().activeSpeakerId).toBe('remote-charlie');
  });

  it('B-4: Processes host spotlight broadcast via DataChannel', () => {
    adapter.attach(mockRoom as any);

    // Setup host identity in presence
    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice',
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
        type: 'spotlight',
        participantId: 'remote-david',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit('dataReceived', payload, { identity: 'local-alice' }, undefined, SPOTLIGHT_TOPIC);
    expect(useLayoutStore.getState().spotlightParticipantId).toBe('remote-david');
  });

  it('B-5: Ignores unauthorized spotlight messages from non-host participants', () => {
    adapter.attach(mockRoom as any);

    usePresenceStore.getState().setLocalParticipant({
      id: 'local-alice',
      name: 'Alice',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isSpeaking: false,
      connectionQuality: 'excellent',
      isHandRaised: false,
      isHost: true,
      joinedAt: Date.now(),
    });

    // Remote non-host attempts to spotlight
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'spotlight',
        participantId: 'remote-eve',
        timestamp: Date.now(),
      })
    );

    mockRoom.emit('dataReceived', payload, { identity: 'remote-eve' }, undefined, SPOTLIGHT_TOPIC);
    // Should still be null because remote-eve is not the host
    expect(useLayoutStore.getState().spotlightParticipantId).toBeNull();
  });

  it('B-6: Detaches listeners cleanly', () => {
    adapter.attach(mockRoom as any);
    expect(mockRoom.listenerCount('trackSubscribed')).toBeGreaterThan(0);

    adapter.detach();
    expect(mockRoom.listenerCount('trackSubscribed')).toBe(0);
    expect(mockRoom.listenerCount('dataReceived')).toBe(0);
  });
});
