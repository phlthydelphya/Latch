/**
 * LiveKit Collaboration Adapter (M2 Phase C)
 *
 * Decouples WebRTC DataChannel signaling from in-meeting collaboration UI components.
 * Translates low-level data packets across 4 topics:
 * - 'collab-chat': In-memory chat messaging
 * - 'collab-reaction': Real-time floating emoji reactions
 * - 'collab-announcement': Host broadcast banner announcements
 * - 'collab-hand-action': Host hand queue directives
 */

import { Room, RoomEvent, Participant } from 'livekit-client';
import { useCollaborationStore } from './collaborationStore';
import { usePresenceStore } from '../presence/presenceStore';
import {
  CHAT_TOPIC,
  REACTION_TOPIC,
  ANNOUNCEMENT_TOPIC,
  HAND_ACTION_TOPIC,
  ChatDataChannelMessage,
  ReactionDataChannelMessage,
  AnnouncementDataChannelMessage,
  HandActionDataChannelMessage,
  ReactionEvent,
} from './types';

export class CollaborationAdapter {
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];
  private reactionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(room?: Room) {
    if (room) {
      this.attach(room);
    }
  }

  attach(room: Room): void {
    this.detach();
    this.room = room;

    const onDataReceived = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: any,
      topic?: string
    ) => {
      if (!topic) return;

      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);

        switch (topic) {
          case CHAT_TOPIC: {
            const chatMsg = data as ChatDataChannelMessage;
            const senderId = participant?.identity || 'unknown';
            const presence = usePresenceStore.getState();
            const senderName =
              presence.participants.get(senderId)?.name ||
              participant?.name ||
              `User (${senderId.slice(0, 6)})`;

            useCollaborationStore.getState().addMessage({
              id: chatMsg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              senderId,
              senderName,
              text: chatMsg.text,
              timestamp: chatMsg.timestamp || Date.now(),
              isLocal: false,
            });
            break;
          }

          case REACTION_TOPIC: {
            const rxMsg = data as ReactionDataChannelMessage;
            const senderId = participant?.identity || 'unknown';
            const presence = usePresenceStore.getState();
            const senderName =
              presence.participants.get(senderId)?.name ||
              participant?.name ||
              `User (${senderId.slice(0, 6)})`;

            const rxId = rxMsg.id || `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const rx: ReactionEvent = {
              id: rxId,
              senderId,
              senderName,
              emoji: rxMsg.emoji,
              timestamp: rxMsg.timestamp || Date.now(),
              xOffset: Math.floor(15 + Math.random() * 70), // randomize 15% - 85%
            };

            useCollaborationStore.getState().addReaction(rx);

            // Auto-prune reaction from memory after animation finishes (3.5s)
            const timer = setTimeout(() => {
              useCollaborationStore.getState().removeReaction(rxId);
              this.reactionTimers.delete(rxId);
            }, 3500);
            this.reactionTimers.set(rxId, timer);
            break;
          }

          case ANNOUNCEMENT_TOPIC: {
            const annMsg = data as AnnouncementDataChannelMessage;
            const senderId = participant?.identity || '';
            const presence = usePresenceStore.getState();
            const isHost = Boolean(presence.hostId && presence.hostId === senderId);

            if (isHost) {
              const senderName =
                presence.participants.get(senderId)?.name ||
                participant?.name ||
                'Meeting Host';

              useCollaborationStore.getState().setAnnouncement({
                id: annMsg.id || `ann-${Date.now()}`,
                message: annMsg.message,
                senderName,
                timestamp: annMsg.timestamp || Date.now(),
                active: true,
              });
            } else {
              console.warn('[CollaborationAdapter] Unauthorized announcement rejected from:', senderId);
            }
            break;
          }

          case HAND_ACTION_TOPIC: {
            const handMsg = data as HandActionDataChannelMessage;
            const senderId = participant?.identity || '';
            const presence = usePresenceStore.getState();
            const isHost = Boolean(presence.hostId && presence.hostId === senderId);

            if (isHost) {
              if (handMsg.action === 'lower-all') {
                usePresenceStore.getState().lowerAllHands();
              } else if (handMsg.action === 'lower-hand' && handMsg.targetParticipantId) {
                usePresenceStore.getState().setHandRaised(handMsg.targetParticipantId, false);
              }
            } else {
              console.warn('[CollaborationAdapter] Unauthorized hand action rejected from:', senderId);
            }
            break;
          }
        }
      } catch (err) {
        console.warn('[CollaborationAdapter] Failed to parse message on topic:', topic, err);
      }
    };

    room.on(RoomEvent.DataReceived, onDataReceived);

    this.unsubscribers.push(() => {
      const remove =
        typeof room.off === 'function'
          ? room.off.bind(room)
          : typeof (room as any).removeListener === 'function'
          ? (room as any).removeListener.bind(room)
          : null;

      if (remove) {
        remove(RoomEvent.DataReceived, onDataReceived);
      }
    });
  }

  detach(): void {
    for (const timer of this.reactionTimers.values()) {
      clearTimeout(timer);
    }
    this.reactionTimers.clear();

    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.room = null;
  }
}
