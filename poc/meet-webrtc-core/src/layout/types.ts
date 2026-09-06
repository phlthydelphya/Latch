export type LayoutMode = 'gallery' | 'speaker' | 'content';

export type PipPosition = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';

export type FilmstripPosition = 'bottom' | 'side';

export type PresentationMode = 'side-by-side' | 'over-below' | 'pip' | 'content-only';

export interface LayoutParticipantTile {
  id: string;
  name: string;
  stream: MediaStream | null;
  isLocal: boolean;
  isScreen: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  speaking: boolean;
}

export interface SpotlightDataChannelMessage {
  type: 'spotlight';
  participantId: string | null;
  timestamp: number;
}

export interface GridGeometry {
  rows: number;
  cols: number;
  tileWidth: number;
  tileHeight: number;
  orphans: number;
  perPage: number;
  totalPages: number;
}

export interface SpeakerScoringCandidate {
  id: string;
  energy: number; // 0..1 smoothed RMS
  durationMs: number;
  lastSpokeAt: number;
  confidence: number; // 0..1
}

export interface LayoutScores {
  presentationScore: number;
  spotlightScore: number;
  speakerScore: number;
  galleryScore: number;
  resolvedMode: LayoutMode;
}
