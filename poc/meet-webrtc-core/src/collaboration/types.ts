export type ReactionEmoji = '👍' | '👏' | '❤️' | '🎉' | '✋';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isLocal: boolean;
}

export interface ReactionEvent {
  id: string;
  senderId: string;
  senderName: string;
  emoji: ReactionEmoji;
  timestamp: number;
  xOffset?: number; // randomized percentage (10% - 90%) for floating overlay
}

export interface HostAnnouncement {
  id: string;
  message: string;
  senderName: string;
  timestamp: number;
  active: boolean;
}

export interface ChatDataChannelMessage {
  type: 'chat';
  id: string;
  text: string;
  timestamp: number;
}

export interface ReactionDataChannelMessage {
  type: 'reaction';
  id: string;
  emoji: ReactionEmoji;
  timestamp: number;
}

export interface AnnouncementDataChannelMessage {
  type: 'announcement';
  id: string;
  message: string;
  timestamp: number;
}

export interface HandActionDataChannelMessage {
  type: 'hand-action';
  action: 'lower-hand' | 'lower-all';
  targetParticipantId?: string;
  timestamp: number;
}

export const CHAT_TOPIC = 'collab-chat';
export const REACTION_TOPIC = 'collab-reaction';
export const ANNOUNCEMENT_TOPIC = 'collab-announcement';
export const HAND_ACTION_TOPIC = 'collab-hand-action';
