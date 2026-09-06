import { Room, RoomEvent, Participant } from 'livekit-client';
import { useHostControlStore } from './hostControlStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useAppStore } from '../store/appStore';
import {
  HOST_CONTROL_TOPIC,
  HostDirectiveMessage,
  MeetingPermissions,
} from './types';

export class HostControlManager {
  private static instance: HostControlManager | null = null;
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];

  static getInstance(): HostControlManager {
    if (!HostControlManager.instance) {
      HostControlManager.instance = new HostControlManager();
    }
    return HostControlManager.instance;
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
      if (topic !== HOST_CONTROL_TOPIC) return;

      try {
        const text = new TextDecoder().decode(payload);
        const msg = JSON.parse(text) as HostDirectiveMessage;
        const senderId = participant?.identity || '';
        const presence = usePresenceStore.getState();
        const localId = presence.localParticipantId || '';
        const isLocalHost = Boolean(presence.hostId && presence.hostId === localId);
        const isSenderHost = Boolean(presence.hostId && presence.hostId === senderId);

        // Knock messages are sent by attendees to the host
        if (msg.action === 'waiting-room-knock') {
          if (isLocalHost) {
            const knockerId = msg.targetParticipantId || senderId;
            const knockerName =
              msg.participantName ||
              presence.participants.get(knockerId)?.name ||
              participant?.name ||
              `Guest (${knockerId.slice(0, 6)})`;

            useHostControlStore.getState().addWaitingParticipant({
              participantId: knockerId,
              name: knockerName,
              timestamp: msg.timestamp || Date.now(),
            });

            usePresenceStore.getState().pushToast({
              type: 'info',
              title: 'Waiting Room',
              message: `${knockerName} is waiting to join`,
              durationMs: 4000,
            });
          }
          return;
        }

        // All other directives require host authority
        if (!isSenderHost) {
          console.warn('[HostControlManager] Unauthorized host directive rejected from:', senderId, msg.action);
          return;
        }

        switch (msg.action) {
          case 'mute-participant': {
            if (msg.targetParticipantId === localId) {
              const app = useAppStore.getState();
              if (app.localParticipant?.audioEnabled) {
                app.toggleLocalAudio();
              }
              if (this.room?.localParticipant?.isMicrophoneEnabled) {
                this.room.localParticipant.setMicrophoneEnabled(false);
              }
              usePresenceStore.getState().pushToast({
                type: 'info',
                title: 'Microphone Muted',
                message: 'The host has muted your microphone',
                durationMs: 4000,
              });
            }
            break;
          }

          case 'remove-participant': {
            if (msg.targetParticipantId === localId) {
              useHostControlStore.getState().setKicked(true);
              usePresenceStore.getState().pushToast({
                type: 'info',
                title: 'Removed from Meeting',
                message: 'You have been removed from the meeting by the host',
                durationMs: 5000,
              });
              useAppStore.getState().leave();
            } else if (msg.targetParticipantId) {
              usePresenceStore.getState().removeParticipant(msg.targetParticipantId);
            }
            break;
          }

          case 'transfer-host': {
            if (msg.targetParticipantId) {
              usePresenceStore.getState().setHostId(msg.targetParticipantId);
              const newHostName =
                presence.participants.get(msg.targetParticipantId)?.name ||
                (msg.targetParticipantId === localId ? 'You' : 'Participant');

              usePresenceStore.getState().pushToast({
                type: 'host',
                title: 'Host Transfer',
                message:
                  msg.targetParticipantId === localId
                    ? 'You are now the meeting host'
                    : `${newHostName} is now the meeting host`,
                durationMs: 4000,
              });
            }
            break;
          }

          case 'lock-room': {
            const locked = !!msg.isLocked;
            useHostControlStore.getState().setRoomLocked(locked);
            usePresenceStore.getState().pushToast({
              type: 'info',
              title: locked ? 'Meeting Locked' : 'Meeting Unlocked',
              message: locked
                ? 'The meeting has been locked by the host'
                : 'The meeting has been unlocked',
              durationMs: 4000,
            });
            break;
          }

          case 'set-waiting-room': {
            useHostControlStore.getState().setWaitingRoomEnabled(!!msg.isWaitingRoomEnabled);
            break;
          }

          case 'waiting-room-admit': {
            if (msg.targetParticipantId) {
              useHostControlStore.getState().removeWaitingParticipant(msg.targetParticipantId);
              if (msg.targetParticipantId === localId) {
                usePresenceStore.getState().pushToast({
                  type: 'info',
                  title: 'Admitted',
                  message: 'The host admitted you to the meeting',
                  durationMs: 4000,
                });
              }
            }
            break;
          }

          case 'waiting-room-reject': {
            if (msg.targetParticipantId) {
              useHostControlStore.getState().removeWaitingParticipant(msg.targetParticipantId);
              if (msg.targetParticipantId === localId) {
                usePresenceStore.getState().pushToast({
                  type: 'info',
                  title: 'Admission Declined',
                  message: 'Your request to join was declined by the host',
                  durationMs: 4000,
                });
                useAppStore.getState().leave();
              }
            }
            break;
          }

          case 'update-permissions': {
            if (msg.permissions) {
              useHostControlStore.getState().updatePermissions(msg.permissions);

              // If screen sharing was disabled and local user is currently sharing, stop it
              if (msg.permissions.canShareScreen === false && !isLocalHost) {
                const app = useAppStore.getState();
                if (app.localParticipant?.screenSharing) {
                  app.setLocalScreenShare(false);
                  usePresenceStore.getState().pushToast({
                    type: 'info',
                    title: 'Screen Share Restricted',
                    message: 'Host has restricted screen sharing',
                    durationMs: 4000,
                  });
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.warn('[HostControlManager] Failed to process host directive:', err);
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
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.room = null;
  }

  private async publishDirective(directive: Omit<HostDirectiveMessage, 'type' | 'timestamp'>): Promise<void> {
    if (!this.room?.localParticipant) return;

    const msg: HostDirectiveMessage = {
      type: 'host-directive',
      ...directive,
      timestamp: Date.now(),
    };

    const bytes = new TextEncoder().encode(JSON.stringify(msg));
    await this.room.localParticipant.publishData(bytes, {
      reliable: true,
      topic: HOST_CONTROL_TOPIC,
    });
  }

  async muteParticipant(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'mute-participant',
      targetParticipantId,
    });
  }

  async removeParticipant(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'remove-participant',
      targetParticipantId,
    });
    usePresenceStore.getState().removeParticipant(targetParticipantId);
  }

  async transferHost(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'transfer-host',
      targetParticipantId,
    });
    usePresenceStore.getState().setHostId(targetParticipantId);
  }

  async setRoomLocked(locked: boolean): Promise<void> {
    await this.publishDirective({
      action: 'lock-room',
      isLocked: locked,
    });
    useHostControlStore.getState().setRoomLocked(locked);
  }

  async setWaitingRoomEnabled(enabled: boolean): Promise<void> {
    await this.publishDirective({
      action: 'set-waiting-room',
      isWaitingRoomEnabled: enabled,
    });
    useHostControlStore.getState().setWaitingRoomEnabled(enabled);
  }

  async admitParticipant(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'waiting-room-admit',
      targetParticipantId,
    });
    useHostControlStore.getState().removeWaitingParticipant(targetParticipantId);
  }

  async rejectParticipant(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'waiting-room-reject',
      targetParticipantId,
    });
    useHostControlStore.getState().removeWaitingParticipant(targetParticipantId);
  }

  async updatePermissions(permissions: Partial<MeetingPermissions>): Promise<void> {
    await this.publishDirective({
      action: 'update-permissions',
      permissions,
    });
    useHostControlStore.getState().updatePermissions(permissions);
  }

  async knockWaitingRoom(name?: string): Promise<void> {
    const presence = usePresenceStore.getState();
    const localId = presence.localParticipantId || '';
    const participantName = name || presence.participants.get(localId)?.name || 'Guest';

    await this.publishDirective({
      action: 'waiting-room-knock',
      targetParticipantId: localId,
      participantName,
    });
  }
}
