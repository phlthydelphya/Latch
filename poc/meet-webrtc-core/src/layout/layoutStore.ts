import { create } from 'zustand';
import { LayoutMode, PipPosition, FilmstripPosition } from './types';

export interface LayoutState {
  mode: LayoutMode;
  previousMode: LayoutMode;
  pinnedParticipantId: string | null;
  spotlightParticipantId: string | null;
  activeSpeakerId: string | null;
  screenShareOwnerId: string | null;
  galleryPage: number;
  isPipEnabled: boolean;
  pipPosition: PipPosition;
  filmstripPosition: FilmstripPosition;

  setLayoutMode: (mode: LayoutMode) => void;
  pinParticipant: (id: string | null) => void;
  setSpotlight: (id: string | null) => void;
  setActiveSpeaker: (id: string | null) => void;
  setScreenShareOwner: (id: string | null) => void;
  setGalleryPage: (page: number) => void;
  togglePip: () => void;
  setPipPosition: (pos: PipPosition) => void;
  setFilmstripPosition: (pos: FilmstripPosition) => void;
  reset: () => void;
}

const initialState = {
  mode: 'gallery' as LayoutMode,
  previousMode: 'gallery' as LayoutMode,
  pinnedParticipantId: null,
  spotlightParticipantId: null,
  activeSpeakerId: null,
  screenShareOwnerId: null,
  galleryPage: 0,
  isPipEnabled: true,
  pipPosition: 'bottom-right' as PipPosition,
  filmstripPosition: 'bottom' as FilmstripPosition,
};

export const useLayoutStore = create<LayoutState>((set) => ({
  ...initialState,

  setLayoutMode: (mode) =>
    set((state) => ({
      mode,
      previousMode: state.mode,
    })),

  pinParticipant: (id) =>
    set((state) => ({
      pinnedParticipantId: state.pinnedParticipantId === id ? null : id,
      // If pinning a participant while in gallery, optionally keep mode or let user switch
    })),

  setSpotlight: (id) =>
    set({
      spotlightParticipantId: id,
    }),

  setActiveSpeaker: (id) =>
    set({
      activeSpeakerId: id,
    }),

  setScreenShareOwner: (id) =>
    set((state) => {
      if (id) {
        return {
          screenShareOwnerId: id,
          previousMode: state.mode !== 'content' ? state.mode : state.previousMode,
          mode: 'content',
        };
      } else {
        return {
          screenShareOwnerId: null,
          mode: state.previousMode,
        };
      }
    }),

  setGalleryPage: (page) =>
    set({
      galleryPage: Math.max(0, page),
    }),

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
