import { create } from 'zustand';
import { ChatMessage, ReactionEvent, HostAnnouncement } from './types';

export interface CollaborationState {
  messages: ChatMessage[];
  unreadCount: number;
  isChatOpen: boolean;
  isReactionsBarOpen: boolean;
  activeReactions: ReactionEvent[];
  currentAnnouncement: HostAnnouncement | null;

  addMessage: (msg: ChatMessage) => void;
  toggleChat: (open?: boolean) => void;
  toggleReactionsBar: (open?: boolean) => void;
  markChatRead: () => void;
  addReaction: (reaction: ReactionEvent) => void;
  removeReaction: (id: string) => void;
  setAnnouncement: (announcement: HostAnnouncement | null) => void;
  dismissAnnouncement: () => void;
  reset: () => void;
}

const initialState = {
  messages: [] as ChatMessage[],
  unreadCount: 0,
  isChatOpen: false,
  isReactionsBarOpen: false,
  activeReactions: [] as ReactionEvent[],
  currentAnnouncement: null as HostAnnouncement | null,
};

export const useCollaborationStore = create<CollaborationState>((set) => ({
  ...initialState,

  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, msg],
      unreadCount: state.isChatOpen || msg.isLocal ? state.unreadCount : state.unreadCount + 1,
    })),

  toggleChat: (open) =>
    set((state) => {
      const nextOpen = open !== undefined ? open : !state.isChatOpen;
      return {
        isChatOpen: nextOpen,
        unreadCount: nextOpen ? 0 : state.unreadCount,
      };
    }),

  toggleReactionsBar: (open) =>
    set((state) => ({
      isReactionsBarOpen: open !== undefined ? open : !state.isReactionsBarOpen,
    })),

  markChatRead: () =>
    set({
      unreadCount: 0,
    }),

  addReaction: (reaction) =>
    set((state) => ({
      activeReactions: [...state.activeReactions, reaction],
    })),

  removeReaction: (id) =>
    set((state) => ({
      activeReactions: state.activeReactions.filter((r) => r.id !== id),
    })),

  setAnnouncement: (announcement) =>
    set({
      currentAnnouncement: announcement,
    }),

  dismissAnnouncement: () =>
    set({
      currentAnnouncement: null,
    }),

  reset: () => set(initialState),
}));
