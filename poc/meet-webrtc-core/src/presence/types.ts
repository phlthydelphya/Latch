/**
 * Presence Domain Types (M2 Phase A)
 *
 * Defines core models for in-meeting presence, awareness, and ephemeral state.
 * Strictly 100% ephemeral in-memory domain models.
 */

export type ConnectionQualityRating = 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';

/**
 * Canonical three-value media state (M4A-MEDIA fix).
 * Distinguishes between:
 *   'on'          — publication exists and is NOT muted
 *   'muted'       — publication exists but IS muted (audio) or disabled (video)
 *   'unavailable' — no publication exists (device not shared / track unpublished)
 */
export type TrackMediaState = 'on' | 'muted' | 'unavailable';

export interface ParticipantPresence {
  id: string;
  name: string;
  isLocal: boolean;
  /** Canonical three-value microphone state. Drives audioEnabled. */
  microphoneState: TrackMediaState;
  /** Canonical three-value camera state. Drives videoEnabled. */
  cameraState: TrackMediaState;
  /** Derived: true iff microphoneState === 'on' */
  audioEnabled: boolean;
  /** Derived: true iff cameraState === 'on' */
  videoEnabled: boolean;
  screenSharing: boolean;
  isSpeaking: boolean;
  connectionQuality: ConnectionQualityRating;
  isHandRaised: boolean;
  handRaisedAt?: number;
  isHost: boolean;
  joinedAt: number;
}

export interface HandRaiseEvent {
  participantId: string;
  raised: boolean;
  timestamp: number;
}

export type ToastType = 'join' | 'leave' | 'hand' | 'host' | 'info';

export interface EphemeralToast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  participantId?: string;
  timestamp: number;
  durationMs: number;
}

export interface ConnectionMetrics {
  rttMs: number;
  packetLossPct: number;
  iceState?: RTCIceConnectionState | string;
}

export interface PresenceState {
  participants: Map<string, ParticipantPresence>;
  localParticipantId: string | null;
  hostId: string | null;
  activeSpeakers: Set<string>;
  raisedHands: HandRaiseEvent[]; // Chronologically ordered queue
  toastQueue: EphemeralToast[];
  isRosterOpen: boolean;
}

export interface PresenceActions {
  setLocalParticipant: (participant: Omit<ParticipantPresence, 'isLocal'>) => void;
  upsertParticipant: (participant: ParticipantPresence) => void;
  removeParticipant: (participantId: string) => void;
  updateParticipantTracks: (participantId: string, updates: Partial<Pick<ParticipantPresence, 'microphoneState' | 'cameraState' | 'screenSharing'>>) => void;
  /** Set the canonical three-value media state for a participant (called by TrackPublished/Unpublished). */
  setParticipantMediaState: (participantId: string, microphoneState: TrackMediaState, cameraState: TrackMediaState) => void;
  
  setHostId: (hostId: string | null) => void;
  setAuthoritativeHost: (hostId: string | null) => void;
  setActiveSpeakers: (speakerIds: string[]) => void;
  setConnectionQuality: (participantId: string, quality: ConnectionQualityRating) => void;
  
  setHandRaised: (participantId: string, raised: boolean, timestamp?: number) => void;
  lowerAllHands: () => void;
  
  pushToast: (toast: Omit<EphemeralToast, 'id' | 'timestamp'>) => void;
  dismissToast: (toastId: string) => void;
  clearToasts: () => void;
  
  setRosterOpen: (open: boolean) => void;
  toggleRoster: () => void;
  
  resetPresence: () => void;
}
