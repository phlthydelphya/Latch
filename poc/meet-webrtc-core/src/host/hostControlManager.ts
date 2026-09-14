import { Room, RoomEvent, Participant, Track } from 'livekit-client';
import { useHostControlStore } from './hostControlStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useAppStore } from '../store/appStore';
import {
  HOST_CONTROL_TOPIC,
  HostDirectiveMessage,
  MeetingPermissions,
} from './types';
import { HostTokenVerifier } from './hostTokenVerifier';
import { usePermissionsStore } from '../hooks/usePermissions';

export class HostControlManager {
  private static instance: HostControlManager | null = null;
  private room: Room | null = null;
  private unsubscribers: Array<() => void> = [];
  private localHostToken: string | null = null;
  private hostPublicKey: string | null = null;
  private activeRoomId: string | null = null;
  private coHostIds: Set<string> = new Set();

  static getInstance(): HostControlManager {
    if (!HostControlManager.instance) {
      HostControlManager.instance = new HostControlManager();
    }
    return HostControlManager.instance;
  }

  setSessionContext(ctx: {
    roomId: string;
    localParticipantId?: string;
    hostToken?: string | null;
    hostKey?: string | null;
  }): void {
    if (ctx.roomId) this.activeRoomId = ctx.roomId;
    if (ctx.hostToken !== undefined) this.localHostToken = ctx.hostToken;
    if (ctx.hostKey !== undefined) this.hostPublicKey = ctx.hostKey;
  }

  setLocalHostToken(token: string | null, hostKey?: string | null): void {
    this.localHostToken = token;
    if (hostKey) this.hostPublicKey = hostKey;
  }

  getLocalHostToken(): string | null {
    return this.localHostToken;
  }

  getHostPublicKey(): string | null {
    return this.hostPublicKey;
  }

  getCoHostIds(): Set<string> {
    return new Set(this.coHostIds);
  }

  isCoHost(participantId: string): boolean {
    return this.coHostIds.has(participantId) || usePermissionsStore.getState().coHostIds.has(participantId);
  }

  addCoHostId(participantId: string): void {
    this.coHostIds.add(participantId);
    usePermissionsStore.getState().addCoHost(participantId);
  }

  removeCoHostId(participantId: string): void {
    this.coHostIds.delete(participantId);
    usePermissionsStore.getState().removeCoHost(participantId);
  }

  clearCoHostIds(): void {
    this.coHostIds.clear();
    usePermissionsStore.getState().setCoHosts([]);
  }

  private async terminateLocalScreenShare(): Promise<void> {
    // Synchronously update local store immediately to avoid UI lag and test race conditions
    useAppStore.getState().setLocalScreenShare(false);

    const local = this.room?.localParticipant;
    try {
      if (local?.setScreenShareEnabled) {
        await local.setScreenShareEnabled(false);
      }
    } catch (err) {
      console.warn('[HostControlManager] Failed to disable screen share on local participant:', err);
    }

    try {
      const pub = (local as any)?.getTrackPublication?.(Track?.Source?.ScreenShare) ||
                  (local as any)?.getTrackPublication?.('screen_share') ||
                  (local as any)?.getTrackPublication?.('screen');
      if (pub?.track?.mediaStreamTrack && typeof pub.track.mediaStreamTrack.stop === 'function') {
        pub.track.mediaStreamTrack.stop();
      }
    } catch {}

    try {
      if ((local as any)?.videoTracks) {
        (local as any).videoTracks.forEach((publication: any) => {
          if (publication.source === Track?.Source?.ScreenShare || publication.source === 'screen_share') {
            if (publication.track?.mediaStreamTrack && typeof publication.track.mediaStreamTrack.stop === 'function') {
              publication.track.mediaStreamTrack.stop();
            }
          }
        });
      }
    } catch {}

    try {
      const { ScreenShareManager } = await import('../screen/manager').catch(() => ({ ScreenShareManager: null }));
      if (ScreenShareManager && typeof (ScreenShareManager as any).getInstance === 'function') {
        const mgr = (ScreenShareManager as any).getInstance();
        if (mgr && typeof mgr.stopScreenShare === 'function') {
          await mgr.stopScreenShare().catch(() => {});
        }
      }
    } catch {}
  }

  reset(): void {
    this.localHostToken = null;
    this.hostPublicKey = null;
    this.activeRoomId = null;
    this.clearCoHostIds();
  }

  attach(room: Room): void {
    this.detach();
    this.room = room;

    const onDataReceived = async (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: any,
      topic?: string
    ) => {
      if (topic !== HOST_CONTROL_TOPIC) return;

      try {
        const text = new TextDecoder().decode(payload);
        const msg = JSON.parse(text) as HostDirectiveMessage;
        // SEC01: Use participant?.identity as primary sender identity
        // Exception: server-relayed messages come from participant "system" with actual sender in msg.senderId
        let senderId = participant?.identity || '';
        if (!senderId) {
          console.warn('[HostControlManager] Dropped directive - no sender identity from participant');
          return;
        }
        // For server-relayed messages (participant "system"), use msg.senderId but it will be verified against token sub
        const isServerRelay = senderId === 'system';
        const verificationSenderId = isServerRelay ? (msg.senderId || '') : senderId;
        if (isServerRelay && !verificationSenderId) {
          console.warn('[HostControlManager] Dropped server-relayed directive - missing msg.senderId');
          return;
        }
        const presence = usePresenceStore.getState();
        const appState = useAppStore.getState();
        const localId =
          presence.localParticipantId ||
          this.room?.localParticipant?.identity ||
          appState.participantId ||
          appState.localParticipant?.id ||
          '';
        const myIdentities = new Set<string>(
          [
            presence.localParticipantId,
            this.room?.localParticipant?.identity,
            appState.participantId,
            appState.localParticipant?.id,
          ].filter(Boolean) as string[]
        );
        const isLocalHost = Boolean(
          presence.hostId && (presence.hostId === localId || myIdentities.has(presence.hostId))
        );

        // Knock messages are sent by attendees to the host
        if (msg.action === 'waiting-room-knock') {
          if (isLocalHost) {
            const knockerId = msg.targetParticipantId || senderId;
            const knockerName =
              msg.participantName ||
              presence.participants.get(knockerId)?.name ||
              participant?.name ||
              `Guest (${knockerId.slice(0, 6)})`;

            const currentQueue = useHostControlStore.getState().waitingQueue;
            const alreadyQueued = currentQueue.some((p) => p.participantId === knockerId);

            if (!alreadyQueued) {
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
          }
          return;
        }

        // host-changed event from server or host - require verified hostToken
        if (msg.action === 'host-changed') {
          if (!msg.hostToken) {
            console.warn('[HostControlManager] Rejected host-changed - missing hostToken (anomaly logged)');
            return;
          }
          // Fall through to M4A verification pipeline
        }

        // host-announce event: informs new joiners who the current host is without triggering a "Host Transfer" toast - require verified hostToken
        if (msg.action === 'host-announce') {
          if (!msg.hostToken) {
            console.warn('[HostControlManager] Rejected host-announce - missing hostToken (anomaly logged)');
            return;
          }
          // Fall through to M4A verification pipeline
        }

        // host-query event: newcomer asks for current host identity - SEC01: only reply if self holds valid host token
        if (msg.action === 'host-query') {
          if (isLocalHost && localId && this.localHostToken) {
            this.publishDirective({
              action: 'host-announce',
              newHostId: localId,
              hostToken: this.localHostToken,
              hostKey: this.hostPublicKey || undefined,
            }).catch(() => {});
          }
          // SEC01: never broadcast hostPublicKey to unauthenticated queryers
          return;
        }

        // M4A: Cryptographic Verification of Moderation Directives
        const activeRoomId = (this.activeRoomId || appState.roomId || this.room?.name || '').trim();
        let isAuthorized = false;

        const establishedHostId = usePresenceStore.getState().hostId;
        const isSenderCoHost = this.isCoHost(senderId) || usePermissionsStore.getState().coHostIds.has(senderId);

        // If an established host is already known, the sender MUST be that host, a co-host, or local self
        // Exception: server-relayed messages (participant "system") are allowed to pass through for verification
        if (establishedHostId && !isServerRelay && senderId !== establishedHostId && !isSenderCoHost && !myIdentities.has(senderId)) {
          console.warn(
            `[HostControlManager] Rejected directive '${msg.action}' from ${senderId}: Does not match established host ${establishedHostId}`
          );
          return;
        }

        // If sender is a co-host, enforce target hierarchy and action matrix
        if (isSenderCoHost && senderId !== establishedHostId) {
          const allowedCoHostActions = [
            'mute-participant',
            'remove-participant',
            'spotlight-participant',
            'stop-participant-share',
            'waiting-room-admit',
            'waiting-room-reject',
          ];
          if (!allowedCoHostActions.includes(msg.action)) {
            console.warn(
              `[HostControlManager] Rejected co-host directive '${msg.action}': Action requires Host role`
            );
            return;
          }
          const targetId = msg.targetParticipantId;
          if (targetId) {
            const isTargetHost = targetId === establishedHostId;
            const isTargetCoHost = this.isCoHost(targetId) || usePermissionsStore.getState().coHostIds.has(targetId);
            if (isTargetHost || isTargetCoHost) {
              console.warn(
                `[HostControlManager] Rejected co-host directive '${msg.action}' targeting ${targetId}: Co-hosts cannot moderate equal or higher tier participants`
              );
              return;
            }
          }
        }

        if (msg.hostToken) {
          const verification = this.hostPublicKey
            ? await HostTokenVerifier.verifyDirective(
                msg,
                activeRoomId,
                verificationSenderId,
                this.hostPublicKey
              )
            : HostTokenVerifier.verifyClaimsSync(msg, activeRoomId, verificationSenderId);

          if (verification.valid) {
            isAuthorized = true;
            // Cryptographically proven host: establish as authoritative host if not already set
            if (!establishedHostId && (verification.claims?.role === 'host' || !verification.claims?.role)) {
              usePresenceStore.getState().setAuthoritativeHost(verificationSenderId);
            }
          } else {
            console.warn(
              `[HostControlManager] Rejected invalid hostToken directive '${msg.action}' from ${senderId}: ${verification.error}`
            );
            return;
          }
        } else {
          // All directives require verified hostToken (except waiting-room-knock/host-query handled earlier)
          if (import.meta.env?.PROD || import.meta.env?.TEST) {
            console.warn(
              `[HostControlManager] Rejected tokenless directive '${msg.action}' from ${senderId}: No hostToken provided (anomaly logged)`
            );
            return;
          }
          // If no hostToken attached (e.g. dev mode without host token), check if senderId is established host
          if (establishedHostId && (senderId === establishedHostId || myIdentities.has(senderId))) {
            isAuthorized = true;
          } else if (isSenderCoHost) {
            isAuthorized = true;
          } else if (!establishedHostId) {
            const allowedUnestablishedActions = [
              'waiting-room-admit',
              'waiting-room-reject',
              'set-waiting-room',
              'host-announce',
            ];
            if (allowedUnestablishedActions.includes(msg.action)) {
              isAuthorized = true;
            }
          }
        }

        if (!isAuthorized) {
          console.warn(
            `[HostControlManager] Rejected directive '${msg.action}' from ${senderId}: Not an authorized moderator (current host: ${establishedHostId})`
          );
          return;
        }

        const isTargetLocal = (targetId?: string): boolean => {
          if (!targetId) return false;
          return targetId === '*' || targetId === localId || myIdentities.has(targetId);
        };

        switch (msg.action) {
          case 'mute-participant': {
            if (isTargetLocal(msg.targetParticipantId)) {
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
            if (isTargetLocal(msg.targetParticipantId)) {
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
              const isTargetLocalHost = isTargetLocal(msg.targetParticipantId);
              usePresenceStore.getState().setAuthoritativeHost(msg.targetParticipantId);
              if (!isTargetLocalHost) {
                this.localHostToken = null;
                useAppStore.getState().clearHostAuthority();
              }
              const newHostName =
                presence.participants.get(msg.targetParticipantId)?.name ||
                (isTargetLocalHost ? 'You' : 'Participant');

              usePresenceStore.getState().pushToast({
                type: 'host',
                title: 'Host Transfer',
                message: isTargetLocalHost
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
            const enabled = !!msg.isWaitingRoomEnabled;
            useHostControlStore.getState().setWaitingRoomEnabled(enabled);
            if (!enabled && useHostControlStore.getState().isWaitingInLobby) {
              useHostControlStore.getState().setIsWaitingInLobby(false);
              if (this.room?.localParticipant) {
                const shouldPublishVideo = useAppStore.getState().localParticipant?.videoEnabled ?? true;
                if (shouldPublishVideo) {
                  this.room.localParticipant.setCameraEnabled(true).catch(() => {});
                }
                const shouldPublishAudio = useAppStore.getState().localParticipant?.audioEnabled ?? true;
                if (shouldPublishAudio) {
                  this.room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
                }
              }
            }
            break;
          }

          case 'waiting-room-admit': {
            if (msg.targetParticipantId) {
              useHostControlStore.getState().admitParticipantId(msg.targetParticipantId);
              if (isTargetLocal(msg.targetParticipantId)) {
                useHostControlStore.getState().setIsWaitingInLobby(false);
                usePresenceStore.getState().pushToast({
                  type: 'info',
                  title: 'Admitted',
                  message: 'The host admitted you to the meeting',
                  durationMs: 4000,
                });

                // Auto-publish camera and microphone now that guest is admitted
                if (this.room?.localParticipant) {
                  const shouldPublishVideo = useAppStore.getState().localParticipant?.videoEnabled ?? true;
                  if (shouldPublishVideo) {
                    this.room.localParticipant.setCameraEnabled(true).catch((e) => {
                      console.warn('[HostControlManager] Post-admit camera enable failed:', e);
                    });
                  }
                  const shouldPublishAudio = useAppStore.getState().localParticipant?.audioEnabled ?? true;
                  if (shouldPublishAudio) {
                    this.room.localParticipant.setMicrophoneEnabled(true).catch((e) => {
                      console.warn('[HostControlManager] Post-admit mic enable failed:', e);
                    });
                  }
                }
              }
            }
            break;
          }

          case 'waiting-room-reject': {
            if (msg.targetParticipantId) {
              useHostControlStore.getState().removeWaitingParticipant(msg.targetParticipantId);
              if (isTargetLocal(msg.targetParticipantId)) {
                useHostControlStore.getState().setIsWaitingInLobby(false);
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

          case 'update-permissions' as any: {
            if (msg.permissions) {
              useHostControlStore.getState().updatePermissions(msg.permissions);
              if (msg.permissions.canShareScreen === false && useAppStore.getState().localParticipant?.screenSharing) {
                usePresenceStore.getState().pushToast({
                  type: 'info',
                  title: 'Screen Share Stopped',
                  message: 'Your screen share was stopped due to restricted screen sharing',
                  durationMs: 5000,
                });
                await this.terminateLocalScreenShare();
              }
            }
            break;
          }

          case 'stop-participant-share' as any: {
            if (isTargetLocal(msg.targetParticipantId)) {
              await this.terminateLocalScreenShare();
              usePresenceStore.getState().pushToast({
                type: 'info',
                title: 'Screen Share Stopped',
                message: 'Your screen share was stopped by a meeting host',
                durationMs: 5000,
              });
            }
            break;
          }



          case 'assign-cohost' as any: {
            if (msg.targetParticipantId) {
              this.addCoHostId(msg.targetParticipantId);
              const targetName = presence.participants.get(msg.targetParticipantId)?.name || 'Participant';
              usePresenceStore.getState().pushToast({
                type: 'info',
                title: 'Co-Host Assigned',
                message: isTargetLocal(msg.targetParticipantId)
                  ? 'You are now a co-host'
                  : `${targetName} is now a co-host`,
                durationMs: 4000,
              });
            }
            break;
          }

          case 'revoke-cohost' as any: {
            if (msg.targetParticipantId) {
              this.removeCoHostId(msg.targetParticipantId);
              const targetName = presence.participants.get(msg.targetParticipantId)?.name || 'Participant';
              usePresenceStore.getState().pushToast({
                type: 'info',
                title: 'Co-Host Revoked',
                message: isTargetLocal(msg.targetParticipantId)
                  ? 'Your co-host role was removed'
                  : `${targetName} is no longer a co-host`,
                durationMs: 4000,
              });
            }
            break;
          }

          case 'role-changed' as any: {
            if (msg.targetParticipantId && (msg as any).role) {
              const role = (msg as any).role;
              if (role === 'co-host') {
                this.addCoHostId(msg.targetParticipantId);
              } else {
                this.removeCoHostId(msg.targetParticipantId);
              }
            }
            break;
          }

          case 'host-changed': {
            // Post-verification host-changed handling (only reaches here after valid hostToken)
            const newHostId = msg.newHostId || msg.targetParticipantId;
            if (newHostId) {
              usePresenceStore.getState().setAuthoritativeHost(newHostId);
              if (newHostId === localId && msg.newHostToken) {
                this.setLocalHostToken(msg.newHostToken);
              } else if (newHostId !== localId && this.localHostToken) {
                this.localHostToken = null;
              }

              const newHostName =
                presence.participants.get(newHostId)?.name ||
                (newHostId === localId ? 'You' : 'Participant');

              usePresenceStore.getState().pushToast({
                type: 'host',
                title: 'Host Transfer',
                message:
                  newHostId === localId
                    ? 'You are now the meeting host'
                    : `${newHostName} is now the meeting host`,
                durationMs: 4000,
              });
            }
            break;
          }

          case 'host-announce': {
            // Post-verification host-announce handling (only reaches here after valid hostToken)
            const announcedHostId = msg.newHostId || verificationSenderId;
            if (announcedHostId) {
              // Only set authoritative host if not already established
              if (!establishedHostId) {
                usePresenceStore.getState().setAuthoritativeHost(announcedHostId);
              }
              // If currently waiting in lobby, re-knock so host receives our presence in queue
              if (useHostControlStore.getState().isWaitingInLobby && announcedHostId !== localId) {
                const localName = useAppStore.getState().localParticipant?.name || 'Guest';
                this.knockWaitingRoom(localName).catch(() => {});
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

    const presence = usePresenceStore.getState();
    const appState = useAppStore.getState();
    const localId =
      presence.localParticipantId ||
      this.room.localParticipant.identity ||
      appState.participantId ||
      appState.localParticipant?.id ||
      '';

    const msg: HostDirectiveMessage = {
      type: 'host-directive',
      senderId: localId,
      hostToken: this.localHostToken || undefined,
      hostKey: this.hostPublicKey || undefined,
      nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
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

  async stopParticipantShare(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'stop-participant-share' as any,
      targetParticipantId,
    });
  }

  async assignCoHost(targetParticipantId: string): Promise<void> {
    const presence = usePresenceStore.getState();
    const localId = this.room?.localParticipant?.identity || presence.localParticipantId;
    if (!presence.hostId || presence.hostId !== localId) {
      throw new Error('Only the meeting host can assign co-hosts');
    }

    // Server is authoritative, wait for role-changed event

    const roomId = this.activeRoomId || useAppStore.getState().roomId || '';
    const store = useAppStore.getState();
    const accessToken = store.jwt || store.livekitToken;
    const hostProof = store.hostToken || this.localHostToken;

    if (roomId && accessToken && typeof fetch !== 'undefined') {
      try {
        await fetch('/room/assign-cohost', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(hostProof ? { 'X-Host-Proof': `Bearer ${hostProof}` } : {}),
          },
          body: JSON.stringify({ roomId, targetParticipantId }),
        });
      } catch {}
    }
  }

  async revokeCoHost(targetParticipantId: string): Promise<void> {
    const presence = usePresenceStore.getState();
    const localId = this.room?.localParticipant?.identity || presence.localParticipantId;
    if (!presence.hostId || presence.hostId !== localId) {
      throw new Error('Only the meeting host can revoke co-hosts');
    }

    // Server is authoritative, wait for role-changed event

    const roomId = this.activeRoomId || useAppStore.getState().roomId || '';
    const store = useAppStore.getState();
    const accessToken = store.jwt || store.livekitToken;
    const hostProof = store.hostToken || this.localHostToken;

    if (roomId && accessToken && typeof fetch !== 'undefined') {
      try {
        await fetch('/room/revoke-cohost', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(hostProof ? { 'X-Host-Proof': `Bearer ${hostProof}` } : {}),
          },
          body: JSON.stringify({ roomId, targetParticipantId }),
        });
      } catch {}
    }
  }

  async transferHost(targetParticipantId: string): Promise<void> {
    const presence = usePresenceStore.getState();
    const localId = this.room?.localParticipant?.identity || presence.localParticipantId;
    if (!presence.hostId || presence.hostId !== localId) {
      throw new Error('Only the meeting host can transfer host authority');
    }

    const roomId = this.activeRoomId || useAppStore.getState().roomId || '';
    const store = useAppStore.getState();
    const accessToken = store.jwt || store.livekitToken;
    const capability = store.sessionToken;
    const hostProof = store.hostToken || this.localHostToken;

    if (!roomId || typeof fetch === 'undefined') {
      throw new Error('Host transfer requires an authoritative room session');
    }
    if (!accessToken || !capability || !hostProof) {
      // Fail closed: no credential broadcast fallback when the private contract
      // is unavailable.
      throw new Error('Host transfer requires a private session and host proof');
    }

    const res = await fetch('/room/transfer-host', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Session-Capability': capability,
        'X-Host-Proof': `Bearer ${hostProof}`,
      },
      body: JSON.stringify({
        roomId,
        targetParticipantId,
      }),
    });

    if (!res.ok) {
      // Fail closed: never broadcast authority or credentials on rejection.
      throw new Error(`Server rejected host transfer with status ${res.status}`);
    }

    // Public metadata only. The target's host credential is delivered privately
    // on its own authenticated control channel and is never returned here.
    const meta = await res.json();
    if (meta?.hostKey) {
      this.hostPublicKey = meta.hostKey;
      store.setSessionAuthority({ hostKey: meta.hostKey });
    }

    // Local tenure ends now; drop the host-operation proof and its resume handle.
    this.localHostToken = null;
    store.clearHostAuthority();
    usePresenceStore.getState().setAuthoritativeHost(targetParticipantId);

    // Announcement only — no credentials inside the event.
    await this.publishDirective({
      action: 'host-changed',
      targetParticipantId,
      newHostId: targetParticipantId,
      hostKey: meta?.hostKey,
    });
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
    if (!enabled) {
      const queue = [...useHostControlStore.getState().waitingQueue];
      for (const p of queue) {
        await this.publishDirective({
          action: 'waiting-room-admit',
          targetParticipantId: p.participantId,
        });
      }
    }
    useHostControlStore.getState().setWaitingRoomEnabled(enabled);
  }

  async admitParticipant(targetParticipantId: string): Promise<void> {
    await this.publishDirective({
      action: 'waiting-room-admit',
      targetParticipantId,
    });
    useHostControlStore.getState().admitParticipantId(targetParticipantId);

    // Redundant retry after 150ms for guaranteed DataChannel delivery
    setTimeout(() => {
      this.publishDirective({
        action: 'waiting-room-admit',
        targetParticipantId,
      }).catch(() => {});
    }, 150);

    const p = usePresenceStore.getState().participants.get(targetParticipantId);
    const name = p?.name || `User (${targetParticipantId.slice(0, 6)})`;
    usePresenceStore.getState().pushToast({
      type: 'join',
      title: `${name} admitted`,
      participantId: targetParticipantId,
      durationMs: 4000,
    });
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
    const appState = useAppStore.getState();
    const localId =
      presence.localParticipantId ||
      this.room?.localParticipant?.identity ||
      appState.participantId ||
      appState.localParticipant?.id ||
      '';
    const participantName = name || presence.participants.get(localId)?.name || 'Guest';

    await this.publishDirective({
      action: 'waiting-room-knock',
      targetParticipantId: localId,
      participantName,
    });
  }

  async queryHost(): Promise<void> {
    await this.publishDirective({
      action: 'host-query',
    });
  }

  async announceHost(newHostId?: string): Promise<void> {
    const presence = usePresenceStore.getState();
    const hostId = newHostId || presence.hostId || this.room?.localParticipant?.identity || '';
    if (hostId) {
      await this.publishDirective({
        action: 'host-announce',
        newHostId: hostId,
        hostKey: this.hostPublicKey || undefined,
      });
    }
  }
}
