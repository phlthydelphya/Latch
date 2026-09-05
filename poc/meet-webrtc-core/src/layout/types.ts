export type LayoutMode = 'gallery' | 'speaker' | 'content';

export type PipPosition = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';

export type FilmstripPosition = 'bottom' | 'side';

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
