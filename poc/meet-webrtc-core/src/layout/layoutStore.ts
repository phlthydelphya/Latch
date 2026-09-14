import { create } from 'zustand';
import { LayoutMode, PipPosition, FilmstripPosition, PresentationMode, BandwidthTier } from './types';
import { layoutEngine } from './layoutEngine';

export interface LayoutState {
  mode: LayoutMode;
  previousMode: LayoutMode;
  userLockedMode: LayoutMode | null;
  presentationMode: PresentationMode;
  splitRatio: number; // 0.2 to 0.8 (default 0.75)
  pinnedParticipantId: string | null;
  pinnedParticipantIds: string[];
  spotlightParticipantId: string | null;
  activeSpeakerId: string | null;
  speakerConfidence: number; // 0..1
  screenShareOwnerId: string | null;
  galleryPage: number;
  visibleTileIds: string[];
  bandwidthTier: BandwidthTier;
  isPipEnabled: boolean;
  pipPosition: PipPosition;
  filmstripPosition: FilmstripPosition;

  setLayoutMode: (mode: LayoutMode) => void;
  unlockMode: () => void;
  setPresentationMode: (mode: PresentationMode) => void;
  setSplitRatio: (ratio: number) => void;
  pinParticipant: (id: string | null) => void;
  retainParticipants: (ids: string[]) => void;
  setSpotlight: (id: string | null) => void;
  setActiveSpeaker: (id: string | null, confidence?: number) => void;
  setSpeakerConfidence: (confidence: number) => void;
  setScreenShareOwner: (id: string | null) => void;
  setGalleryPage: (page: number) => void;
  setVisibleTileIds: (ids: string[]) => void;
  setBandwidthTier: (tier: BandwidthTier) => void;
  togglePip: () => void;
  setPipPosition: (pos: PipPosition) => void;
  setFilmstripPosition: (pos: FilmstripPosition) => void;
  evaluateArbitration: (totalParticipants?: number) => void;
  reset: () => void;
}

const initialState = {
  mode: 'gallery' as LayoutMode,
  previousMode: 'gallery' as LayoutMode,
  userLockedMode: null as LayoutMode | null,
  presentationMode: 'side-by-side' as PresentationMode,
  splitRatio: 0.75,
  pinnedParticipantId: null,
  pinnedParticipantIds: [] as string[],
  spotlightParticipantId: null,
  activeSpeakerId: null,
  speakerConfidence: 0,
  screenShareOwnerId: null,
  galleryPage: 0,
  visibleTileIds: [] as string[],
  bandwidthTier: 'optimal' as BandwidthTier,
  isPipEnabled: true,
  pipPosition: 'bottom-right' as PipPosition,
  filmstripPosition: 'bottom' as FilmstripPosition,
};

export const MAX_PINNED_PARTICIPANTS = 9;

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...initialState,

  setLayoutMode: (mode) =>
    set((state) => ({
      mode,
      previousMode: state.mode,
      userLockedMode: mode,
    })),

  unlockMode: () => {
    set({ userLockedMode: null });
    get().evaluateArbitration();
  },

  setPresentationMode: (presentationMode) =>
    set({ presentationMode }),

  setSplitRatio: (ratio) =>
    set({ splitRatio: Math.max(0.2, Math.min(0.8, ratio)) }),

  pinParticipant: (id) =>
    set((state) => {
      const pins = state.pinnedParticipantIds;
      const nextPins = id === null ? [] : pins.includes(id)
        ? pins.filter((pin) => pin !== id)
        : pins.length < MAX_PINNED_PARTICIPANTS ? [...pins, id] : pins;
      const nextPin = nextPins[nextPins.length - 1] ?? null;
      const scores = layoutEngine.evaluate({
        hasScreenShare: Boolean(state.screenShareOwnerId),
        screenShareOwnerId: state.screenShareOwnerId,
        spotlightParticipantId: state.spotlightParticipantId,
        pinnedParticipantId: nextPin,
        activeSpeakerId: state.activeSpeakerId,
        speakerConfidence: state.speakerConfidence,
        userLockedMode: state.userLockedMode,
        totalParticipants: 2,
      });
      return {
        pinnedParticipantId: nextPin,
        pinnedParticipantIds: nextPins,
        mode: scores.resolvedMode,
        previousMode: scores.resolvedMode !== state.mode ? state.mode : state.previousMode,
      };
    }),

  retainParticipants: (ids) => {
    const present = new Set(ids);
    const state = get();
    const pins = state.pinnedParticipantIds.filter((id) => present.has(id));
    if (pins.length === state.pinnedParticipantIds.length) return;
    set({ pinnedParticipantIds: pins, pinnedParticipantId: pins[pins.length - 1] ?? null });
    get().evaluateArbitration(ids.length);
  },

  setSpotlight: (id) =>
    set((state) => {
      const scores = layoutEngine.evaluate({
        hasScreenShare: Boolean(state.screenShareOwnerId),
        screenShareOwnerId: state.screenShareOwnerId,
        spotlightParticipantId: id,
        pinnedParticipantId: state.pinnedParticipantId,
        activeSpeakerId: state.activeSpeakerId,
        speakerConfidence: state.speakerConfidence,
        userLockedMode: state.userLockedMode,
        totalParticipants: 2,
      });
      return {
        spotlightParticipantId: id,
        mode: scores.resolvedMode,
        previousMode: scores.resolvedMode !== state.mode ? state.mode : state.previousMode,
      };
    }),

  setActiveSpeaker: (id, confidence) =>
    set((state) => {
      const nextConfidence = typeof confidence === 'number' ? confidence : state.speakerConfidence;
      const scores = layoutEngine.evaluate({
        hasScreenShare: Boolean(state.screenShareOwnerId),
        screenShareOwnerId: state.screenShareOwnerId,
        spotlightParticipantId: state.spotlightParticipantId,
        pinnedParticipantId: state.pinnedParticipantId,
        activeSpeakerId: id,
        speakerConfidence: nextConfidence,
        userLockedMode: state.userLockedMode,
        totalParticipants: 2,
      });
      return {
        activeSpeakerId: id,
        speakerConfidence: nextConfidence,
        mode: scores.resolvedMode,
        previousMode: scores.resolvedMode !== state.mode ? state.mode : state.previousMode,
      };
    }),

  setSpeakerConfidence: (confidence) =>
    set({
      speakerConfidence: Math.max(0, Math.min(1, confidence)),
    }),

  setScreenShareOwner: (id) =>
    set((state) => {
      const scores = layoutEngine.evaluate({
        hasScreenShare: Boolean(id),
        screenShareOwnerId: id,
        spotlightParticipantId: state.spotlightParticipantId,
        pinnedParticipantId: state.pinnedParticipantId,
        activeSpeakerId: state.activeSpeakerId,
        speakerConfidence: state.speakerConfidence,
        userLockedMode: state.userLockedMode,
        totalParticipants: 2,
      });
      // Clear user lock if we were locked to 'content' but screen share ended
      const shouldUnlock = state.userLockedMode === 'content' && !id && scores.resolvedMode !== 'content';
      return {
        screenShareOwnerId: id,
        mode: scores.resolvedMode,
        previousMode: scores.resolvedMode !== state.mode ? state.mode : state.previousMode,
        userLockedMode: shouldUnlock ? null : state.userLockedMode,
      };
    }),

  evaluateArbitration: (totalParticipants = 2) =>
    set((state) => {
      const scores = layoutEngine.evaluate({
        hasScreenShare: Boolean(state.screenShareOwnerId),
        screenShareOwnerId: state.screenShareOwnerId,
        spotlightParticipantId: state.spotlightParticipantId,
        pinnedParticipantId: state.pinnedParticipantId,
        activeSpeakerId: state.activeSpeakerId,
        speakerConfidence: state.speakerConfidence,
        userLockedMode: state.userLockedMode,
        totalParticipants,
      });
      if (scores.resolvedMode !== state.mode) {
        return {
          mode: scores.resolvedMode,
          previousMode: state.mode,
        };
      }
      return {};
    }),

  setGalleryPage: (page) =>
    set({
      galleryPage: Math.max(0, page),
    }),

  setVisibleTileIds: (visibleTileIds) =>
    set({ visibleTileIds }),

  setBandwidthTier: (bandwidthTier) =>
    set({ bandwidthTier }),

  togglePip: () =>
    set((state) => ({
      isPipEnabled: !state.isPipEnabled,
    })),

  setPipPosition: (pipPosition) =>
    set({
      pipPosition,
    }),

  setFilmstripPosition: (filmstripPosition) =>
    set({
      filmstripPosition,
    }),

  reset: () => set(initialState),
}));
