/**
 * LiveKit Presence Adapter (M2 Phase A2)
 *
 * Decouples LiveKit Room events and DataChannel signaling from UI components.
 * Translates low-level provider events into high-level PresenceStore domain actions.
 *
 * Invariants:
 * 1. 100% ephemeral: zero persistence.
 * 2. CPU-efficient: relies directly on provider active speaker events (no local WebAudio FFT loop).
 * 3. Standardized quality metrics through ConnectionQualityAggregator.
 */

import { Room, RoomEvent, Participant, ConnectionQuality as LKConnectionQuality } from 'livekit-client';
import { usePresenceStore } from './presenceStore';
import { ConnectionQualityRating } from './types';

export const HAND_RAISE_TOPIC = 'presence-hand-raise';

export class PresenceAdapter {
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
    const store = usePresenceStore.getState();

    // 1. Synchronize initial local participant
    if (room.localParticipant) {
      store.setLocalParticipant({
        id: room.localParticipant.identity,
        name: room.localParticipant.name || `User (${room.localParticipant.identity.slice(0, 6)})`,
        audioEnabled: room.localParticipant.isMicrophoneEnabled,
        videoEnabled: room.localParticipant.isCameraEnabled,
        screenSharing: room.localParticipant.isScreenShareEnabled,
        isSpeaking: room.localParticipant.isSpeaking,
        connectionQuality: this.mapLKQuality(room.localParticipant.connectionQuality),
        isHandRaised: false,
        isHost: true, // Local creator starts as host by default
        joinedAt: Date.now(),
      });
    }

    // 2. Synchronize existing remote participants
    for (const remote of room.remoteParticipants.values()) {
      store.upsertParticipant({
        id: remote.identity,
        name: remote.name || `User (${remote.identity.slice(0, 6)})`,
        isLocal: false,
        audioEnabled: remote.isMicrophoneEnabled,
        videoEnabled: remote.isCameraEnabled,
        screenSharing: remote.isScreenShareEnabled,
        isSpeaking: remote.isSpeaking,
        connectionQuality: this.mapLKQuality(remote.connectionQuality),
        isHandRaised: false,
        isHost: false,
        joinedAt: Date.now(),
      });
    }

    // 3. Setup event listeners
    const onParticipantConnected = (participant: Participant) => {
      const name = participant.name || `User (${participant.identity.slice(0, 6)})`;
      store.upsertParticipant({
        id: participant.identity,
        name,
        isLocal: false,
        audioEnabled: participant.isMicrophoneEnabled,
        videoEnabled: participant.isCameraEnabled,
        screenSharing: participant.isScreenShareEnabled,
        isSpeaking: participant.isSpeaking,
        connectionQuality: this.mapLKQuality(participant.connectionQuality),
        isHandRaised: false,
        isHost: false,
        joinedAt: Date.now(),
      });

      store.pushToast({
        type: 'join',
        title: `${name} joined`,
        participantId: participant.identity,
        durationMs: 4000,
      });
    };

    const onParticipantDisconnected = (participant: Participant) => {
      const name = participant.name || `User (${participant.identity.slice(0, 6)})`;
      store.removeParticipant(participant.identity);

      store.pushToast({
        type: 'leave',
        title: `${name} left`,
        participantId: participant.identity,
        durationMs: 4000,
      });
    };

    const onActiveSpeakersChanged = (speakers: Participant[]) => {
      const speakerIds = speakers.map((s) => s.identity);
      store.setActiveSpeakers(speakerIds);
    };

    const onConnectionQualityChanged = (quality: LKConnectionQuality, participant: Participant) => {
      const rating = this.mapLKQuality(quality);
      store.setConnectionQuality(participant.identity, rating);
    };

    const onTrackMuted = (pub: any, participant: Participant) => {
      if (pub.kind === 'audio') {
        store.updateParticipantTracks(participant.identity, { audioEnabled: false });
      } else if (pub.kind === 'video') {
        store.updateParticipantTracks(participant.identity, { videoEnabled: false });
      }
    };

    const onTrackUnmuted = (pub: any, participant: Participant) => {
      if (pub.kind === 'audio') {
        store.updateParticipantTracks(participant.identity, { audioEnabled: true });
      } else if (pub.kind === 'video') {
        store.updateParticipantTracks(participant.identity, { videoEnabled: true });
      }
    };

    const onDataReceived = (payload: Uint8Array, participant?: Participant, _kind?: any, topic?: string) => {
      if (topic !== HAND_RAISE_TOPIC) return;

      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);

        if (data.type === 'hand-raise' && typeof data.participantId === 'string') {
          const raised = Boolean(data.raised);
          usePresenceStore.getState().setHandRaised(data.participantId, raised, data.timestamp);

          if (raised) {
            const currentStore = usePresenceStore.getState();
            const p = currentStore.participants.get(data.participantId);
            const name = p?.name || `User (${data.participantId.slice(0, 6)})`;
            currentStore.pushToast({
              type: 'hand',
              title: `${name} raised hand`,
              participantId: data.participantId,
              durationMs: 4000,
            });
          }
        }
      } catch (err) {
        console.warn('[PresenceAdapter] Failed to parse DataChannel message:', err);
      }
    };

    // Register listeners on room
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    room.on(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    room.on(RoomEvent.DataReceived, onDataReceived);

    this.unsubscribers.push(() => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
      room.off(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.off(RoomEvent.DataReceived, onDataReceived);
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

  /**
   * Broadcast hand raise state over reliable DataChannel to all participants.
   */
  async publishHandRaise(raised: boolean): Promise<void> {
    if (!this.room || !this.room.localParticipant) {
      throw new Error('Cannot publish hand-raise: room not connected');
    }

    const participantId = this.room.localParticipant.identity;
    const timestamp = Date.now();

    // 1. Update local store immediately
    usePresenceStore.getState().setHandRaised(participantId, raised, timestamp);

    // 2. Broadcast via DataChannel
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: 'hand-raise',
        participantId,
        raised,
        timestamp,
      })
    );

    await this.room.localParticipant.publishData(payload, {
      reliable: true,
      topic: HAND_RAISE_TOPIC,
    });
  }

  private mapLKQuality(quality?: LKConnectionQuality): ConnectionQualityRating {
    if (quality === undefined) return 'good';
    switch (quality) {
      case LKConnectionQuality.Excellent:
        return 'excellent';
      case LKConnectionQuality.Good:
        return 'good';
      case LKConnectionQuality.Poor:
        return 'poor';
      case LKConnectionQuality.Lost:
      default:
        return 'disconnected';
    }
  }
}
