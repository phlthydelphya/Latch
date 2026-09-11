/**
 * WebRTC / LiveKit connection hook with SFrame E2EE integration.
 * Implements insertion points I-1 through I-13 per M0-P0 / phase2b-sframe-design-v2.1.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { Room, RoomEvent, ParticipantEvent, ConnectionState, Track } from 'livekit-client';
import { fetchToken, resolveSfuUrl } from '../auth/token';
import { useAppStore } from '../store/appStore';
import { KeyManager } from '../keys/manager';
import { canonicalizeIdentity } from '../utils/identity';
import {
  SFrameTransform,
  installSFrameOnSenderShared,
  installSFrameOnReceiverShared,
  getGlobalCounterMutex,
  hasCreateEncodedStreams,
  hasScriptTransform,
  setGlobalSFrame,
  getGlobalSFrame,
} from '../sframe/transform';
import { getGlobalMetricsCollector } from '../metrics/collector';
import { PresenceAdapter } from '../presence/presenceAdapter';
import { usePresenceStore } from '../presence/presenceStore';
import { LayoutAdapter, SPOTLIGHT_TOPIC } from '../layout/layoutAdapter';
import { useLayoutStore } from '../layout/layoutStore';
import { CollaborationAdapter } from '../collaboration/collaborationAdapter';
import { useCollaborationStore } from '../collaboration/collaborationStore';
import { DeviceManager } from '../devices/deviceManager';
import { useDeviceStore } from '../devices/deviceStore';
import { HostControlManager } from '../host/hostControlManager';
import { useHostControlStore } from '../host/hostControlStore';
import { SubscriptionManager } from '../webrtc/subscriptionManager';
import { BandwidthEngine } from '../webrtc/bandwidthEngine';
import { M3B_PUBLISH_DEFAULTS } from '../webrtc/simulcastConfig';
import {
  CHAT_TOPIC,
  REACTION_TOPIC,
  ANNOUNCEMENT_TOPIC,
  HAND_ACTION_TOPIC,
  ReactionEmoji,
  ReactionEvent,
} from '../collaboration/types';

export function useWebRTC() {
  const { roomId, setError } = useAppStore();
  const roomRef = useRef<Room | null>(null);
  const presenceAdapterRef = useRef<PresenceAdapter | null>(null);
  const layoutAdapterRef = useRef<LayoutAdapter | null>(null);
  const collaborationAdapterRef = useRef<CollaborationAdapter | null>(null);
  const subscriptionManagerRef = useRef<SubscriptionManager | null>(null);
  const bandwidthEngineRef = useRef<BandwidthEngine | null>(null);
  const isConnectingRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);

  const keyManagerRef = useRef<KeyManager | null>(null);
  const sframeRef = useRef<SFrameTransform | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<RTCStatsReport | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const targetRoomId = roomId;
    if (activeRoomIdRef.current === targetRoomId && roomRef.current && roomRef.current.state !== ConnectionState.Disconnected) {
      return;
    }

    let isCancelled = false;
    let statsInterval: ReturnType<typeof setInterval> | null = null;
    let joinDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let welcomeRequestTimer: ReturnType<typeof setTimeout> | null = null;

    interface PendingWelcomeAck {
      resolve: () => void;
      reject: (err: Error) => void;
      epoch: number;
      timestamp: number;
    }
    const pendingWelcomeAcks = new Map<string, PendingWelcomeAck>();
    const activeWelcomeRetries = new Set<string>();

    async function initialize() {
      if (isConnectingRef.current) return;
      isConnectingRef.current = true;
      activeRoomIdRef.current = targetRoomId;

      try {
        const store = useAppStore.getState();
        let token = store.livekitToken;
        let resolvedSfuUrl = store.sfuUrl ? resolveSfuUrl(store.sfuUrl) : '';

        if (!token || !resolvedSfuUrl) {
          const name = `user-${store.participantId?.slice(0, 6) || 'anon'}`;
          const fetched = await fetchToken(targetRoomId, name);
          if (isCancelled) return;
          token = fetched.livekitToken;
          resolvedSfuUrl = resolveSfuUrl(fetched.sfuUrl);
          // Persist credentials for session reloads / evidence
          if (token && fetched.sfuUrl) {
            store.setCredentials(token, fetched.sfuUrl);
            console.log('[LiveKit] Credentials persisted', { sfuUrl: fetched.sfuUrl, tokenPresent: true });
          }
          // M4A: Pass server-signed host credentials to HostControlManager and presence
          HostControlManager.getInstance().setSessionContext({
            roomId: targetRoomId,
            localParticipantId: fetched.participantId,
            hostToken: fetched.hostToken,
            hostKey: fetched.hostKey,
          });
          if (fetched.role === 'host') {
            usePresenceStore.getState().setAuthoritativeHost(fetched.participantId);
          }
        }

        if (isCancelled) return;

        if (!token || !resolvedSfuUrl) {
          throw new Error('Missing livekitToken or sfuUrl after token fetch');
        }

        const sframeEnabled = import.meta.env.VITE_SFRAME_ENABLED !== 'false';

        // I-1: RoomOptions — adaptiveStream and dynacast disabled for blind SFU forwarding
        const room = new Room({
          adaptiveStream: !sframeEnabled,
          dynacast: !sframeEnabled,
          publishDefaults: M3B_PUBLISH_DEFAULTS,
        });
        roomRef.current = room;

        // Expose room for Playwright/test verification
        (window as any).__LIVEKIT_ROOM__ = room;

        // I-2: Pre-connect KeyManager & Global SFrameTransform setup
        const keyManager = new KeyManager({
          cipherSuite: 'AES_GCM',
          keyRotationIntervalMs: 300000,
        });
        keyManagerRef.current = keyManager;

        const canonicalSelf = canonicalizeIdentity(store.participantId || 'anon');
        await keyManager.initialize(canonicalSelf);

        const getCurrentKID = () => keyManager.getCurrentEpoch();
        const epochSalt = keyManager.getCurrentSalt()!;

        const sframe = new SFrameTransform({
          keyManager,
          cipherSuite: 'AES_GCM',
          getCurrentKID,
          epochSalt,
        });
        sframeRef.current = sframe;
        setGlobalSFrame(sframe);

        // Attach SFrame transform synchronously when sender is created, before negotiation / media flow
        room.localParticipant.on(ParticipantEvent.LocalSenderCreated, async (sender: any, track: any) => {
          if (sframeEnabled && (hasCreateEncodedStreams() || hasScriptTransform())) {
            try {
              await installSFrameOnSenderShared(sender, sframe, getGlobalCounterMutex());
              console.log('[SFrame] sender transform active on LocalSenderCreated', {
                kid: keyManager.getCurrentEpoch(),
                media: track?.kind,
              });
            } catch (err) {
              console.warn('[SFrame] Failed to install transform on LocalSenderCreated:', err);
            }
          }
        });

        // Deferred publish queue for HPKE public key
        const pendingPublishQueue: Array<{ topic: string; payload: Uint8Array; reliable: boolean }> = [];
        const pubkeyB64 = await keyManager.exportHPKEPublicKey();
        pendingPublishQueue.push({
          topic: 'hpke-pubkey',
          payload: new TextEncoder().encode(pubkeyB64),
          reliable: true,
        });

        // Helper: Leader election via deterministic sorted identities
        function getSortedIdentities(): string[] {
          const ids = [canonicalSelf];
          if (roomRef.current) {
            for (const p of roomRef.current.remoteParticipants.values()) {
              ids.push(canonicalizeIdentity(p.identity));
            }
          }
          return ids.sort();
        }

        function isLeader(): boolean {
          const sorted = getSortedIdentities();
          return sorted[0] === canonicalSelf;
        }

        // WP-4: Welcome ACK Tracking & Joiner Backoff State
        let welcomeRequestAttempt = 0;
        let hasReceivedWelcome = false;

        function scheduleWelcomeRequest(delayMs: number = 500) {
          if (hasReceivedWelcome || isLeader()) return;
          if (welcomeRequestTimer) clearTimeout(welcomeRequestTimer);

          welcomeRequestTimer = setTimeout(async () => {
            if (hasReceivedWelcome || isLeader()) return;
            welcomeRequestAttempt++;
            console.log(`[SFrame] welcome request sent attempt=${welcomeRequestAttempt} backoffMs=${delayMs}`);

            if (room.localParticipant) {
              try {
                await room.localParticipant.publishData(
                  new TextEncoder().encode(
                    JSON.stringify({
                      type: 'sframe-welcome-request',
                      attempt: welcomeRequestAttempt,
                    })
                  ),
                  { reliable: true, topic: 'sframe-welcome-request' }
                );
              } catch (err) {
                console.warn('[SFrame] Failed to publish sframe-welcome-request:', err);
              }
            }

            // Exponential backoff: 500ms -> 1000ms -> 2000ms -> 4000ms ... capped at 30s
            const nextDelay = Math.min(delayMs * 2, 30000);
            scheduleWelcomeRequest(nextDelay);
          }, delayMs);
        }

        // I-3: Flush pending publish queue on Connected
        async function flushPendingPublishQueue(targetRoom: Room) {
          while (pendingPublishQueue.length > 0) {
            const item = pendingPublishQueue.shift();
            if (!item) break;
            const delays = [100, 300, 900];
            for (let attempt = 0; attempt <= delays.length; attempt++) {
              try {
                if (targetRoom.localParticipant) {
                  await targetRoom.localParticipant.publishData(Uint8Array.from(item.payload), {
                    reliable: item.reliable,
                    topic: item.topic,
                  });
                  console.log(`[SFrame] Published ${item.topic} on Connected`);
                  break;
                }
              } catch (err) {
                if (attempt < delays.length) {
                  await new Promise((r) => setTimeout(r, delays[attempt]));
                }
              }
            }
          }
        }

        // Event handlers
        room.on(RoomEvent.Connected, async () => {
          console.log('[LiveKit] Room.connect success', {
            roomName: room.name,
            state: room.state,
            localIdentity: room.localParticipant?.identity,
            trackPublicationsSize: room.localParticipant?.trackPublications.size ?? 0,
          });
          console.log('[LiveKit] room.name', room.name, 'state', room.state, 'localParticipant', room.localParticipant?.identity);
          useAppStore.getState().setConnected(true);
          useAppStore.getState().setShieldMode(true);

          // M2 Phase E / M4A: Initialize Host Control Manager for moderation directives
          HostControlManager.getInstance().setSessionContext({
            roomId: targetRoomId,
          });
          HostControlManager.getInstance().attach(room);

          // M2 Phase A: Initialize Presence Adapter for presence domain events
          if (!presenceAdapterRef.current) {
            presenceAdapterRef.current = new PresenceAdapter(room);
          } else {
            presenceAdapterRef.current.attach(room);
          }

          // M2 Phase B: Initialize Layout Adapter for adaptive visual layouts
          if (!layoutAdapterRef.current) {
            layoutAdapterRef.current = new LayoutAdapter(room);
          } else {
            layoutAdapterRef.current.attach(room);
          }

          // M2 Phase C: Initialize Collaboration Adapter for in-call chat, reactions, announcements, hand queue
          if (!collaborationAdapterRef.current) {
            collaborationAdapterRef.current = new CollaborationAdapter(room);
          } else {
            collaborationAdapterRef.current.attach(room);
          }

          // M2 Phase D: Enumerate devices and start change listener
          DeviceManager.getInstance().enumerateAndSyncDevices();
          DeviceManager.getInstance().startDeviceChangeListener();

          // M3B: Initialize Subscription Manager for dynamic track subscription & Last-N=9 gating
          if (!subscriptionManagerRef.current) {
            subscriptionManagerRef.current = new SubscriptionManager(room);
          } else {
            subscriptionManagerRef.current.attach(room);
          }

          // M3B: Initialize Bandwidth Engine for downlink WebRTC congestion adaptation
          if (!bandwidthEngineRef.current) {
            bandwidthEngineRef.current = new BandwidthEngine();
          }
          bandwidthEngineRef.current.attach(room);

          (window as any).__SUBSCRIPTION_MANAGER__ = subscriptionManagerRef.current;
          (window as any).__BANDWIDTH_ENGINE__ = bandwidthEngineRef.current;

          // Flush HPKE key publish
          if (sframeEnabled) {
            await flushPendingPublishQueue(room);
            // WP-4: If not leader, start welcome-request backoff timer
            if (!isLeader()) {
              scheduleWelcomeRequest(500);
            }
          }

          // Set local participant in store
          if (room.localParticipant) {
            useAppStore.getState().setLocalParticipant({
              id: room.localParticipant.identity,
              name: `You (${room.localParticipant.identity.slice(0, 6)})`,
              audioEnabled: room.localParticipant.isMicrophoneEnabled,
              videoEnabled: room.localParticipant.isCameraEnabled,
              screenSharing: room.localParticipant.isScreenShareEnabled,
              isLocal: true,
              isSpeaking: false,
            });
          }

          // Populate existing remote participants in store
          if (room.remoteParticipants && room.remoteParticipants.size > 0) {
            for (const participant of room.remoteParticipants.values()) {
              useAppStore.getState().addParticipant({
                id: participant.identity,
                name: `Participant ${participant.identity.slice(0, 6)}`,
                audioEnabled: participant.isMicrophoneEnabled,
                videoEnabled: participant.isCameraEnabled,
                screenSharing: participant.isScreenShareEnabled,
                isLocal: false,
                isSpeaking: false,
              });
            }
          }
        });

        room.on(RoomEvent.Disconnected, (reason) => {
          useAppStore.getState().setConnected(false);
          useAppStore.getState().setShieldMode(false);
          setScreenStream(null);
          useLayoutStore.getState().setScreenShareOwner(null);
          if (reason) {
            useAppStore.getState().setError(`Disconnected: ${reason}`);
          }
        });

        room.on(RoomEvent.Reconnecting, () => useAppStore.getState().setReconnecting(true));
        room.on(RoomEvent.Reconnected, () => useAppStore.getState().setReconnecting(false));

        // ICE diagnostics: capture transport state changes and candidate info
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
          console.log('[ICE DIAG] Connection state:', state);
          if ((state as any) === 'failed' || (state as any) === 'disconnected') {
            const engine = (room as any).engine;
            const pcManager = engine?.pcManager;
            const publisher = pcManager?.publisher;
            const subscriber = pcManager?.subscriber;
            if (publisher?.pc) {
              const pc = publisher.pc as RTCPeerConnection;
              console.log('[ICE DIAG] Publisher PC state', {
                iceConnectionState: pc.iceConnectionState,
                iceGatheringState: pc.iceGatheringState,
                connectionState: pc.connectionState,
                signalingState: pc.signalingState,
              });
              pc.getStats().then((stats) => {
                const candidates: Array<{type: string, protocol: string, address: string}> = [];
                const pairs: Array<{state: string, nominated: boolean, localCandidateId: string, remoteCandidateId: string}> = [];
                stats.forEach((report) => {
                  if (report.type === 'local-candidate') {
                    candidates.push({ type: report.candidateType, protocol: report.protocol, address: report.address });
                  }
                  if (report.type === 'candidate-pair') {
                    pairs.push({ state: report.state, nominated: report.nominated, localCandidateId: report.localCandidateId, remoteCandidateId: report.remoteCandidateId });
                  }
                });
                console.log('[ICE DIAG] Local candidates:', candidates);
                console.log('[ICE DIAG] Candidate pairs:', pairs);
              });
            }
            if (subscriber?.pc) {
              const pc = subscriber.pc as RTCPeerConnection;
              console.log('[ICE DIAG] Subscriber PC state', {
                iceConnectionState: pc.iceConnectionState,
                iceGatheringState: pc.iceGatheringState,
                connectionState: pc.connectionState,
                signalingState: pc.signalingState,
              });
            }
          }
        });

        // I-10: ParticipantConnected & Join Rekey
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          useAppStore.getState().addParticipant({
            id: participant.identity,
            name: `Participant ${participant.identity.slice(0, 6)}`,
            audioEnabled: participant.isMicrophoneEnabled,
            videoEnabled: participant.isCameraEnabled,
            screenSharing: participant.isScreenShareEnabled,
            isLocal: false,
            isSpeaking: false,
          });

          // Check if self is leader and trigger join rotation after debounce
          const canonJoiner = canonicalizeIdentity(participant.identity);
          scheduleJoinRotation(canonJoiner);
        });

        // I-11: ParticipantDisconnected & Leave Rekey
        room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
          const canonLeaver = canonicalizeIdentity(participant.identity);
          useAppStore.getState().removeParticipant(participant.identity);

          if (sframeEnabled && keyManagerRef.current) {
            keyManagerRef.current.removeParticipantHPKEPublicKey(canonLeaver);
            await keyManagerRef.current.removeParticipant(canonLeaver);
            sframeRef.current?.deleteParticipantCounters(canonLeaver);

            const remaining = getSortedIdentities().filter((id) => id !== canonLeaver);
            if (remaining.length > 1 && remaining[0] === canonicalSelf) {
              try {
                if (keyManagerRef.current.rotationMutex.isLocked()) {
                  getGlobalMetricsCollector().recordRotationContention('leave');
                }
                await keyManagerRef.current.rotationMutex.run(async () => {
                  const { commits, newEpoch } = await keyManagerRef.current!.rotateEpoch('leave', canonLeaver);
                  await sframeRef.current?.rotateKey();
                  console.log('[SFrame] Leader rotated epoch for leave to', newEpoch);

                  for (const [peerId, commitBytes] of commits) {
                    if (room.localParticipant) {
                      await room.localParticipant.publishData(
                        new TextEncoder().encode(JSON.stringify({
                          type: 'sframe-commit',
                          epoch: newEpoch,
                          commit: Array.from(commitBytes),
                        })),
                        { reliable: true, topic: 'sframe-commit', destinationIdentities: [peerId] }
                      );
                    }
                  }
                });
              } catch (err) {
                console.error('[SFrame] Leave rotation failed:', err);
              }
            }
          }
        });

        // I-6: TrackSubscribed
        room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
          if (sframeEnabled && (hasCreateEncodedStreams() || hasScriptTransform()) && participant) {
            const receiver = (track as any).receiver;
            if (receiver) {
              const canonicalParticipant = canonicalizeIdentity(participant.identity);
              await installSFrameOnReceiverShared(receiver, sframe, canonicalParticipant);
              console.log('[SFrame] receiver transform active', {
                sender: canonicalParticipant.slice(0, 8),
                kid: keyManager.getCurrentEpoch(),
                lastCounter: sframe.getDecryptCounter(keyManager.getCurrentEpoch(), canonicalParticipant)?.toString() ?? '-1',
              });
            }
          }

          const stream = new MediaStream();
          const mst = (track as any).mediaStreamTrack as MediaStreamTrack | undefined;
          if (mst) {
            stream.addTrack(mst);
          }
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(publication.trackSid, stream);
            return next;
          });
        });

        room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(publication.trackSid);
            return next;
          });
        });

        // I-5: LocalTrackPublished
        room.on(RoomEvent.LocalTrackPublished, async (publication, participant) => {
          console.log('[LiveKit] LocalTrackPublished', {
            trackSid: (publication as any)?.trackSid,
            kind: (publication as any)?.kind,
            source: (publication as any)?.source,
            participantIdentity: (participant as any)?.identity,
            trackPublicationsSize: (participant as any)?.trackPublications?.size ?? room.localParticipant?.trackPublications.size ?? 0,
          });
          console.log('[LiveKit] trackPublications.size', room.localParticipant?.trackPublications.size ?? 0);

          const pubSource = (publication as any)?.source;
          const isScreenShare = pubSource === Track.Source.ScreenShare;

          if (sframeEnabled && (hasCreateEncodedStreams() || hasScriptTransform())) {
            const sender = (publication.track as any)?.sender;
            if (sender && !(sender as any)._sframeTransformer) {
              await installSFrameOnSenderShared(sender, sframe, getGlobalCounterMutex());
              console.log('[SFrame] sender transform active', {
                kid: keyManager.getCurrentEpoch(),
                media: publication.kind,
                trackId: publication.trackSid,
                globalCounter: sframe.getEncryptCounter(keyManager.getCurrentEpoch())?.toString(),
              });
            }
          }

          // Local track published - handle camera/mic and screen share separately
          if (participant === room.localParticipant) {
            if (isScreenShare) {
              // Screen share: create dedicated screenStream, keep localStream camera-only
              const mst = (publication.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined;
              if (mst) {
                const stream = new MediaStream([mst]);
                setScreenStream(stream);
                console.log('[Screen] screenStream hydrated from LocalTrackPublished', { trackSid: publication.trackSid });

                // Browser chrome stop: listen for track ended to atomically clear stream + owner
                mst.addEventListener('ended', () => {
                  console.log('[Screen] track ended (browser chrome stop) — atomic cleanup');
                  setScreenStream(null);
                  useLayoutStore.getState().setScreenShareOwner(null);
                }, { once: true });
              }
            } else {
              // Camera/mic: rebuild localStream from non-screen publications
              const stream = new MediaStream();
              room.localParticipant?.trackPublications.forEach((pub) => {
                const pubSrc = (pub as any)?.source;
                if (pubSrc === Track.Source.ScreenShare) return; // exclude screen from localStream
                const mst = (pub.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined;
                if (mst) {
                  stream.addTrack(mst);
                }
              });
              if (stream.getTracks().length > 0) {
                setLocalStream(stream);
              }
            }
          }
        });

        // Screen share lifecycle: sync store when browser stops sharing or track is unpublished
        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          if ((publication as any)?.source === Track.Source.ScreenShare) {
            useAppStore.getState().setLocalScreenShare(false);
            setScreenStream(null);
            useLayoutStore.getState().setScreenShareOwner(null);
          }
        });

        // I-7: DataReceived topic dispatcher
        room.on(RoomEvent.DataReceived, async (payload: Uint8Array, participant?: any, _kind?: any, topic?: string) => {
          console.log('[LiveKit] Data received from', participant?.identity, 'topic:', topic);
          let resolvedTopic = topic;
          let parsedData: any = null;
          if (payload.byteLength > 0) {
            try {
              parsedData = JSON.parse(new TextDecoder().decode(payload));
              if (!resolvedTopic && parsedData.type) resolvedTopic = parsedData.type;
            } catch {}
          }

          const canonTopic = resolvedTopic?.trim().toLowerCase();
          switch (canonTopic) {
            case 'hpke-pubkey':
              await handleHPKEPubkey(payload, participant, parsedData);
              break;
            case 'sframe-commit':
              await handleCommit(payload, participant, parsedData);
              break;
            case 'sframe-welcome':
              await handleWelcome(payload, participant, parsedData);
              break;
            case 'sframe-welcome-ack':
              handleWelcomeAck(participant, parsedData);
              break;
            case 'sframe-welcome-request':
              await handleWelcomeRequest(participant);
              break;
            case 'sframe-rotated-ack':
              console.log('[SFrame] Rotation ACK received from', participant?.identity);
              break;
            default:
              console.debug('[LiveKit] unknown DataReceived topic', topic);
          }
        });

        // Signal handlers for SFrame
        async function handleHPKEPubkey(payload: Uint8Array, participant?: any, parsedJson?: any) {
          try {
            const b64 = parsedJson?.hpkePublicKey || (typeof parsedJson === 'string' ? parsedJson : new TextDecoder().decode(payload));
            const identity = participant?.identity;
            if (!identity || !b64) return;
            const canonId = canonicalizeIdentity(identity);
            const key = await keyManager.importHPKEPublicKey(b64);
            keyManager.setParticipantHPKEPublicKey(canonId, key);
            await keyManager.addParticipant(canonId);
            console.log('[SFrame] Registered HPKE public key for', canonId);

            scheduleJoinRotation(canonId);
          } catch (err) {
            console.error('[SFrame] Failed to import HPKE public key:', err);
          }
        }

        async function handleCommit(payload: Uint8Array, _participant?: any, parsedJson?: any) {
          try {
            let commitBytes: Uint8Array | null = null;
            if (parsedJson) {
              if (parsedJson.commit) {
                commitBytes = new Uint8Array(parsedJson.commit);
              } else if (parsedJson.commits && parsedJson.commits[canonicalSelf]) {
                commitBytes = new Uint8Array(parsedJson.commits[canonicalSelf]);
              }
            } else {
              commitBytes = payload;
            }

            if (!commitBytes) return;
            const newKey = await keyManager.processCommit(commitBytes);
            await sframe.rotateKey(newKey);
            console.log('[SFrame] Adopted new epoch via commit:', keyManager.getCurrentEpoch());

            if (room.localParticipant) {
              await room.localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify({ type: 'sframe-rotated-ack', epoch: keyManager.getCurrentEpoch() })),
                { reliable: true, topic: 'sframe-rotated-ack' }
              );
            }
          } catch (err) {
            console.error('[SFrame] Failed to process commit:', err);
          }
        }

        async function publishWelcomeWithRetry(
          targetParticipantId: string,
          welcomeBytes: Uint8Array,
          epoch: number
        ): Promise<void> {
          const canonJoinerId = canonicalizeIdentity(targetParticipantId);
          if (activeWelcomeRetries.has(canonJoinerId)) {
            console.log(`[SFrame] publishWelcomeWithRetry already active for ${canonJoinerId}`);
            return;
          }
          activeWelcomeRetries.add(canonJoinerId);

          try {
            const delays = [100, 300, 900];
            const maxAttempts = 3;
            const ackTimeoutMs = 1500;
            const metrics = getGlobalMetricsCollector();

            const payload = new TextEncoder().encode(
              JSON.stringify({
                type: 'sframe-welcome',
                epoch,
                welcome: Array.from(welcomeBytes),
              })
            );

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                if (!room.localParticipant) break;

                const ackPromise = new Promise<void>((resolve, reject) => {
                  pendingWelcomeAcks.set(canonJoinerId, {
                    resolve,
                    reject,
                    epoch,
                    timestamp: performance.now(),
                  });
                });

                await room.localParticipant.publishData(Uint8Array.from(payload), {
                  reliable: true,
                  topic: 'sframe-welcome',
                  destinationIdentities: [canonJoinerId],
                });

                console.log(`[SFrame] welcome sent attempt=${attempt} joiner=${canonJoinerId.slice(0, 8)} epoch=${epoch}`);

                let timeoutHandle: any;
                const timeoutPromise = new Promise<never>((_, reject) => {
                  timeoutHandle = setTimeout(() => {
                    reject(new Error('Welcome ACK timeout'));
                  }, ackTimeoutMs);
                });

                try {
                  await Promise.race([ackPromise, timeoutPromise]);
                  clearTimeout(timeoutHandle);
                  pendingWelcomeAcks.delete(canonJoinerId);
                  console.log(`[SFrame] welcome delivered and acknowledged by ${canonJoinerId.slice(0, 8)} on attempt ${attempt}`);
                  return;
                } catch (ackErr) {
                  clearTimeout(timeoutHandle);
                  pendingWelcomeAcks.delete(canonJoinerId);
                  metrics.recordWelcomeRetry(attempt, false);
                  console.warn(`[SFrame] welcome retry attempt=${attempt} joiner=${canonJoinerId.slice(0, 8)} epoch=${epoch}`);

                  if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, delays[attempt - 1]));
                  }
                }
              } catch (sendErr) {
                pendingWelcomeAcks.delete(canonJoinerId);
                metrics.recordWelcomeRetry(attempt, false);
                console.warn(`[SFrame] publishData failed for welcome attempt=${attempt}:`, sendErr);
                if (attempt < maxAttempts) {
                  await new Promise((r) => setTimeout(r, delays[attempt - 1]));
                }
              }
            }

            // Retries exhausted -> fallback POST /sync
            metrics.recordWelcomeRetry(maxAttempts + 1, true);
            console.warn(`[SFrame] welcome retries exhausted for ${canonJoinerId.slice(0, 8)}, attempting fallback POST /sync`);
            try {
              const b64Welcome = btoa(String.fromCharCode(...welcomeBytes));
              await fetch('/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'welcome',
                  roomId: targetRoomId,
                  joinerId: canonJoinerId,
                  welcome: b64Welcome,
                  epoch,
                }),
              });
              console.log(`[SFrame] Fallback /sync posted for ${canonJoinerId.slice(0, 8)}`);
            } catch (fallbackErr) {
              console.error('[SFrame] Fallback /sync failed:', fallbackErr);
            }
          } finally {
            activeWelcomeRetries.delete(canonJoinerId);
          }
        }

        function handleWelcomeAck(participant?: any, parsedJson?: any) {
          const identity = participant?.identity;
          if (!identity) return;
          const canonId = canonicalizeIdentity(identity);
          const pending = pendingWelcomeAcks.get(canonId);
          if (pending) {
            const epoch = parsedJson?.epoch ?? pending.epoch;
            if (epoch === pending.epoch) {
              const rtt = Math.round(performance.now() - pending.timestamp);
              console.log(`[SFrame] welcome ack received from=${canonId.slice(0, 8)} epoch=${epoch} rttMs=${rtt}`);
              pending.resolve();
              pendingWelcomeAcks.delete(canonId);
            }
          } else {
            console.log(`[SFrame] Welcome ACK received from ${canonId} (no pending waiter)`);
          }
        }

        async function handleWelcome(payload: Uint8Array, _participant?: any, parsedJson?: any) {
          try {
            let welcomeBytes: Uint8Array | null = null;
            let epochNum: number | undefined = undefined;
            if (parsedJson) {
              epochNum = parsedJson.epoch;
              if (parsedJson.welcome) {
                welcomeBytes = new Uint8Array(parsedJson.welcome);
              }
            } else {
              welcomeBytes = payload;
            }

            if (!welcomeBytes) return;
            const newKey = await keyManager.processWelcome(welcomeBytes, targetRoomId, epochNum);
            await sframe.rotateKey(newKey);
            console.log('[SFrame] Adopted epoch via Welcome:', keyManager.getCurrentEpoch());

            hasReceivedWelcome = true;
            if (welcomeRequestTimer) {
              clearTimeout(welcomeRequestTimer);
              welcomeRequestTimer = null;
            }

            if (room.localParticipant) {
              const sorted = getSortedIdentities();
              const leaderId = sorted[0];
              await room.localParticipant.publishData(
                new TextEncoder().encode(JSON.stringify({ type: 'sframe-welcome-ack', epoch: keyManager.getCurrentEpoch() })),
                {
                  reliable: true,
                  topic: 'sframe-welcome-ack',
                  destinationIdentities: leaderId ? [leaderId] : undefined,
                }
              );
            }
          } catch (err) {
            console.error('[SFrame] Failed to process Welcome:', err);
          }
        }

        async function handleWelcomeRequest(participant?: any) {
          try {
            if (!participant?.identity) return;
            const canonId = canonicalizeIdentity(participant.identity);
            const peerPub = keyManager.getParticipantHPKEPublicKey(canonId);
            if (!peerPub || !isLeader()) return;

            const currentSecret = keyManager.getCurrentEpochSecret();
            if (!currentSecret || !room.localParticipant) return;

            const currentEpoch = keyManager.getCurrentEpoch();
            const welcome = await keyManager.createWelcome(
              currentSecret,
              peerPub,
              targetRoomId,
              currentEpoch
            );

            await publishWelcomeWithRetry(canonId, welcome, currentEpoch);
          } catch (err) {
            console.error('[SFrame] Failed to handle welcome request:', err);
          }
        }

        function scheduleJoinRotation(canonJoinerId: string) {
          if (!isLeader()) return;
          if (joinDebounceTimer) clearTimeout(joinDebounceTimer);
          joinDebounceTimer = setTimeout(async () => {
            try {
              if (keyManager.rotationMutex.isLocked()) {
                getGlobalMetricsCollector().recordRotationContention('join');
              }
              await keyManager.rotationMutex.run(async () => {
                if (!isLeader()) return;
                const peerPub = keyManager.getParticipantHPKEPublicKey(canonJoinerId);
                if (!peerPub) return;

                const { commits, newEpoch } = await keyManager.rotateEpoch('join');
                await sframe.rotateKey();
                console.log('[SFrame] Leader rotated epoch for join to', newEpoch);

                const currentSecret = keyManager.getCurrentEpochSecret();
                if (currentSecret && room.localParticipant) {
                  const welcome = await keyManager.createWelcome(
                    currentSecret,
                    peerPub,
                    targetRoomId,
                    newEpoch
                  );
                  await publishWelcomeWithRetry(canonJoinerId, welcome, newEpoch);
                }

                for (const [peerId, commitBytes] of commits) {
                  if (peerId === canonJoinerId) continue;
                  if (room.localParticipant) {
                    await room.localParticipant.publishData(
                      new TextEncoder().encode(JSON.stringify({
                        type: 'sframe-commit',
                        epoch: newEpoch,
                        commit: Array.from(commitBytes),
                      })),
                      { reliable: true, topic: 'sframe-commit', destinationIdentities: [peerId] }
                    );
                  }
                }
              });
            } catch (err) {
              console.error('[SFrame] Join rotation failed:', err);
            }
          }, 500);
        }

        // I-4: Before connect invariant assertion
        if (sframeEnabled) {
          const currentSecret = keyManager.getCurrentEpochSecret();
          const currentSalt = keyManager.getCurrentSalt();
          if (!currentSecret || !currentSalt || currentSalt.byteLength !== 12) {
            throw new Error('SFrame pre-connect assertion failed: invalid secret or salt');
          }
          if (sframe.getEncryptCounter(keyManager.getCurrentEpoch()) !== 0n) {
            throw new Error('SFrame pre-connect assertion failed: initial counter must be 0n');
          }
        }

        // Connect to LiveKit room — safe instrumented diagnostic
        console.log(`[LIVEKIT CONNECT] targetRoomMatchesToken=${Boolean(token && targetRoomId)}`);

        const supportsEncodedStreams = typeof RTCRtpSender !== 'undefined' &&
          'createEncodedStreams' in RTCRtpSender.prototype;

        try {
          const rtcConfig: Record<string, unknown> = {};
          if (supportsEncodedStreams) {
            rtcConfig.encodedInsertableStreams = true;
          }

          // Fetch TURN credentials
          let iceServers: RTCIceServer[] = [];
          try {
            const turnRes = await fetch('/turn/credentials', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomId: targetRoomId })
            });
            if (turnRes.ok) {
              const creds = await turnRes.json();
              iceServers = [{
                urls: creds.urls,
                username: creds.username,
                credential: creds.credential
              }];
              rtcConfig.iceServers = iceServers;
            } else {
              console.warn('[TURN] Failed to fetch credentials, fallback to defaults');
            }
          } catch (e) {
            console.warn('[TURN] Error fetching credentials', e);
          }

          console.log('[ICE DIAG] Configuration', {
            browser: navigator.userAgent,
            supportsEncodedStreams,
          });

          await room.connect(resolvedSfuUrl, token, {
            autoSubscribe: true,
            rtcConfig: rtcConfig as any,
          });
          if (isCancelled) {
            room.disconnect();
            return;
          }
          console.log('[LiveKit] Room.connect success', {
            roomName: room.name,
            state: room.state,
            trackPublicationsSize: room.localParticipant?.trackPublications.size ?? 0,
          });
        } catch (err) {
          if (isCancelled) return;
          const e = err as Error;
          console.error('[LiveKit] Room.connect failure', { name: e.name, message: e.message, stack: e.stack });
          throw err;
        }

        if (isCancelled) return;

        // Auto-publish camera and microphone after successful connection (only if not held in lobby)
        const isWaitingInLobby = useHostControlStore.getState().isWaitingInLobby;
        if (!isWaitingInLobby) {
          const shouldPublishVideo = useAppStore.getState().localParticipant?.videoEnabled ?? true;
          if (shouldPublishVideo) {
            console.log('[LiveKit] setCameraEnabled start');
            const videoDeviceId = useDeviceStore.getState().selectedVideoInputId;
            const videoOptions = videoDeviceId ? { deviceId: { exact: videoDeviceId } } : undefined;
            try {
              await room.localParticipant.setCameraEnabled(true, videoOptions);
              console.log('[LiveKit] setCameraEnabled success', {
                trackPublicationsSize: room.localParticipant.trackPublications.size,
                isCameraEnabled: room.localParticipant.isCameraEnabled,
                deviceId: videoDeviceId || 'default',
              });
              console.log('[LiveKit] trackPublications.size', room.localParticipant.trackPublications.size);
            } catch (err) {
              const e = err as Error;
              console.error('[LiveKit] setCameraEnabled failure', { name: e.name, message: e.message });
              if (e.name === 'NotReadableError' && videoDeviceId) {
                console.warn('[LiveKit] NotReadableError — retrying after hardware release delay');
                await new Promise((r) => setTimeout(r, 300));
                try {
                  await room.localParticipant.setCameraEnabled(true, videoOptions);
                  console.log('[LiveKit] setCameraEnabled retry succeeded');
                } catch (retryErr) {
                  const re = retryErr as Error;
                  console.warn('[LiveKit] Retry failed, falling back to default device', { name: re.name, message: re.message });
                  try {
                    await room.localParticipant.setCameraEnabled(true);
                    console.log('[LiveKit] setCameraEnabled fallback to default succeeded');
                  } catch (fallbackErr) {
                    const fe = fallbackErr as Error;
                    console.error('[LiveKit] Fallback also failed', { name: fe.name, message: fe.message });
                    useAppStore.getState().setError('Camera busy — close other apps using camera, or open Settings to switch device.');
                  }
                }
              } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                useAppStore.getState().setError('Camera access denied — grant permission and reload.');
              } else if (e.name === 'NotFoundError') {
                useAppStore.getState().setError('No camera device found.');
              } else if (e.name === 'NotReadableError') {
                useAppStore.getState().setError('Camera busy — close other apps using camera, or open Settings to switch device.');
              } else {
                useAppStore.getState().setError(`Camera publish failed: ${e.message}`);
              }
              console.warn('[LiveKit] Camera publish failed (permission/device):', e.message);
            }
          }

          if (isCancelled) return;

          const shouldPublishAudio = useAppStore.getState().localParticipant?.audioEnabled ?? true;
          if (shouldPublishAudio) {
            console.log('[LiveKit] setMicrophoneEnabled start');
            const audioDeviceId = useDeviceStore.getState().selectedAudioInputId;
            const audioOptions = audioDeviceId ? { deviceId: { exact: audioDeviceId } } : undefined;
            try {
              await room.localParticipant.setMicrophoneEnabled(true, audioOptions);
              console.log('[LiveKit] setMicrophoneEnabled success', {
                trackPublicationsSize: room.localParticipant.trackPublications.size,
                isMicrophoneEnabled: room.localParticipant.isMicrophoneEnabled,
                deviceId: audioDeviceId || 'default',
              });
              console.log('[LiveKit] trackPublications.size', room.localParticipant.trackPublications.size);
            } catch (err) {
              const e = err as Error;
              console.error('[LiveKit] setMicrophoneEnabled failure', { name: e.name, message: e.message });
              if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                useAppStore.getState().setError('Microphone access denied — grant permission and reload.');
              } else if (e.name === 'NotFoundError') {
                useAppStore.getState().setError('No microphone device found.');
              } else if (e.name === 'NotReadableError') {
                useAppStore.getState().setError('Microphone busy — close other apps using microphone, or open Settings to switch device.');
              } else {
                useAppStore.getState().setError(`Microphone publish failed: ${e.message}`);
              }
              console.warn('[LiveKit] Microphone publish failed (permission/device):', e.message);
            }
          }
        }

        if (isCancelled) return;

        // Stats polling
        statsInterval = setInterval(async () => {
          if (roomRef.current) {
            try {
              const pc = (roomRef.current as any).engine?.publisher?.pc as RTCPeerConnection | undefined;
              if (pc) {
                const s = await pc.getStats();
                setStats(s);
              }
            } catch {}
          }
        }, 2000);
      } catch (err) {
        if (isCancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[LiveKit] Connection failed:', {
          message: error.message,
          stack: error.stack,
          roomId: targetRoomId,
          sfuUrl: useAppStore.getState().sfuUrl ? resolveSfuUrl(useAppStore.getState().sfuUrl!) : 'N/A',
          livekitTokenPrefix: useAppStore.getState().livekitToken?.slice(0, 20) + '...' || 'N/A',
          file: 'useWebRTC.ts',
          line: 'initialize callback',
        });
        useAppStore.getState().setError(`LiveKit connection failed: ${error.message}`);
      } finally {
        isConnectingRef.current = false;
      }
    }

    initialize();

    // I-13: Teardown & cleanup
    return () => {
      isCancelled = true;
      isConnectingRef.current = false;
      activeRoomIdRef.current = null;
      if (joinDebounceTimer) clearTimeout(joinDebounceTimer);
      if (welcomeRequestTimer) clearTimeout(welcomeRequestTimer);
      for (const pending of pendingWelcomeAcks.values()) {
        pending.reject(new Error('Teardown: unmounting or room change'));
      }
      pendingWelcomeAcks.clear();
      activeWelcomeRetries.clear();
      if (statsInterval) clearInterval(statsInterval);
      if (keyManagerRef.current) {
        keyManagerRef.current.destroy();
        keyManagerRef.current = null;
      }
      if (sframeRef.current) {
        sframeRef.current.clearCounters();
        sframeRef.current = null;
      }
      setGlobalSFrame(null);
      if (presenceAdapterRef.current) {
        presenceAdapterRef.current.detach();
        presenceAdapterRef.current = null;
      }
      usePresenceStore.getState().resetPresence();

      if (layoutAdapterRef.current) {
        layoutAdapterRef.current.detach();
        layoutAdapterRef.current = null;
      }
      useLayoutStore.getState().reset();

      if (collaborationAdapterRef.current) {
        collaborationAdapterRef.current.detach();
        collaborationAdapterRef.current = null;
      }
      useCollaborationStore.getState().reset();

      DeviceManager.getInstance().destroy();
      useDeviceStore.getState().reset();

      HostControlManager.getInstance().detach();
      useHostControlStore.getState().reset();

      if (subscriptionManagerRef.current) {
        subscriptionManagerRef.current.detach();
        subscriptionManagerRef.current = null;
      }

      if (bandwidthEngineRef.current) {
        bandwidthEngineRef.current.detach();
        bandwidthEngineRef.current = null;
      }

      delete (window as any).__SUBSCRIPTION_MANAGER__;
      delete (window as any).__BANDWIDTH_ENGINE__;

      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      (window as any).__LIVEKIT_ROOM__ = null;
    };
  }, [roomId]);

  // I-8: Audio & Video toggling preserves SFrame transform & counter
  const toggleAudio = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      const enabled = !roomRef.current.localParticipant.isMicrophoneEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
    }
  }, []);

  const toggleVideo = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      const enabled = !roomRef.current.localParticipant.isCameraEnabled;
      await roomRef.current.localParticipant.setCameraEnabled(enabled);
    }
  }, []);

  // I-9: Screen Share with shared SFrame transform
  const startScreenShare = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      try {
        await roomRef.current.localParticipant.setScreenShareEnabled(true);
        useAppStore.getState().setLocalScreenShare(true);

        // SFrame transform will be installed via LocalTrackPublished event handler
        // screenStream hydration also happens there to ensure publication is ready

        if (sframeRef.current && keyManagerRef.current) {
          // Fallback: attempt install if publication already exists (race condition guard)
          const screenPub = roomRef.current.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          const sender = (screenPub?.track as any)?.sender;
          if (sender && !(sender as any)._sframeTransformer) {
            await installSFrameOnSenderShared(sender, sframeRef.current, getGlobalCounterMutex());
            console.log('[SFrame] Screen share transform installed (fallback)', {
              kid: keyManagerRef.current.getCurrentEpoch(),
              trackId: screenPub!.trackSid,
              globalCounter: sframeRef.current.getEncryptCounter(keyManagerRef.current.getCurrentEpoch())?.toString(),
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Screen share failed');
      }
    }
  }, [setError]);

  const stopScreenShare = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      await roomRef.current.localParticipant.setScreenShareEnabled(false);
      useAppStore.getState().setLocalScreenShare(false);
      setScreenStream(null);
      useLayoutStore.getState().setScreenShareOwner(null);
    }
  }, []);

  const leave = useCallback(async () => {
    isConnectingRef.current = false;
    activeRoomIdRef.current = null;
    if (keyManagerRef.current) {
      keyManagerRef.current.destroy();
      keyManagerRef.current = null;
    }
    if (sframeRef.current) {
      sframeRef.current.clearCounters();
      sframeRef.current = null;
    }
    setGlobalSFrame(null);
    if (presenceAdapterRef.current) {
      presenceAdapterRef.current.detach();
      presenceAdapterRef.current = null;
    }
    usePresenceStore.getState().resetPresence();

    if (layoutAdapterRef.current) {
      layoutAdapterRef.current.detach();
      layoutAdapterRef.current = null;
    }
    useLayoutStore.getState().reset();

    if (collaborationAdapterRef.current) {
      collaborationAdapterRef.current.detach();
      collaborationAdapterRef.current = null;
    }
    useCollaborationStore.getState().reset();

    DeviceManager.getInstance().destroy();
    useDeviceStore.getState().reset();

HostControlManager.getInstance().detach();
      useHostControlStore.getState().reset();
      setScreenStream(null);
      useLayoutStore.getState().setScreenShareOwner(null);

      if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
      (window as any).__LIVEKIT_ROOM__ = null;
    }
  }, []);

  const publishHandRaise = useCallback(async (raised: boolean) => {
    if (presenceAdapterRef.current) {
      await presenceAdapterRef.current.publishHandRaise(raised);
    }
  }, []);

  const publishSpotlight = useCallback(async (targetParticipantId: string | null) => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      const payload = JSON.stringify({
        type: 'spotlight',
        participantId: targetParticipantId,
        timestamp: Date.now(),
      });
      const bytes = new TextEncoder().encode(payload);
      await room.localParticipant.publishData(bytes, {
        reliable: true,
        topic: SPOTLIGHT_TOPIC,
      });
      useLayoutStore.getState().setSpotlight(targetParticipantId);
    }
  }, []);

  const publishChatMessage = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timestamp = Date.now();
      const payload = JSON.stringify({
        type: 'chat',
        id: msgId,
        text,
        timestamp,
      });
      const bytes = new TextEncoder().encode(payload);
      await room.localParticipant.publishData(bytes, {
        reliable: true,
        topic: CHAT_TOPIC,
      });

      const senderId = room.localParticipant.identity;
      const presence = usePresenceStore.getState();
      const senderName =
        presence.participants.get(senderId)?.name ||
        room.localParticipant.name ||
        `You (${senderId.slice(0, 6)})`;

      useCollaborationStore.getState().addMessage({
        id: msgId,
        senderId,
        senderName,
        text,
        timestamp,
        isLocal: true,
      });
    }
  }, []);

  const publishReaction = useCallback(async (emoji: ReactionEmoji) => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      const rxId = `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timestamp = Date.now();
      const payload = JSON.stringify({
        type: 'reaction',
        id: rxId,
        emoji,
        timestamp,
      });
      const bytes = new TextEncoder().encode(payload);
      await room.localParticipant.publishData(bytes, {
        reliable: true,
        topic: REACTION_TOPIC,
      });

      const senderId = room.localParticipant.identity;
      const presence = usePresenceStore.getState();
      const senderName =
        presence.participants.get(senderId)?.name ||
        room.localParticipant.name ||
        `You (${senderId.slice(0, 6)})`;

      const rx: ReactionEvent = {
        id: rxId,
        senderId,
        senderName,
        emoji,
        timestamp,
        xOffset: Math.floor(15 + Math.random() * 70),
      };
      useCollaborationStore.getState().addReaction(rx);

      setTimeout(() => {
        useCollaborationStore.getState().removeReaction(rxId);
      }, 3500);
    }
  }, []);

  const publishAnnouncement = useCallback(async (message: string) => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      const annId = `ann-${Date.now()}`;
      const timestamp = Date.now();
      const payload = JSON.stringify({
        type: 'announcement',
        id: annId,
        message,
        timestamp,
      });
      const bytes = new TextEncoder().encode(payload);
      await room.localParticipant.publishData(bytes, {
        reliable: true,
        topic: ANNOUNCEMENT_TOPIC,
      });

      const senderId = room.localParticipant.identity;
      const presence = usePresenceStore.getState();
      const senderName =
        presence.participants.get(senderId)?.name ||
        room.localParticipant.name ||
        'You (Host)';

      useCollaborationStore.getState().setAnnouncement({
        id: annId,
        message,
        senderName,
        timestamp,
        active: true,
      });
    }
  }, []);

  const lowerParticipantHand = useCallback(async (targetParticipantId?: string) => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      const payload = JSON.stringify({
        type: 'hand-action',
        action: targetParticipantId ? 'lower-hand' : 'lower-all',
        targetParticipantId,
        timestamp: Date.now(),
      });
      const bytes = new TextEncoder().encode(payload);
      await room.localParticipant.publishData(bytes, {
        reliable: true,
        topic: HAND_ACTION_TOPIC,
      });

      if (targetParticipantId) {
        usePresenceStore.getState().setHandRaised(targetParticipantId, false);
      } else {
        usePresenceStore.getState().lowerAllHands();
      }
    }
  }, []);

  const switchDevice = useCallback(async (kind: MediaDeviceKind, deviceId: string) => {
    await DeviceManager.getInstance().switchActiveDevice(roomRef.current, kind, deviceId);
  }, []);

  return {
    room: roomRef.current,
    localStream,
    remoteStreams: Array.from(remoteStreams.values()),
    screenStream,
    stats,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    leave,
    publishHandRaise,
    publishSpotlight,
    publishChatMessage,
    publishReaction,
    publishAnnouncement,
    lowerParticipantHand,
    switchDevice,
  };
}