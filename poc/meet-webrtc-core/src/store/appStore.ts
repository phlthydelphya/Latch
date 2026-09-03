import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Participant {
  id: string;
  name: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isLocal: boolean;
  isSpeaking: boolean;
  stream?: MediaStream;
}

export interface MeetingState {
  roomId: string | null;
  participantId: string | null;
  jwt: string | null;
  keyParam: string | null; // #k= from URL
  participants: Map<string, Participant>;
  localParticipant: Participant | null;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  shieldMode: boolean; // E2EE active
  lastN: number;
  error: string | null;
}

export interface AppActions {
  setRoom: (roomId: string, participantId: string, jwt: string, keyParam?: string) => void;
  clearRoom: () => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (participantId: string) => void;
  updateParticipant: (participantId: string, updates: Partial<Participant>) => void;
  setLocalParticipant: (participant: Participant) => void;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
  setConnectionQuality: (quality: MeetingState['connectionQuality']) => void;
  setShieldMode: (enabled: boolean) => void;
  setError: (error: string | null) => void;
  toggleLocalAudio: () => void;
  toggleLocalVideo: () => void;
  setLocalScreenShare: (sharing: boolean) => void;
  leave: () => void;
}

const initialState: MeetingState = {
  roomId: null,
  participantId: null,
  jwt: null,
  keyParam: null,
  participants: new Map(),
  localParticipant: null,
  isConnected: false,
  isReconnecting: false,
  connectionQuality: 'disconnected',
  shieldMode: false,
  lastN: 9,
  error: null,
};

export const useAppStore = create<MeetingState & AppActions>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setRoom: (roomId, participantId, jwt, keyParam) =>
        set({
          roomId,
          participantId,
          jwt,
          keyParam,
          participants: new Map(),
          localParticipant: null,
          isConnected: false,
          isReconnecting: false,
          connectionQuality: 'disconnected',
          shieldMode: true, // E2EE always on for P0
          error: null,
        }),
      
      clearRoom: () => set(initialState),
      
      addParticipant: (participant) =>
        set((state) => {
          const newParticipants = new Map(state.participants);
          newParticipants.set(participant.id, participant);
          return { participants: newParticipants };
        }),
      
      removeParticipant: (participantId) =>
        set((state) => {
          const newParticipants = new Map(state.participants);
          newParticipants.delete(participantId);
          return { participants: newParticipants };
        }),
      
      updateParticipant: (participantId, updates) =>
        set((state) => {
          const participant = state.participants.get(participantId);
          if (!participant) return state;
          
          const newParticipants = new Map(state.participants);
          newParticipants.set(participantId, { ...participant, ...updates });
          return { participants: newParticipants };
        }),
      
      setLocalParticipant: (participant) =>
        set({ localParticipant: participant }),
      
      setConnected: (isConnected) =>
        set({ isConnected, connectionQuality: isConnected ? 'excellent' : 'disconnected' }),
      
      setReconnecting: (isReconnecting) =>
        set({ isReconnecting, connectionQuality: isReconnecting ? 'poor' : 'excellent' }),
      
      setConnectionQuality: (connectionQuality) => set({ connectionQuality }),
      
      setShieldMode: (shieldMode) => set({ shieldMode }),
      
      setError: (error) => set({ error }),
      
      toggleLocalAudio: () =>
        set((state) => {
          if (!state.localParticipant) return state;
          const newParticipants = new Map(state.participants);
          const updated = { ...state.localParticipant, audioEnabled: !state.localParticipant.audioEnabled };
          newParticipants.set(state.localParticipant.id, updated);
          return { localParticipant: updated, participants: newParticipants };
        }),
      
      toggleLocalVideo: () =>
        set((state) => {
          if (!state.localParticipant) return state;
          const newParticipants = new Map(state.participants);
          const updated = { ...state.localParticipant, videoEnabled: !state.localParticipant.videoEnabled };
          newParticipants.set(state.localParticipant.id, updated);
          return { localParticipant: updated, participants: newParticipants };
        }),
      
      setLocalScreenShare: (screenSharing) =>
        set((state) => {
          if (!state.localParticipant) return state;
          const newParticipants = new Map(state.participants);
          const updated = { ...state.localParticipant, screenSharing };
          newParticipants.set(state.localParticipant.id, updated);
          return { localParticipant: updated, participants: newParticipants };
        }),
      
      leave: () => set(initialState),
    }),
    {
      name: 'meet-secure-state',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        roomId: state.roomId,
        participantId: state.participantId,
        jwt: state.jwt,
        keyParam: state.keyParam,
      }),
    }
  )
);

// Selectors for performance
export const useRoomId = () => useAppStore((s) => s.roomId);
export const useParticipantId = () => useAppStore((s) => s.participantId);
export const useJWT = () => useAppStore((s) => s.jwt);
export const useKeyParam = () => useAppStore((s) => s.keyParam);
export const useParticipants = () => useAppStore((s) => Array.from(s.participants.values()));
export const useLocalParticipant = () => useAppStore((s) => s.localParticipant);
export const useIsConnected = () => useAppStore((s) => s.isConnected);
export const useIsReconnecting = () => useAppStore((s) => s.isReconnecting);
export const useConnectionQuality = () => useAppStore((s) => s.connectionQuality);
export const useShieldMode = () => useAppStore((s) => s.shieldMode);
export const useError = () => useAppStore((s) => s.error);
export const useLastN = () => useAppStore((s) => s.lastN);