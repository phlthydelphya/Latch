/**
 * M4A-MEDIA Roster Media State Tests
 *
 * PM-mandated acceptance tests for reactive microphone/camera synchronization.
 * Tests: M4A-MEDIA-01 through M4A-MEDIA-05
 *
 * Spec IDs map directly to PM directive issued 2026-09-06.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePresenceStore } from '../src/presence/presenceStore';
import type { TrackMediaState } from '../src/presence/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParticipant(
  id: string,
  microphoneState: TrackMediaState,
  cameraState: TrackMediaState
) {
  return {
    id,
    name: `User-${id}`,
    isLocal: false,
    microphoneState,
    cameraState,
    audioEnabled: microphoneState === 'on',
    videoEnabled: cameraState === 'on',
    screenSharing: false,
    isSpeaking: false,
    connectionQuality: 'good' as const,
    isHandRaised: false,
    isHost: false,
    joinedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  usePresenceStore.getState().resetPresence();
});

// ---------------------------------------------------------------------------
// M4A-MEDIA-01: Microphone State Lifecycle
// ---------------------------------------------------------------------------

describe('M4A-MEDIA-01: Microphone state', () => {
  it('participant joins with microphone enabled → roster shows microphone on', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('alice', 'on', 'on'));
    const p = usePresenceStore.getState().participants.get('alice')!;
    expect(p.microphoneState).toBe('on');
    expect(p.audioEnabled).toBe(true);
  });

  it('participant mutes → roster shows muted (publication still exists)', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('alice', 'on', 'on'));
    // TrackMuted fires → updateParticipantTracks with microphoneState: 'muted'
    usePresenceStore.getState().updateParticipantTracks('alice', { microphoneState: 'muted' });
    const p = usePresenceStore.getState().participants.get('alice')!;
    expect(p.microphoneState).toBe('muted');
    expect(p.audioEnabled).toBe(false);
    // Must not be 'unavailable' — publication still exists, just muted
    expect(p.microphoneState).not.toBe('unavailable');
  });

  it('participant unmutes → roster shows microphone on', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('alice', 'on', 'on'));
    usePresenceStore.getState().updateParticipantTracks('alice', { microphoneState: 'muted' });
    // TrackUnmuted fires → updateParticipantTracks with microphoneState: 'on'
    usePresenceStore.getState().updateParticipantTracks('alice', { microphoneState: 'on' });
    const p = usePresenceStore.getState().participants.get('alice')!;
    expect(p.microphoneState).toBe('on');
    expect(p.audioEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M4A-MEDIA-02: Camera State Lifecycle
// ---------------------------------------------------------------------------

describe('M4A-MEDIA-02: Camera state', () => {
  it('participant joins with camera enabled → roster shows camera on', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('bob', 'on', 'on'));
    const p = usePresenceStore.getState().participants.get('bob')!;
    expect(p.cameraState).toBe('on');
    expect(p.videoEnabled).toBe(true);
  });

  it('participant disables camera → roster shows camera muted', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('bob', 'on', 'on'));
    // TrackMuted (video) fires → cameraState: 'muted'
    usePresenceStore.getState().updateParticipantTracks('bob', { cameraState: 'muted' });
    const p = usePresenceStore.getState().participants.get('bob')!;
    expect(p.cameraState).toBe('muted');
    expect(p.videoEnabled).toBe(false);
  });

  it('participant enables camera → roster shows camera on', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('bob', 'on', 'on'));
    usePresenceStore.getState().updateParticipantTracks('bob', { cameraState: 'muted' });
    // TrackUnmuted (video) fires → cameraState: 'on'
    usePresenceStore.getState().updateParticipantTracks('bob', { cameraState: 'on' });
    const p = usePresenceStore.getState().participants.get('bob')!;
    expect(p.cameraState).toBe('on');
    expect(p.videoEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M4A-MEDIA-03: Publication Lifecycle (TrackPublished / TrackUnpublished)
// ---------------------------------------------------------------------------

describe('M4A-MEDIA-03: Publication lifecycle', () => {
  it('track unpublished → roster shows unavailable (distinct from muted)', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('carol', 'on', 'on'));
    // TrackUnpublished fires → setParticipantMediaState with 'unavailable'
    usePresenceStore.getState().setParticipantMediaState('carol', 'unavailable', 'unavailable');
    const p = usePresenceStore.getState().participants.get('carol')!;
    expect(p.microphoneState).toBe('unavailable');
    expect(p.cameraState).toBe('unavailable');
    expect(p.audioEnabled).toBe(false);
    expect(p.videoEnabled).toBe(false);
  });

  it('"unavailable" is distinct from "muted" in the canonical state', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('carol', 'on', 'on'));
    // Mute path
    usePresenceStore.getState().updateParticipantTracks('carol', { microphoneState: 'muted' });
    const mutedP = usePresenceStore.getState().participants.get('carol')!;
    expect(mutedP.microphoneState).toBe('muted');

    // Unpublish path
    usePresenceStore.getState().setParticipantMediaState('carol', 'unavailable', mutedP.cameraState);
    const unpubP = usePresenceStore.getState().participants.get('carol')!;
    expect(unpubP.microphoneState).toBe('unavailable');
    // Both produce audioEnabled: false — but canonical state differs
    expect(mutedP.audioEnabled).toBe(false);
    expect(unpubP.audioEnabled).toBe(false);
    expect(mutedP.microphoneState).not.toBe(unpubP.microphoneState);
  });

  it('track republished → state returns to current publication state', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('carol', 'on', 'on'));
    usePresenceStore.getState().setParticipantMediaState('carol', 'unavailable', 'unavailable');
    // TrackPublished fires → setParticipantMediaState with actual pub state (e.g. 'on')
    usePresenceStore.getState().setParticipantMediaState('carol', 'on', 'on');
    const p = usePresenceStore.getState().participants.get('carol')!;
    expect(p.microphoneState).toBe('on');
    expect(p.cameraState).toBe('on');
    expect(p.audioEnabled).toBe(true);
    expect(p.videoEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M4A-MEDIA-04: Multiple Participants — State Isolation
// ---------------------------------------------------------------------------

describe('M4A-MEDIA-04: Multiple participants — state isolation', () => {
  it('each roster row reflects only its matching participant state', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('p1', 'on', 'on'));
    usePresenceStore.getState().upsertParticipant(makeParticipant('p2', 'on', 'on'));
    usePresenceStore.getState().upsertParticipant(makeParticipant('p3', 'on', 'on'));

    // p1 mutes mic
    usePresenceStore.getState().updateParticipantTracks('p1', { microphoneState: 'muted' });
    // p2 turns off camera
    usePresenceStore.getState().updateParticipantTracks('p2', { cameraState: 'muted' });
    // p3 unpublishes both
    usePresenceStore.getState().setParticipantMediaState('p3', 'unavailable', 'unavailable');

    const s = usePresenceStore.getState();
    const p1 = s.participants.get('p1')!;
    const p2 = s.participants.get('p2')!;
    const p3 = s.participants.get('p3')!;

    // p1: mic muted, camera on
    expect(p1.microphoneState).toBe('muted');
    expect(p1.cameraState).toBe('on');

    // p2: mic on, camera muted
    expect(p2.microphoneState).toBe('on');
    expect(p2.cameraState).toBe('muted');

    // p3: both unavailable
    expect(p3.microphoneState).toBe('unavailable');
    expect(p3.cameraState).toBe('unavailable');

    // No cross-contamination
    expect(p1.cameraState).not.toBe('muted');
    expect(p2.microphoneState).not.toBe('muted');
    expect(p1.microphoneState).not.toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// M4A-MEDIA-05: Reconnect Reconciliation
// ---------------------------------------------------------------------------

describe('M4A-MEDIA-05: Reconnect reconciliation', () => {
  it('stale state is replaced by current LiveKit publication state on reconnect', () => {
    // Participant joins with mic on
    usePresenceStore.getState().upsertParticipant(makeParticipant('dave', 'on', 'on'));

    // They mute during the session
    usePresenceStore.getState().updateParticipantTracks('dave', { microphoneState: 'muted' });

    // They disconnect
    usePresenceStore.getState().removeParticipant('dave');
    expect(usePresenceStore.getState().participants.has('dave')).toBe(false);

    // They reconnect — adapter calls upsertParticipant with current LiveKit publication state
    // (camera was off when they reconnected)
    usePresenceStore.getState().upsertParticipant(makeParticipant('dave', 'muted', 'unavailable'));

    const p = usePresenceStore.getState().participants.get('dave')!;
    // State reflects reconnected state, not stale pre-disconnect state
    expect(p.microphoneState).toBe('muted');
    expect(p.cameraState).toBe('unavailable');
    expect(p.audioEnabled).toBe(false);
    expect(p.videoEnabled).toBe(false);
  });

  it('reconnect with different media state fully replaces old entry', () => {
    usePresenceStore.getState().upsertParticipant(makeParticipant('eve', 'on', 'on'));
    usePresenceStore.getState().removeParticipant('eve');

    // Reconnects with mic on but camera unavailable
    usePresenceStore.getState().upsertParticipant(makeParticipant('eve', 'on', 'unavailable'));
    const p = usePresenceStore.getState().participants.get('eve')!;
    expect(p.microphoneState).toBe('on');
    expect(p.cameraState).toBe('unavailable');
    expect(p.audioEnabled).toBe(true);
    expect(p.videoEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derived boolean consistency invariant
// ---------------------------------------------------------------------------

describe('Derived boolean invariant', () => {
  it('audioEnabled is always === (microphoneState === "on")', () => {
    const states: TrackMediaState[] = ['on', 'muted', 'unavailable'];
    for (const mic of states) {
      for (const cam of states) {
        usePresenceStore.getState().resetPresence();
        usePresenceStore.getState().upsertParticipant(makeParticipant('x', mic, cam));
        const p = usePresenceStore.getState().participants.get('x')!;
        expect(p.audioEnabled).toBe(mic === 'on');
        expect(p.videoEnabled).toBe(cam === 'on');
      }
    }
  });
});
