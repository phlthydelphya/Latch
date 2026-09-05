/**
 * Presence Store (M2 Phase A)
 *
 * Centralized, ephemeral Zustand store for all meeting presence, awareness,
 * active speakers, hand raises, connection quality, and toasts.
 *
 * Strict Privacy Invariant:
 * 100% in-memory only. Zero persistence middleware. Zero disk or database storage.
 */

import { create } from 'zustand';
import {
  PresenceState,
  PresenceActions,
  ParticipantPresence,
  ConnectionQualityRating,
  EphemeralToast,
} from './types';

const initialState: PresenceState = {
  participants: new Map(),
  localParticipantId: null,
  hostId: null,
  activeSpeakers: new Set(),
  raisedHands: [],
  toastQueue: [],
  isRosterOpen: false,
};

export const usePresenceStore = create<PresenceState & PresenceActions>((set, get) => ({
  ...initialState,

  setLocalParticipant: (participantData) =>
    set((state) => {
      const id = participantData.id;
      const participants = new Map(state.participants);
      const existing = participants.get(id);

      const local: ParticipantPresence = {
        ...participantData,
        isLocal: true,
        isHost: state.hostId === id || participantData.isHost || state.participants.size === 0,
        joinedAt: existing?.joinedAt ?? Date.now(),
      };

      participants.set(id, local);
      return {
        participants,
        localParticipantId: id,
        hostId: local.isHost ? id : state.hostId,
      };
    }),

  upsertParticipant: (participant) =>
    set((state) => {
      const participants = new Map(state.participants);
      const isFirstParticipant = participants.size === 0;
      const isHost = state.hostId === participant.id || (isFirstParticipant && state.hostId === null);

      participants.set(participant.id, {
        ...participant,
        isHost: isHost || participant.isHost,
        isSpeaking: state.activeSpeakers.has(participant.id),
      });

      return {
        participants,
        hostId: isHost ? participant.id : state.hostId,
      };
    }),

  removeParticipant: (participantId) =>
    set((state) => {
      const participants = new Map(state.participants);
      participants.delete(participantId);

      const activeSpeakers = new Set(state.activeSpeakers);
      activeSpeakers.delete(participantId);

      const raisedHands = state.raisedHands.filter((h) => h.participantId !== participantId);

      // If host disconnected, nominate lowest canonical ID or null
      let nextHostId = state.hostId;
      if (state.hostId === participantId) {
        const remaining = Array.from(participants.keys()).sort();
        nextHostId = remaining.length > 0 ? remaining[0] : null;
        if (nextHostId && participants.has(nextHostId)) {
          const newHost = { ...participants.get(nextHostId)!, isHost: true };
          participants.set(nextHostId, newHost);
        }
      }

      return {
        participants,
        activeSpeakers,
        raisedHands,
        hostId: nextHostId,
      };
    }),

  updateParticipantTracks: (participantId, updates) =>
    set((state) => {
      const participants = new Map(state.participants);
      const existing = participants.get(participantId);
      if (!existing) return state;

      participants.set(participantId, {
        ...existing,
        ...updates,
      });

      return { participants };
    }),

  setHostId: (hostId) =>
    set((state) => {
      const participants = new Map(state.participants);
      for (const [id, p] of participants.entries()) {
        participants.set(id, {
          ...p,
          isHost: id === hostId,
        });
      }
      return { participants, hostId };
    }),

  setActiveSpeakers: (speakerIds) =>
    set((state) => {
      const activeSpeakers = new Set(speakerIds);
      const participants = new Map(state.participants);

      for (const [id, p] of participants.entries()) {
        const isSpeaking = activeSpeakers.has(id);
        if (p.isSpeaking !== isSpeaking) {
          participants.set(id, { ...p, isSpeaking });
        }
      }

      return { activeSpeakers, participants };
    }),

  setConnectionQuality: (participantId, quality) =>
    set((state) => {
      const participants = new Map(state.participants);
      const existing = participants.get(participantId);
      if (!existing) return state;

      participants.set(participantId, {
        ...existing,
        connectionQuality: quality,
      });

      return { participants };
    }),

  setHandRaised: (participantId, raised, timestamp) =>
    set((state) => {
      const participants = new Map(state.participants);
      const existing = participants.get(participantId);
      const now = timestamp ?? Date.now();

      if (existing) {
        participants.set(participantId, {
          ...existing,
          isHandRaised: raised,
          handRaisedAt: raised ? now : undefined,
        });
      }

      let raisedHands = state.raisedHands.filter((h) => h.participantId !== participantId);
      if (raised) {
        raisedHands.push({ participantId, raised: true, timestamp: now });
        raisedHands.sort((a, b) => a.timestamp - b.timestamp);
      }

      return { participants, raisedHands };
    }),

  lowerAllHands: () =>
    set((state) => {
      const participants = new Map(state.participants);
      for (const [id, p] of participants.entries()) {
        if (p.isHandRaised) {
          participants.set(id, { ...p, isHandRaised: false, handRaisedAt: undefined });
        }
      }
      return { participants, raisedHands: [] };
    }),

  pushToast: (toastData) =>
    set((state) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast: EphemeralToast = {
        ...toastData,
        id,
        timestamp: Date.now(),
        durationMs: toastData.durationMs || 4000,
      };

      // Limit queue to 5 active toasts
      const queue = [...state.toastQueue.slice(-4), toast];
      return { toastQueue: queue };
    }),

  dismissToast: (toastId) =>
    set((state) => ({
      toastQueue: state.toastQueue.filter((t) => t.id !== toastId),
    })),

  clearToasts: () => set({ toastQueue: [] }),

  setRosterOpen: (isRosterOpen) => set({ isRosterOpen }),

  toggleRoster: () => set((state) => ({ isRosterOpen: !state.isRosterOpen })),

  resetPresence: () => set({
    participants: new Map(),
    localParticipantId: null,
    hostId: null,
    activeSpeakers: new Set(),
    raisedHands: [],
    toastQueue: [],
    isRosterOpen: false,
  }),
}));
