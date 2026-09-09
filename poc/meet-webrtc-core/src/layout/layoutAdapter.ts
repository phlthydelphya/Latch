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
import { SpeakerSmoothingEngine } from './speakerSmoothing';

export const SPOTLIGHT_TOPIC = 'layout-spotlight';

export class LayoutAdapter {
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];
  private speakerSmoothingEngine: SpeakerSmoothingEngine = new SpeakerSmoothingEngine();
  private smoothingInterval: any = null;

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

          // Verify authority: host can always spotlight.
          if (hostId && senderId === hostId) {
            useLayoutStore.getState().setSpotlight(msg.participantId);
          } else {
            console.warn('[LayoutAdapter] Rejected unauthorized spotlight from:', senderId);
          }
        }
      } catch (err) {
        console.error('[LayoutAdapter] Failed to parse spotlight message:', err);
      }
    };

    // 5. Active speaker smoothing integration (M3A Category 2)
    const onActiveSpeakersChanged = (speakers: Participant[]) => {
      const now = Date.now();
      const speakingIds = new Set<string>();

      for (const speaker of speakers) {
        speakingIds.add(speaker.identity);
        const energy = typeof (speaker as any).audioLevel === 'number' && (speaker as any).audioLevel > 0
          ? (speaker as any).audioLevel
          : 0.85;
        this.speakerSmoothingEngine.updateEnergy(speaker.identity, energy, now);
      }

      if (room.remoteParticipants) {
        for (const remote of room.remoteParticipants.values()) {
          if (!speakingIds.has(remote.identity)) {
            this.speakerSmoothingEngine.updateEnergy(remote.identity, 0, now);
          }
        }
      }
      this.evaluateSpeakerAndLayout(now);
    };

    const onParticipantDisconnected = (participant: Participant) => {
      this.speakerSmoothingEngine.removeSpeaker(participant.identity);
      this.evaluateSpeakerAndLayout();
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.DataReceived, onDataReceived);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

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
        remove(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
        remove(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      }
    });

    // 6. Presence Store subscription for active speakers sync
    const unsubPresence = usePresenceStore.subscribe((presenceState) => {
      const activeList = Array.from(presenceState.activeSpeakers);
      const now = Date.now();
      if (activeList.length > 0) {
        for (const id of activeList) {
          this.speakerSmoothingEngine.updateEnergy(id, 0.85, now);
        }
      }
      this.evaluateSpeakerAndLayout(now);
    });

    this.unsubscribers.push(unsubPresence);

    // 7. Periodic evaluation ticker for hysteresis hold expiration and continuous speech qualification
    this.smoothingInterval = setInterval(() => {
      const now = Date.now();
      const activeList = Array.from(usePresenceStore.getState().activeSpeakers);
      for (const id of activeList) {
        this.speakerSmoothingEngine.updateEnergy(id, 0.85, now);
      }
      this.evaluateSpeakerAndLayout(now);
    }, 150);
  }

  public evaluateSpeakerAndLayout(now: number = Date.now()): void {
    const electedSpeaker = this.speakerSmoothingEngine.resolveActiveSpeaker(now);
    const confidence = electedSpeaker ? this.speakerSmoothingEngine.getConfidence(electedSpeaker, now) : 0;
    const current = useLayoutStore.getState().activeSpeakerId;
    const currentConf = useLayoutStore.getState().speakerConfidence;

    if (electedSpeaker !== current || Math.abs(confidence - currentConf) > 0.05) {
      useLayoutStore.getState().setActiveSpeaker(electedSpeaker, confidence);
    }
  }

  public getSpeakerSmoothingEngine(): SpeakerSmoothingEngine {
    return this.speakerSmoothingEngine;
  }

  detach(): void {
    if (this.smoothingInterval) {
      clearInterval(this.smoothingInterval);
      this.smoothingInterval = null;
    }
    this.speakerSmoothingEngine.reset();
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.room = null;
  }
}
