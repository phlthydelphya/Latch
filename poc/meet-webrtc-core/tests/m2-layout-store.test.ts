import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../src/layout/layoutStore';

describe('M2 Phase B: LayoutStore', () => {
  beforeEach(() => {
    useLayoutStore.getState().reset();
  });

  it('initializes with default gallery mode and empty pinned/spotlight state', () => {
    const state = useLayoutStore.getState();
    expect(state.mode).toBe('gallery');
    expect(state.previousMode).toBe('gallery');
    expect(state.pinnedParticipantId).toBeNull();
    expect(state.spotlightParticipantId).toBeNull();
    expect(state.activeSpeakerId).toBeNull();
    expect(state.screenShareOwnerId).toBeNull();
    expect(state.galleryPage).toBe(0);
    expect(state.isPipEnabled).toBe(true);
    expect(state.pipPosition).toBe('bottom-right');
  });

  it('switches layout mode and tracks previousMode', () => {
    useLayoutStore.getState().setLayoutMode('speaker');
    expect(useLayoutStore.getState().mode).toBe('speaker');

    // Switch to content
    useLayoutStore.getState().setLayoutMode('content');
    expect(useLayoutStore.getState().mode).toBe('content');
    expect(useLayoutStore.getState().previousMode).toBe('speaker');

    // Switching back to gallery
    useLayoutStore.getState().setLayoutMode('gallery');
    expect(useLayoutStore.getState().mode).toBe('gallery');
    expect(useLayoutStore.getState().previousMode).toBe('content');
  });

  it('pins and unpins a participant (toggle behavior)', () => {
    useLayoutStore.getState().pinParticipant('alice');
    expect(useLayoutStore.getState().pinnedParticipantId).toBe('alice');

    // Pinning same participant unpins
    useLayoutStore.getState().pinParticipant('alice');
    expect(useLayoutStore.getState().pinnedParticipantId).toBeNull();

    // Pinning new participant replaces
    useLayoutStore.getState().pinParticipant('bob');
    expect(useLayoutStore.getState().pinnedParticipantId).toBe('bob');
    useLayoutStore.getState().pinParticipant('charlie');
    expect(useLayoutStore.getState().pinnedParticipantId).toBe('charlie');
  });

  it('sets and clears spotlight', () => {
    useLayoutStore.getState().setSpotlight('alice');
    expect(useLayoutStore.getState().spotlightParticipantId).toBe('alice');

    useLayoutStore.getState().setSpotlight(null);
    expect(useLayoutStore.getState().spotlightParticipantId).toBeNull();
  });

  it('manages screen share owner and auto-transitions mode to and from content', () => {
    useLayoutStore.getState().setLayoutMode('speaker');
    expect(useLayoutStore.getState().mode).toBe('speaker');

    // Screen share starts
    useLayoutStore.getState().setScreenShareOwner('alice');
    expect(useLayoutStore.getState().screenShareOwnerId).toBe('alice');
    expect(useLayoutStore.getState().mode).toBe('content');
    expect(useLayoutStore.getState().previousMode).toBe('speaker');

    // Screen share ends -> restores previousMode
    useLayoutStore.getState().setScreenShareOwner(null);
    expect(useLayoutStore.getState().screenShareOwnerId).toBeNull();
    expect(useLayoutStore.getState().mode).toBe('speaker');
  });

  it('handles gallery pagination', () => {
    useLayoutStore.getState().setGalleryPage(1);
    expect(useLayoutStore.getState().galleryPage).toBe(1);

    useLayoutStore.getState().setGalleryPage(-5);
    expect(useLayoutStore.getState().galleryPage).toBe(0);
  });

  it('manages Picture-in-Picture state and position cycling', () => {
    expect(useLayoutStore.getState().isPipEnabled).toBe(true);
    useLayoutStore.getState().togglePip();
    expect(useLayoutStore.getState().isPipEnabled).toBe(false);
    useLayoutStore.getState().togglePip();
    expect(useLayoutStore.getState().isPipEnabled).toBe(true);

    useLayoutStore.getState().setPipPosition('top-left');
    expect(useLayoutStore.getState().pipPosition).toBe('top-left');
  });
});
