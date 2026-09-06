// tests/m3a-layout-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LayoutEngine, DEFAULT_LAYOUT_WEIGHTS } from '../src/layout/layoutEngine';

describe('M3A: Layout Engine & Deterministic Scoring', () => {
  let engine: LayoutEngine;

  beforeEach(() => {
    engine = new LayoutEngine();
  });

  it('resolves gallery mode when no shares, spotlights, or speakers are active', () => {
    const scores = engine.evaluate({
      hasScreenShare: false,
      screenShareOwnerId: null,
      spotlightParticipantId: null,
      pinnedParticipantId: null,
      activeSpeakerId: null,
      speakerConfidence: 0,
      userLockedMode: null,
      totalParticipants: 4,
    });

    expect(scores.resolvedMode).toBe('gallery');
    expect(scores.galleryScore).toBe(DEFAULT_LAYOUT_WEIGHTS.baseGalleryScore);
    expect(scores.presentationScore).toBe(0);
    expect(scores.spotlightScore).toBe(0);
    expect(scores.speakerScore).toBe(0);
  });

  it('promotes content mode when screen sharing is active (highest priority)', () => {
    const scores = engine.evaluate({
      hasScreenShare: true,
      screenShareOwnerId: 'p-sharer',
      spotlightParticipantId: 'p-spotlight',
      pinnedParticipantId: null,
      activeSpeakerId: 'p-speaker',
      speakerConfidence: 0.9,
      userLockedMode: null,
      totalParticipants: 6,
    });

    expect(scores.resolvedMode).toBe('content');
    expect(scores.presentationScore).toBe(DEFAULT_LAYOUT_WEIGHTS.weightScreenShare);
    expect(scores.presentationScore).toBeGreaterThan(scores.spotlightScore);
    expect(scores.presentationScore).toBeGreaterThan(scores.speakerScore);
  });

  it('promotes speaker mode when spotlight is active in the absence of screen sharing', () => {
    const scores = engine.evaluate({
      hasScreenShare: false,
      screenShareOwnerId: null,
      spotlightParticipantId: 'p-host-star',
      pinnedParticipantId: null,
      activeSpeakerId: 'p-someone-talking',
      speakerConfidence: 0.8,
      userLockedMode: null,
      totalParticipants: 5,
    });

    expect(scores.resolvedMode).toBe('speaker');
    expect(scores.spotlightScore).toBe(DEFAULT_LAYOUT_WEIGHTS.weightSpotlight);
    expect(scores.spotlightScore).toBeGreaterThan(scores.speakerScore);
    expect(scores.spotlightScore).toBeGreaterThan(scores.galleryScore);
  });

  it('promotes speaker mode when qualified active speaker surpasses gallery base score', () => {
    const scores = engine.evaluate({
      hasScreenShare: false,
      screenShareOwnerId: null,
      spotlightParticipantId: null,
      pinnedParticipantId: null,
      activeSpeakerId: 'p-speaker-1',
      speakerConfidence: 0.85,
      userLockedMode: null,
      totalParticipants: 8,
    });

    expect(scores.resolvedMode).toBe('speaker');
    expect(scores.speakerScore).toBeGreaterThan(scores.galleryScore);
  });

  it('respects user manual lock when screen share is not forcing presentation', () => {
    const scores = engine.evaluate({
      hasScreenShare: false,
      screenShareOwnerId: null,
      spotlightParticipantId: 'p-spotlight',
      pinnedParticipantId: null,
      activeSpeakerId: 'p-speaker',
      speakerConfidence: 0.9,
      userLockedMode: 'gallery',
      totalParticipants: 5,
    });

    expect(scores.resolvedMode).toBe('gallery');
  });

  it('resolves stage participant with strict pin > spotlight > speaker hierarchy', () => {
    // 1. Only speaker
    expect(
      engine.resolveStageParticipant({
        hasScreenShare: false,
        screenShareOwnerId: null,
        spotlightParticipantId: null,
        pinnedParticipantId: null,
        activeSpeakerId: 'p-speaker',
        speakerConfidence: 0.8,
        userLockedMode: null,
        totalParticipants: 4,
      })
    ).toBe('p-speaker');

    // 2. Spotlight overrides speaker
    expect(
      engine.resolveStageParticipant({
        hasScreenShare: false,
        screenShareOwnerId: null,
        spotlightParticipantId: 'p-spotlight',
        pinnedParticipantId: null,
        activeSpeakerId: 'p-speaker',
        speakerConfidence: 0.8,
        userLockedMode: null,
        totalParticipants: 4,
      })
    ).toBe('p-spotlight');

    // 3. Pin overrides spotlight
    expect(
      engine.resolveStageParticipant({
        hasScreenShare: false,
        screenShareOwnerId: null,
        spotlightParticipantId: 'p-spotlight',
        pinnedParticipantId: 'p-pinned',
        activeSpeakerId: 'p-speaker',
        speakerConfidence: 0.8,
        userLockedMode: null,
        totalParticipants: 4,
      })
    ).toBe('p-pinned');
  });

  it('arbitrates LayoutStore mode dynamically via LayoutEngine integration', async () => {
    const { useLayoutStore } = await import('../src/layout/layoutStore');
    const store = useLayoutStore.getState();
    store.reset();

    expect(useLayoutStore.getState().mode).toBe('gallery');

    // 1. Spotlight arbitrates to speaker
    useLayoutStore.getState().setSpotlight('participant-1');
    expect(useLayoutStore.getState().mode).toBe('speaker');

    // 2. Screen share overrides to content
    useLayoutStore.getState().setScreenShareOwner('sharer-1');
    expect(useLayoutStore.getState().mode).toBe('content');

    // 3. Screen share ends -> falls back to speaker because spotlight is active
    useLayoutStore.getState().setScreenShareOwner(null);
    expect(useLayoutStore.getState().mode).toBe('speaker');

    // 4. Spotlight ends -> returns to gallery
    useLayoutStore.getState().setSpotlight(null);
    expect(useLayoutStore.getState().mode).toBe('gallery');

    // 5. User locks to gallery -> spotlight does not override user locked mode
    useLayoutStore.getState().setLayoutMode('gallery');
    useLayoutStore.getState().setSpotlight('participant-2');
    expect(useLayoutStore.getState().mode).toBe('gallery');
  });
});
