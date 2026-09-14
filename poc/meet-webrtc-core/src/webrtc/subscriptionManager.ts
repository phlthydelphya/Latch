/**
 * Subscription Manager (M3B Multi-Stream Architecture)
 *
 * Enforces dynamic client-driven WebRTC track subscription management and dynamic Last-N gating.
 * Integrates useLayoutStore and BandwidthEngine with LiveKit RemoteTrackPublications.
 *
 * Authoritative Rules:
 * 1. Audio tracks are always 100% subscribed (Opus never throttled).
 * 2. DC-1 Priority Participant Override:
 *    Priority participants = Stage Participant + Pinned + Spotlight + Active Speaker + Screen Sharer.
 *    Any priority participant remains subscribed regardless of gallery page assignment.
 * 3. DC-2 Dynamic Last-N:
 *    Effective Video N is governed by BandwidthEngine (Optimal: 9, Mild: 9, Moderate: 6, Severe: 4, Emergency: 0).
 * 4. DC-3 Subscription Policy Model:
 *    Separates subscription status (boolean) from spatial layer quality (VideoQuality).
 * 5. Off-page participants not in the priority set have video subscriptions paused (subscribed: false).
 * 6. Emergency audio-only tier pauses all video tracks (effective N = 0).
 */

import { Room, RoomEvent, Participant, RemoteTrackPublication, Track, VideoQuality } from 'livekit-client';
import { useLayoutStore } from '../layout/layoutStore';
import { layoutEngine } from '../layout/layoutEngine';
import { BandwidthTier } from '../layout/types';

export interface SubscriptionPolicy {
  subscribed: boolean;
  quality: VideoQuality;
}

export class SubscriptionManager {
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];
  private isEvaluating = false;
  private activePolicies = new Map<string, SubscriptionPolicy>();

  constructor(room?: Room) {
    if (room) {
      this.attach(room);
    }
  }

  attach(room: Room): void {
    this.detach();
    this.room = room;

    // 1. Listen to LayoutStore changes (visibleTileIds, active speaker, pins, spotlight, bandwidth tier)
    const unsubStore = useLayoutStore.subscribe(() => {
      this.evaluateSubscriptions();
    });
    this.unsubscribers.push(unsubStore);

    // 2. Listen to LiveKit room track and participant lifecycle events
    const onTrackPublished = (_pub: RemoteTrackPublication, _p: Participant) => {
      this.evaluateSubscriptions();
    };

    const onParticipantConnected = (_p: Participant) => {
      this.evaluateSubscriptions();
    };

    const onParticipantDisconnected = (_p: Participant) => {
      this.evaluateSubscriptions();
    };

    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    this.unsubscribers.push(() => {
      const remove =
        typeof room.off === 'function'
          ? room.off.bind(room)
          : typeof (room as any).removeListener === 'function'
          ? (room as any).removeListener.bind(room)
          : null;

      if (remove) {
        remove(RoomEvent.TrackPublished, onTrackPublished);
        remove(RoomEvent.ParticipantConnected, onParticipantConnected);
        remove(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      }
    });

    // Initial evaluation
    this.evaluateSubscriptions();
  }

  /**
   * Helper to derive effective Last-N from bandwidth tier (DC-2).
   */
  public getEffectiveVideoN(tier: BandwidthTier): number {
    switch (tier) {
      case 'optimal':
      case 'congested-mild':
        return 9;
      case 'congested-moderate':
        return 6;
      case 'congested-severe':
        return 4;
      case 'emergency-audio-only':
        return 0;
      default:
        return 9;
    }
  }

  /**
   * Computes the subscription policy map for all remote participants based on current layout & bandwidth.
   */
  public computeSubscriptionPolicies(): Map<string, SubscriptionPolicy> {
    const policies = new Map<string, SubscriptionPolicy>();
    if (!this.room?.remoteParticipants) return policies;

    const layoutState = useLayoutStore.getState();
    const { visibleTileIds, bandwidthTier } = layoutState;
    const effectiveN = this.getEffectiveVideoN(bandwidthTier);

    if (effectiveN === 0) {
      // Emergency Audio Only: all video unsubscribed
      for (const remote of this.room.remoteParticipants.values()) {
        policies.set(remote.identity, {
          subscribed: false,
          quality: VideoQuality.LOW,
        });
      }
      return policies;
    }

    // Determine stage participant via layoutEngine
    const stageParticipantId = layoutEngine.resolveStageParticipant({
      hasScreenShare: Boolean(layoutState.screenShareOwnerId),
      screenShareOwnerId: layoutState.screenShareOwnerId,
      spotlightParticipantId: layoutState.spotlightParticipantId,
      pinnedParticipantId: layoutState.pinnedParticipantId,
      activeSpeakerId: layoutState.activeSpeakerId,
      speakerConfidence: layoutState.speakerConfidence,
      userLockedMode: layoutState.userLockedMode,
      totalParticipants: (this.room.remoteParticipants.size ?? 0) + 1,
    });

    // DC-1: Collect Priority Participants (Priority Set)
    // Stage Participant + Pinned Participant + Spotlighted Participant + Active Speaker + Screen Sharer
    const priorityIds: string[] = [];
    const seen = new Set<string>();

    const addPriority = (id: string | null) => {
      if (id && !seen.has(id) && this.room?.remoteParticipants.has(id)) {
        seen.add(id);
        priorityIds.push(id);
      }
    };

    addPriority(stageParticipantId);
    if (layoutState.pinnedParticipantIds && layoutState.pinnedParticipantIds.length > 0) {
      for (const pinId of layoutState.pinnedParticipantIds) {
        addPriority(pinId);
      }
    }
    addPriority(layoutState.pinnedParticipantId);
    addPriority(layoutState.spotlightParticipantId);
    addPriority(layoutState.activeSpeakerId);
    addPriority(layoutState.screenShareOwnerId);

    // Build the ordered candidates for video subscription:
    // 1. Priority participants first
    // 2. Visible gallery participants on the current page second
    const candidates: string[] = [...priorityIds];

    for (const vid of visibleTileIds) {
      if (!seen.has(vid) && this.room.remoteParticipants.has(vid)) {
        seen.add(vid);
        candidates.push(vid);
      }
    }

    // Subscribe up to effectiveN candidates
    const subscribedSet = new Set(candidates.slice(0, effectiveN));

    // Determine quality per subscribed participant
    for (const remote of this.room.remoteParticipants.values()) {
      const id = remote.identity;
      const isSubscribed = subscribedSet.has(id);
      let quality = VideoQuality.LOW;

      if (isSubscribed) {
        if (id === stageParticipantId) {
          // Adapt stage quality based on congestion tier
          if (bandwidthTier === 'congested-severe') {
            quality = VideoQuality.LOW;
          } else if (bandwidthTier === 'congested-moderate') {
            quality = VideoQuality.MEDIUM;
          } else {
            quality = VideoQuality.HIGH;
          }
        } else if (this.room.remoteParticipants.size <= 4 && bandwidthTier === 'optimal') {
          quality = VideoQuality.MEDIUM;
        } else {
          quality = VideoQuality.LOW;
        }
      }

      policies.set(id, {
        subscribed: isSubscribed,
        quality,
      });
    }

    return policies;
  }

  /**
   * Evaluates and applies subscription and quality settings across all remote tracks.
   */
  public evaluateSubscriptions(): void {
    if (!this.room || this.isEvaluating) return;
    this.isEvaluating = true;

    try {
      const policies = this.computeSubscriptionPolicies();
      this.activePolicies = policies;

      const remotes = this.room.remoteParticipants;
      if (!remotes) return;

      for (const remote of remotes.values()) {
        const id = remote.identity;
        const policy = policies.get(id) ?? { subscribed: false, quality: VideoQuality.LOW };

        if (!remote.trackPublications) continue;

        for (const pub of remote.trackPublications.values()) {
          const remotePub = pub as RemoteTrackPublication;

          // 1. Audio Tracks: Always 100% subscribed unconditionally
          if (pub.kind === Track.Kind.Audio) {
            if (remotePub.setSubscribed && !remotePub.isSubscribed) {
              remotePub.setSubscribed(true);
            }
            continue;
          }

          // 2. Video Tracks
          if (pub.kind === Track.Kind.Video) {
            if (remotePub.setSubscribed) {
              if (policy.subscribed && !remotePub.isSubscribed) {
                remotePub.setSubscribed(true);
              } else if (!policy.subscribed && remotePub.isSubscribed) {
                remotePub.setSubscribed(false);
              }
            }

            // Set Video Quality
            if (policy.subscribed && remotePub.setVideoQuality) {
              remotePub.setVideoQuality(policy.quality);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[SubscriptionManager] Error updating subscriptions:', err);
    } finally {
      this.isEvaluating = false;
    }
  }

  /**
   * Diagnostic inspector for active track subscription policies (DC-3 / DC-6).
   */
  public getSubscriptionPolicies(): Map<string, SubscriptionPolicy> {
    return new Map(this.activePolicies);
  }

  /**
   * Diagnostic inspector for active track subscriptions.
   */
  public getSubscriptionStats(): { videoSubscribed: number; audioSubscribed: number; totalRemoteTracks: number } {
    let videoSubscribed = 0;
    let audioSubscribed = 0;
    let totalRemoteTracks = 0;

    if (this.room?.remoteParticipants) {
      for (const remote of this.room.remoteParticipants.values()) {
        if (!remote.trackPublications) continue;
        for (const pub of remote.trackPublications.values()) {
          totalRemoteTracks++;
          if ((pub as RemoteTrackPublication).isSubscribed) {
            if (pub.kind === Track.Kind.Video) videoSubscribed++;
            if (pub.kind === Track.Kind.Audio) audioSubscribed++;
          }
        }
      }
    }

    return { videoSubscribed, audioSubscribed, totalRemoteTracks };
  }

  detach(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.room = null;
    this.activePolicies.clear();
  }
}
