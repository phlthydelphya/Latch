import { describe, it, expect, beforeEach } from 'vitest';
import { useCollaborationStore } from '../src/collaboration/collaborationStore';
import { ChatMessage, ReactionEvent, HostAnnouncement } from '../src/collaboration/types';

describe('M2 Phase C: CollaborationStore', () => {
  beforeEach(() => {
    useCollaborationStore.getState().reset();
  });

  it('C-1: Initializes with default empty state and closed drawers', () => {
    const state = useCollaborationStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.isChatOpen).toBe(false);
    expect(state.isReactionsBarOpen).toBe(false);
    expect(state.activeReactions).toEqual([]);
    expect(state.currentAnnouncement).toBeNull();
  });

  it('C-2: Adds chat messages and increments unread count when drawer is closed', () => {
    const msg1: ChatMessage = {
      id: 'msg-1',
      senderId: 'remote-bob',
      senderName: 'Bob',
      text: 'Hello world',
      timestamp: Date.now(),
      isLocal: false,
    };

    useCollaborationStore.getState().addMessage(msg1);

    expect(useCollaborationStore.getState().messages).toHaveLength(1);
    expect(useCollaborationStore.getState().messages[0].text).toBe('Hello world');
    expect(useCollaborationStore.getState().unreadCount).toBe(1);

    const msg2: ChatMessage = {
      id: 'msg-2',
      senderId: 'remote-charlie',
      senderName: 'Charlie',
      text: 'Hey Bob!',
      timestamp: Date.now(),
      isLocal: false,
    };

    useCollaborationStore.getState().addMessage(msg2);
    expect(useCollaborationStore.getState().messages).toHaveLength(2);
    expect(useCollaborationStore.getState().unreadCount).toBe(2);
  });

  it('C-3: Does not increment unread count for local messages or when chat is open', () => {
    // Local message when chat is closed
    const localMsg: ChatMessage = {
      id: 'msg-local',
      senderId: 'local-alice',
      senderName: 'Alice',
      text: 'My message',
      timestamp: Date.now(),
      isLocal: true,
    };
    useCollaborationStore.getState().addMessage(localMsg);
    expect(useCollaborationStore.getState().unreadCount).toBe(0);

    // Open chat
    useCollaborationStore.getState().toggleChat(true);
    expect(useCollaborationStore.getState().isChatOpen).toBe(true);

    // Remote message when chat is open
    const remoteMsg: ChatMessage = {
      id: 'msg-remote',
      senderId: 'remote-bob',
      senderName: 'Bob',
      text: 'While open',
      timestamp: Date.now(),
      isLocal: false,
    };
    useCollaborationStore.getState().addMessage(remoteMsg);
    expect(useCollaborationStore.getState().unreadCount).toBe(0);
  });

  it('C-4: Toggling or opening chat resets unread count to 0', () => {
    useCollaborationStore.getState().addMessage({
      id: 'msg-1',
      senderId: 'remote-bob',
      senderName: 'Bob',
      text: 'Unread 1',
      timestamp: Date.now(),
      isLocal: false,
    });
    useCollaborationStore.getState().addMessage({
      id: 'msg-2',
      senderId: 'remote-charlie',
      senderName: 'Charlie',
      text: 'Unread 2',
      timestamp: Date.now(),
      isLocal: false,
    });
    expect(useCollaborationStore.getState().unreadCount).toBe(2);

    // Opening chat clears unreadCount
    useCollaborationStore.getState().toggleChat(true);
    expect(useCollaborationStore.getState().unreadCount).toBe(0);

    // Closing chat maintains 0
    useCollaborationStore.getState().toggleChat(false);
    expect(useCollaborationStore.getState().unreadCount).toBe(0);
  });

  it('C-5: Marks chat read directly', () => {
    useCollaborationStore.getState().addMessage({
      id: 'msg-1',
      senderId: 'remote-bob',
      senderName: 'Bob',
      text: 'Unread message',
      timestamp: Date.now(),
      isLocal: false,
    });
    expect(useCollaborationStore.getState().unreadCount).toBe(1);

    useCollaborationStore.getState().markChatRead();
    expect(useCollaborationStore.getState().unreadCount).toBe(0);
  });

  it('C-6: Manages reactions queue and removal', () => {
    const rx1: ReactionEvent = {
      id: 'rx-1',
      senderId: 'remote-bob',
      senderName: 'Bob',
      emoji: '👍',
      timestamp: Date.now(),
      xOffset: 45,
    };
    const rx2: ReactionEvent = {
      id: 'rx-2',
      senderId: 'remote-charlie',
      senderName: 'Charlie',
      emoji: '❤️',
      timestamp: Date.now(),
      xOffset: 70,
    };

    useCollaborationStore.getState().addReaction(rx1);
    useCollaborationStore.getState().addReaction(rx2);
    expect(useCollaborationStore.getState().activeReactions).toHaveLength(2);

    useCollaborationStore.getState().removeReaction('rx-1');
    expect(useCollaborationStore.getState().activeReactions).toHaveLength(1);
    expect(useCollaborationStore.getState().activeReactions[0].id).toBe('rx-2');
  });

  it('C-7: Sets and dismisses host announcements', () => {
    const ann: HostAnnouncement = {
      id: 'ann-1',
      message: 'Meeting will end in 5 minutes',
      senderName: 'Alice (Host)',
      timestamp: Date.now(),
      active: true,
    };

    useCollaborationStore.getState().setAnnouncement(ann);
    expect(useCollaborationStore.getState().currentAnnouncement).toEqual(ann);

    useCollaborationStore.getState().dismissAnnouncement();
    expect(useCollaborationStore.getState().currentAnnouncement).toBeNull();
  });

  it('C-8: Toggles reactions bar', () => {
    expect(useCollaborationStore.getState().isReactionsBarOpen).toBe(false);
    useCollaborationStore.getState().toggleReactionsBar();
    expect(useCollaborationStore.getState().isReactionsBarOpen).toBe(true);
    useCollaborationStore.getState().toggleReactionsBar(false);
    expect(useCollaborationStore.getState().isReactionsBarOpen).toBe(false);
  });

  it('C-9: Completely purges ephemeral memory state on reset()', () => {
    useCollaborationStore.getState().addMessage({
      id: 'msg-1',
      senderId: 'bob',
      senderName: 'Bob',
      text: 'Ephemeral text',
      timestamp: Date.now(),
      isLocal: false,
    });
    useCollaborationStore.getState().addReaction({
      id: 'rx-1',
      senderId: 'bob',
      senderName: 'Bob',
      emoji: '🎉',
      timestamp: Date.now(),
    });
    useCollaborationStore.getState().setAnnouncement({
      id: 'ann-1',
      message: 'Test',
      senderName: 'Host',
      timestamp: Date.now(),
      active: true,
    });
    useCollaborationStore.getState().toggleChat(true);
    useCollaborationStore.getState().toggleReactionsBar(true);

    // Call reset
    useCollaborationStore.getState().reset();

    const state = useCollaborationStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.isChatOpen).toBe(false);
    expect(state.isReactionsBarOpen).toBe(false);
    expect(state.activeReactions).toEqual([]);
    expect(state.currentAnnouncement).toBeNull();
  });
});
