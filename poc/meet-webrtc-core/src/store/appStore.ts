import { create } from 'zustand';

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

/**
 * SEC-02B/SEC-02C session-authority state. These are the private credentials the
 * activated meet-signal contract requires for host resume and transfer. They are
 * never logged and are cleared on room leave, logout, or authority loss.
 */
export interface SessionAuthority {
  sessionToken?: string | null;   // 256-bit private session capability (identity proof)
  resumeHandle?: string | null;   // SEC-02C one-use, generation-bound host resume handle
  roomInstanceId?: string | null; // SEC-02B room incarnation binding
  hostToken?: string | null;      // SEC-02C ES256 host-operation proof
  hostKey?: string | null;        // Public host verification key (not secret)
}

export interface MeetingState {
  roomId: string | null;
  participantId: string | null;
  jwt: string | null;           // Legacy mesh token
  livekitToken: string | null;  // LiveKit access token
  sfuUrl: string | null;        // LiveKit SFU WebSocket URL (wss://host/rtc)
  keyParam: string | null;      // #k= from URL
  sessionToken: string | null;  // SEC-02B private session capability
  resumeHandle: string | null;  // SEC-02C one-use host resume handle
  roomInstanceId: string | null; // SEC-02B room incarnation binding
  hostToken: string | null;     // SEC-02C host-operation proof
  hostKey: string | null;       // Public host verification key
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
  setLivekitToken: (token: string | null) => void;
  setSfuUrl: (url: string | null) => void;
  setCredentials: (livekitToken: string, sfuUrl: string) => void;
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
  setSessionAuthority: (authority: SessionAuthority) => void;
  clearHostAuthority: () => void;
  leave: () => void;
}

const initialState: MeetingState = {
  roomId: null,
  participantId: null,
  jwt: null,
  livekitToken: null,
  sfuUrl: null,
  keyParam: null,
  sessionToken: null,
  resumeHandle: null,
  roomInstanceId: null,
  hostToken: null,
  hostKey: null,
  participants: new Map(),
  localParticipant: null,
  isConnected: false,
  isReconnecting: false,
  connectionQuality: 'disconnected',
  shieldMode: false,
  lastN: 9,
  error: null,
};

export const useAppStore = create<MeetingState & AppActions>()((set) => ({
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

  setLivekitToken: (livekitToken) => set({ livekitToken }),
  setSfuUrl: (sfuUrl) => set({ sfuUrl }),
  setCredentials: (livekitToken, sfuUrl) => set({ livekitToken, sfuUrl }),

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

  setSessionAuthority: (authority) =>
    set((state) => ({
      sessionToken: authority.sessionToken !== undefined ? authority.sessionToken : state.sessionToken,
      resumeHandle: authority.resumeHandle !== undefined ? authority.resumeHandle : state.resumeHandle,
      roomInstanceId: authority.roomInstanceId !== undefined ? authority.roomInstanceId : state.roomInstanceId,
      hostToken: authority.hostToken !== undefined ? authority.hostToken : state.hostToken,
      hostKey: authority.hostKey !== undefined ? authority.hostKey : state.hostKey,
    })),

  // On authority loss only the host-operation proof and its one-use handle are
  // dropped; the private session capability remains valid identity state.
  clearHostAuthority: () => set({ hostToken: null, resumeHandle: null }),

  leave: () => set(initialState),
}));

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