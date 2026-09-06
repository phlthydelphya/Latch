// tests/m3b-subscription-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SubscriptionManager } from '../src/webrtc/subscriptionManager';
import { useLayoutStore } from '../src/layout/layoutStore';
import { Track, VideoQuality } from 'livekit-client';

class MockPublication {
  kind: Track.Kind;
  isSubscribed: boolean;
  videoQuality?: VideoQuality;
  setSubscribed = vi.fn((sub: boolean) => {
    this.isSubscribed = sub;
  });
  setVideoQuality = vi.fn((q: VideoQuality) => {
    this.videoQuality = q;
  });

  constructor(kind: Track.Kind, isSubscribed = true) {
    this.kind = kind;
    this.isSubscribed = isSubscribed;
  }
}

class MockParticipant {
  identity: string;
  trackPublications: Map<string, MockPublication> = new Map();

  constructor(identity: string) {
    this.identity = identity;
    this.trackPublications.set('audio-1', new MockPublication(Track.Kind.Audio, true));
    this.trackPublications.set('video-1', new MockPublication(Track.Kind.Video, true));
  }
}

class MockRoom extends EventEmitter {
  remoteParticipants: Map<string, MockParticipant> = new Map();
}

describe('M3B: Subscription Manager & Last-N Gating', () => {
  let mockRoom: MockRoom;
  let manager: SubscriptionManager;

  beforeEach(() => {
    useLayoutStore.getState().reset();
    mockRoom = new MockRoom();

    // Populate 20 remote participants (p-1 to p-20)
    for (let i = 1; i <= 20; i++) {
      const id = `p-${i}`;
      mockRoom.remoteParticipants.set(id, new MockParticipant(id));
    }

    manager = new SubscriptionManager();
  });

  afterEach(() => {
    manager.detach();
  });

  it('keeps all audio tracks 100% subscribed regardless of participant count', () => {
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3', 'p-4'],
    });

    manager.attach(mockRoom as any);

    for (const participant of mockRoom.remoteParticipants.values()) {
      const audioPub = participant.trackPublications.get('audio-1');
      expect(audioPub?.isSubscribed).toBe(true);
    }
  });

  it('subscribes only visible tiles and stage participant for video', () => {
    // Page 0 visible: p-1 through p-9
    const visibleIds = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9'];
    useLayoutStore.setState({
      visibleTileIds: visibleIds,
      pinnedParticipantId: 'p-1', // stage participant
    });

    manager.attach(mockRoom as any);

    // Visible tiles should have video subscribed
    for (const id of visibleIds) {
      const p = mockRoom.remoteParticipants.get(id)!;
      const videoPub = p.trackPublications.get('video-1')!;
      expect(videoPub.isSubscribed).toBe(true);
    }

    // Off-page tiles (p-10 to p-20) must have video un-subscribed (setSubscribed(false))
    for (let i = 10; i <= 20; i++) {
      const p = mockRoom.remoteParticipants.get(`p-${i}`)!;
      const videoPub = p.trackPublications.get('video-1')!;
      expect(videoPub.setSubscribed).toHaveBeenCalledWith(false);
      expect(videoPub.isSubscribed).toBe(false);
    }
  });

  it('assigns VideoQuality.HIGH to stage participant and VideoQuality.LOW to gallery peers', () => {
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9'],
      spotlightParticipantId: 'p-2', // stage spotlight
    });

    manager.attach(mockRoom as any);

    const stageUser = mockRoom.remoteParticipants.get('p-2')!;
    const stageVideo = stageUser.trackPublications.get('video-1')!;
    expect(stageVideo.setVideoQuality).toHaveBeenCalledWith(VideoQuality.HIGH);

    const galleryPeer = mockRoom.remoteParticipants.get('p-1')!;
    const galleryVideo = galleryPeer.trackPublications.get('video-1')!;
    expect(galleryVideo.setVideoQuality).toHaveBeenCalledWith(VideoQuality.LOW);
  });

  it('transitions video subscriptions when user navigates gallery pages', () => {
    // Page 0
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3'],
    });
    manager.attach(mockRoom as any);

    expect(mockRoom.remoteParticipants.get('p-1')!.trackPublications.get('video-1')!.isSubscribed).toBe(true);
    expect(mockRoom.remoteParticipants.get('p-4')!.trackPublications.get('video-1')!.isSubscribed).toBe(false);

    // Navigate to Page 1
    useLayoutStore.setState({
      visibleTileIds: ['p-4', 'p-5', 'p-6'],
    });

    expect(mockRoom.remoteParticipants.get('p-1')!.trackPublications.get('video-1')!.isSubscribed).toBe(false);
    expect(mockRoom.remoteParticipants.get('p-4')!.trackPublications.get('video-1')!.isSubscribed).toBe(true);
  });

  it('pauses all remote video tracks when bandwidth tier is emergency-audio-only', () => {
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3'],
      bandwidthTier: 'emergency-audio-only',
    });

    manager.attach(mockRoom as any);

    for (const participant of mockRoom.remoteParticipants.values()) {
      const videoPub = participant.trackPublications.get('video-1')!;
      expect(videoPub.isSubscribed).toBe(false);

      // Audio must STILL be subscribed!
      const audioPub = participant.trackPublications.get('audio-1')!;
      expect(audioPub.isSubscribed).toBe(true);
    }
  });

  it('M3B-5: Off-Page Active Speaker Promotion (DC-1)', () => {
    // Page 0 visible: p-1 through p-4
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3', 'p-4'],
      activeSpeakerId: 'p-15', // Speaker is off-page on Page 2
      speakerConfidence: 0.85,
    });

    manager.attach(mockRoom as any);

    // Speaker p-15 must be subscribed even though not in visibleTileIds
    const speakerVideo = mockRoom.remoteParticipants.get('p-15')!.trackPublications.get('video-1')!;
    expect(speakerVideo.isSubscribed).toBe(true);

    // Other off-page participants remain unsubscribed
    const offPageVideo = mockRoom.remoteParticipants.get('p-16')!.trackPublications.get('video-1')!;
    expect(offPageVideo.isSubscribed).toBe(false);
  });

  it('M3B-6: Spotlight Override preserves priority subscription regardless of page (DC-1 & DC-3)', () => {
    useLayoutStore.setState({
      visibleTileIds: ['p-1', 'p-2', 'p-3', 'p-4'],
      spotlightParticipantId: 'p-19', // Host spotlights off-page participant
    });

    manager.attach(mockRoom as any);

    const spotlightVideo = mockRoom.remoteParticipants.get('p-19')!.trackPublications.get('video-1')!;
    expect(spotlightVideo.isSubscribed).toBe(true);
    expect(spotlightVideo.setVideoQuality).toHaveBeenCalledWith(VideoQuality.HIGH);

    // DC-3: Check subscription policies map
    const policies = manager.getSubscriptionPolicies();
    expect(policies.get('p-19')).toEqual({
      subscribed: true,
      quality: VideoQuality.HIGH,
    });
  });

  it('contracts effective Last-N under moderate and severe congestion (DC-2)', () => {
    const visibleIds = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9'];

    // 1. Moderate Congestion (Effective N = 6)
    useLayoutStore.setState({
      visibleTileIds: visibleIds,
      bandwidthTier: 'congested-moderate',
    });
    manager.attach(mockRoom as any);

    const statsMod = manager.getSubscriptionStats();
    expect(statsMod.videoSubscribed).toBe(6);

    // 2. Severe Congestion (Effective N = 4)
    useLayoutStore.setState({
      bandwidthTier: 'congested-severe',
    });
    const statsSev = manager.getSubscriptionStats();
    expect(statsSev.videoSubscribed).toBe(4);
  });

  it('cleans up store listeners and room references on detach', () => {
    manager.attach(mockRoom as any);
    manager.detach();

    // Updating store should no longer trigger evaluations
    const p1 = mockRoom.remoteParticipants.get('p-1')!;
    const videoPub = p1.trackPublications.get('video-1')!;
    videoPub.setSubscribed.mockClear();

    useLayoutStore.setState({
      visibleTileIds: ['p-10'],
    });

    expect(videoPub.setSubscribed).not.toHaveBeenCalled();
  });
});
