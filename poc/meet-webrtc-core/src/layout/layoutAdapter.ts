/**
 * LiveKit Layout Adapter (M2 Phase B)
 *
 * Decouples layout orchestration from raw transport events.
 * Translates active speakers, screen share publications, and DataChannel
 * spotlight events into LayoutStore actions.
 */

import { Room, RoomEvent, Participant, Track, RemoteTrack, TrackPublication, RemoteTrackPublication } from 'livekit-client';
import { useLayoutStore } from './layoutStore';
import { usePresenceStore } from '../presence/presenceStore';
import { SpotlightDataChannelMessage } from './types';

export const SPOTLIGHT_TOPIC = 'layout-spotlight';

export class LayoutAdapter {
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(room?: Room) {
    if (room) {
      this.attach(room);
    }
  }

  attach(room: Room): void {
    this.detach();
    this.room = room;
    const layoutStore = useLayoutStore.getState();

    // 1. Initial Screen Share state inspection
    let initialScreenOwner: string | null = null;
    if (room.localParticipant?.isScreenShareEnabled) {
      initialScreenOwner = room.localParticipant.identity;
    } else if (room.remoteParticipants) {
      for (const remote of room.remoteParticipants.values()) {
        if (remote?.trackPublications) {
          for (const pub of remote.trackPublications.values()) {
            if (pub.source === Track.Source.ScreenShare && pub.isSubscribed) {
              initialScreenOwner = remote.identity;
              break;
            }
          }
        }
        if (initialScreenOwner) break;
      }
    }
    if (initialScreenOwner) {
      layoutStore.setScreenShareOwner(initialScreenOwner);
    }

    // 2. Track Subscription for remote screen sharing
    const onTrackSubscribed = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: Participant
    ) => {
      if (track.source === Track.Source.ScreenShare) {
        useLayoutStore.getState().setScreenShareOwner(participant.identity);
      }
    };

    const onTrackUnsubscribed = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: Participant
    ) => {
      if (track.source === Track.Source.ScreenShare) {
        const currentOwner = useLayoutStore.getState().screenShareOwnerId;
        if (currentOwner === participant.identity) {
          useLayoutStore.getState().setScreenShareOwner(null);
        }
      }
    };

    // 3. Local screen share track published / unpublished
    const onLocalTrackPublished = (publication: TrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        const localId = room.localParticipant?.identity || 'local';
        useLayoutStore.getState().setScreenShareOwner(localId);
      }
    };

    const onLocalTrackUnpublished = (publication: TrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        useLayoutStore.getState().setScreenShareOwner(null);
      }
    };

    // 4. DataChannel listener for spotlight coordination
    const onDataReceived = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: any,
      topic?: string
    ) => {
      if (topic !== SPOTLIGHT_TOPIC) return;

      try {
        const text = new TextDecoder().decode(payload);
        const msg = JSON.parse(text) as SpotlightDataChannelMessage;

        if (msg.type === 'spotlight') {
          const presence = usePresenceStore.getState();
          const hostId = presence.hostId;
          const senderId = participant?.identity;

          // Verify authority: host can always spotlight. If hostId not set, allow sender.
          if (!hostId || senderId === hostId || presence.participants.get(senderId || '')?.isHost) {
            useLayoutStore.getState().setSpotlight(msg.participantId);
          } else {
            console.warn('[LayoutAdapter] Rejected unauthorized spotlight from:', senderId);
          }
        }
      } catch (err) {
        console.error('[LayoutAdapter] Failed to parse spotlight message:', err);
      }
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.DataReceived, onDataReceived);

    this.unsubscribers.push(() => {
      const remove = typeof room.off === 'function'
        ? room.off.bind(room)
        : typeof (room as any).removeListener === 'function'
        ? (room as any).removeListener.bind(room)
        : null;

      if (remove) {
        remove(RoomEvent.TrackSubscribed, onTrackSubscribed);
        remove(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        remove(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
        remove(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
        remove(RoomEvent.DataReceived, onDataReceived);
      }
    });

    // 5. Presence Store subscription for active speakers sync
    const unsubPresence = usePresenceStore.subscribe((presenceState) => {
      const activeList = Array.from(presenceState.activeSpeakers);
      if (activeList.length > 0) {
        const localId = presenceState.localParticipantId;
        const remoteSpeaker = activeList.find((id) => id !== localId);
        useLayoutStore.getState().setActiveSpeaker(remoteSpeaker || activeList[0]);
      }
    });

    this.unsubscribers.push(unsubPresence);
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
}
