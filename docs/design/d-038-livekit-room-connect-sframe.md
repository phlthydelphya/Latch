# D-038: LiveKit Room.connect + Track + SFrame Integration Design

**Status:** Design Phase  
**Milestone:** M0-P0 (GO/NO-GO)  
**Author:** @webrtc  
**Date:** 2026-09-04

---

## Executive Summary

Replace the current **mesh WebRTC architecture** (WebRTCManager with peer-to-peer RTCPeerConnection + WSS signaling) with **LiveKit Client SDK** single-SFU architecture while preserving:
- SFrame E2EE (Encoded Transform primary + WASM fallback)
- HPKE-based key rotation (DataChannel commits + signaling Welcome)
- Simulcast 3×2 (VP9 SVC preferred, H264 fallback)
- Last-N=9 / Dynacast with blind-forward fallback (3 layers ≤20p)
- Screen share (`getDisplayMedia`) with SFrame encryption
- Reconnect ≤5s p95 with ICE restart + epoch preservation
- TURN relay HMAC 24h verification

---

## 1. Room.connect Integration Design

### 1.1 New Configuration Types

```typescript
// src/livekit/types.ts (NEW FILE)

export interface LiveKitRoomConfig {
  // SFU assignment from meet-sfu-manager (HRW xxhash)
  sfuUrl: string;                    // e.g., "wss://livekit.example.com" or "ws://127.0.0.1:7880"
  roomName: string;                  // roomId from URL
  participantIdentity: string;       // participantId (UUID)
  participantName: string;           // display name
  
  // Token from meet-signal POST /token (JWT HS256, aud=roomId, 5m TTL)
  token: string;                     // LiveKit access token (JWT)
  
  // E2EE mode selection
  e2eeMode: 'sframe' | 'blind' | 'dtls-only';
  // 'sframe'      = Encoded Transform + WASM fallback (P0 target)
  // 'blind'       = SFU blind-forwards 3 simulcast layers, SFrame at endpoints only
  // 'dtls-only'   = ⚠️ EXPLICIT WARNING — no SFrame, DTLS-SRTP only (NO-GO fallback)
  
  // SFrame config (reused from existing SFrameConfig)
  sframe: SFrameConfig;
  
  // Simulcast config (reused from existing SimulcastConfig)
  simulcast: SimulcastConfig;
  
  // Last-N / Dynacast
  lastN: number;                     // 9
  dynacast: DynacastConfig;
  
  // Reconnect
  reconnect: ReconnectConfig;
  
  // TURN credentials (from turn-auth)
  iceServers: RTCIceServer[];
}
```

### 1.2 RoomConnection Manager (NEW FILE)

```typescript
// src/livekit/connection.ts (NEW FILE)

import { Room, RoomOptions, RoomEvent, Track, RemoteTrack, RemoteVideoTrack, 
         LocalVideoTrack, LocalAudioTrack, VideoPreset, createLocalTracks,
         ConnectionState, TrackPublishOptions, TrackSubscriptionOptions } from 'livekit-client';
import { EventEmitter } from 'eventemitter3';
import type { LiveKitRoomConfig } from './types.js';
import { SFrameTransform } from '../sframe/transform.js';
import { KeyManager } from '../keys/manager.js';
import { TURNManager } from '../turn/manager.js';
import { ReconnectManager } from '../reconnect/manager.js';
import { MetricsCollector } from '../metrics/collector.js';
import { ScreenShareManager } from '../screen/manager.js';

export class LiveKitConnection extends EventEmitter {
  private room: Room | null = null;
  private config: LiveKitRoomConfig;
  private keyManager: KeyManager;
  private screenManager: ScreenShareManager;
  private turnManager: TURNManager;
  private reconnectManager: ReconnectManager;
  private metrics: MetricsCollector;
  
  // SFrame state
  private senderTransform: SFrameTransform | null = null;
  private receiverTransforms: Map<string, SFrameTransform> = new Map(); // participantIdentity -> transform
  private currentKID = 0;
  private epochSecret: CryptoKey | null = null;
  private senderKeys: Map<string, CryptoKey> = new Map(); // participantIdentity -> senderKey
  private hpkePubKeys: Map<string, CryptoKey> = new Map(); // participantIdentity -> HPKE pubkey
  
  // DataChannel for key rotation (LiveKit supports DataChannel via publishData)
  private keyDataChannel: RTCDataChannel | null = null;
  private keyChannelOpen = false;
  
  // Track references
  private localVideoTrack: LocalVideoTrack | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private screenTrack: LocalVideoTrack | null = null;
  private isScreenSharing = false;
  
  constructor(config: LiveKitRoomConfig) {
    super();
    this.config = config;
    
    // Initialize sub-managers (same as WebRTCManager)
    this.keyManager = new KeyManager({
      cipherSuite: config.sframe.cipherSuite,
      keyRotationIntervalMs: config.sframe.keyRotationIntervalMs,
    });
    
    this.screenManager = new ScreenShareManager({
      simulcast: config.simulcast,
      sframe: config.sframe,
    });
    
    this.turnManager = new TURNManager({
      credentialsUrl: '', // Not used — ICE from LiveKit token
      roomId: config.roomName,
      participantHash: config.participantIdentity,
    });
    // Override with LiveKit-provided ICE servers
    this.turnManager['state'].iceServers = config.iceServers;
    
    this.reconnectManager = new ReconnectManager({
      maxAttempts: config.reconnect.maxAttempts,
      baseDelayMs: config.reconnect.baseDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      iceRestart: config.reconnect.iceRestart,
      preserveEpoch: config.reconnect.preserveEpoch,
      signalReconnect: () => this.reconnectSignaling(),
      createIceRestartOffer: () => this.triggerIceRestart(),
    });
    
    this.metrics = new MetricsCollector({
      enabled: config.metrics.enabled,
      intervalMs: config.metrics.intervalMs,
      histogramBuckets: config.metrics.histogramBuckets,
    });
  }

  async connect(): Promise<void> {
    // 1. Initialize KeyManager (derive epoch, generate HPKE keypair)
    await this.keyManager.initialize(this.config.participantIdentity);
    this.epochSecret = this.keyManager.getCurrentEpochSecret();
    
    // 2. Publish HPKE public key via LiveKit metadata or DataChannel
    // LiveKit doesn't have direct "metadata broadcast" — use publishData reliable
    const hpkePubB64 = await this.keyManager.exportHPKEPublicKey();
    
    // 3. Configure RoomOptions
    const roomOptions: RoomOptions = {
      // LiveKit handles ICE via token; we pass TURN for backup
      rtcConfig: {
        iceServers: this.config.iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      },
      // Audio/video capture handled manually (we create tracks)
      audioCaptureDefaults: false,
      videoCaptureDefaults: false,
      // Reconnect
      reconnect: true,
      // E2EE mode — LiveKit 1.25 supports 'blind' mode for SFrame
      e2ee: this.config.e2eeMode === 'sframe' ? 'sframe' : 
            this.config.e2eeMode === 'blind' ? 'blind' : undefined,
    };
    
    // 4. Create Room instance
    this.room = new Room(roomOptions);
    this.setupRoomEventHandlers();
    
    // 5. Connect to SFU
    await this.room.connect(this.config.sfuUrl, this.config.token, {
      participantName: this.config.participantName,
    });
    
    // 6. Setup DataChannel for key rotation (after connection)
    await this.setupKeyDataChannel();
    
    // 7. Publish HPKE public key to peers
    await this.broadcastHPKEPublicKey(hpkePubB64);
    
    // 8. Initialize SFrame
    await this.initializeSFrame();
    
    // 9. Start periodic key rotation
    this.keyManager.stopRotationTimer();
    this.startPeriodicRotation();
    
    this.emit('connected');
  }

  private setupRoomEventHandlers(): void {
    if (!this.room) return;
    
    // Connection state
    this.room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.emit('connection-state-change', state);
      if (state === ConnectionState.Connected) {
        this.metrics.start();
        this.emit('connected');
      } else if (state === ConnectionState.Disconnected || state === ConnectionState.Failed) {
        this.reconnectManager.start('connection-lost');
      }
    });
    
    // Participant events
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      this.handleParticipantJoined(participant);
    });
    
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.handleParticipantLeft(participant);
    });
    
    // Track events
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      this.handleTrackSubscribed(track, participant);
    });
    
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      this.handleTrackUnsubscribed(track, participant);
    });
    
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      this.handleTrackPublished(publication, participant);
    });
    
    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      this.handleTrackUnpublished(publication, participant);
    });
    
    // DataChannel for key rotation
    this.room.on(RoomEvent.DataReceived, (payload, participant) => {
      this.handleDataChannelMessage(payload, participant.identity);
    });
    
    // Local track events
    this.room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      if (participant.identity === this.config.participantIdentity) {
        this.setupLocalTrackTransforms(publication);
      }
    });
  }

  private async setupKeyDataChannel(): Promise<void> {
    // LiveKit creates DataChannel automatically when publishing data
    // We publish a reliable data channel for key rotation
    await this.room.localParticipant.publishData(
      new TextEncoder().encode('sframe-key-channel-init'),
      { reliable: true, topic: 'sframe-keys' }
    );
    
    // The actual DataChannel is internal to LiveKit; we intercept via DataReceived
    this.keyChannelOpen = true;
    this.emit('data-channel-open');
  }

  private async broadcastHPKEPublicKey(pubKeyB64: string): Promise<void> {
    // Publish via reliable DataChannel to all participants
    await this.room.localParticipant.publishData(
      JSON.stringify({
        type: 'hpke-pubkey',
        participantId: this.config.participantIdentity,
        hpkePublicKey: pubKeyB64,
      }),
      { reliable: true, topic: 'sframe-keys' }
    );
  }

  private async initializeSFrame(): Promise<void> {
    if (!this.config.sframe.enabled) return;
    
    try {
      if (this.config.sframe.useEncodedTransform && this.isEncodedTransformSupported()) {
        await this.setupEncodedTransform();
      } else if (this.config.sframe.wasmFallback) {
        await this.setupWASMFallback();
      } else {
        throw new Error('SFrame: No supported implementation available');
      }
    } catch (error) {
      if (this.config.sframe.wasmFallback) {
        console.warn('Encoded Transform failed, falling back to WASM:', error);
        await this.setupWASMFallback();
      } else {
        throw error;
      }
    }
  }

  private isEncodedTransformSupported(): boolean {
    return 'RTCEncodedVideoFrame' in window && 
           'RTCRtpScriptTransform' in window &&
           typeof ReadableStream !== 'undefined' &&
           typeof TransformStream !== 'undefined';
  }

  private async setupEncodedTransform(): Promise<void> {
    // Create sender transform
    this.senderTransform = new SFrameTransform({
      keyManager: this.keyManager,
      cipherSuite: this.config.sframe.cipherSuite,
      getCurrentKID: () => this.currentKID,
    });
    
    // Apply to local video track sender
    if (this.localVideoTrack) {
      const sender = this.localVideoTrack.mediaStreamTrack 
        ? this.room?.localParticipant.getTrackPublication(this.localVideoTrack.sid)?.track?.sender
        : null;
      // Actually, LiveKit exposes sender via track.publication.sender
      // We'll apply in setupLocalTrackTransforms when track is published
    }
  }

  private async setupWASMFallback(): Promise<void> {
    const wasmModule = await import(/* @vite-ignore */ this.config.sframe.wasmPath);
    await wasmModule.default();
    console.log('WASM SFrame fallback initialized');
  }

  private setupLocalTrackTransforms(publication: any): void {
    if (!this.senderTransform || !this.config.sframe.useEncodedTransform) return;
    
    const track = publication.track;
    if (!track || track.kind !== 'video') return;
    
    // Apply Encoded Transform to sender
    // LiveKit 2.x exposes sender via track.mediaStreamTrack and RTCRtpSender
    const sender = track.sender; // RTCRtpSender
    if (sender) {
      const transformer = this.senderTransform.createSenderTransformer();
      // Note: Requires RTCRtpScriptTransform - applied at transceiver creation time
      // For LiveKit, we need to set up transformer BEFORE publishing
      // This is handled in createAndPublishLocalTracks()
    }
  }

  // ==================== TRACK PUBLICATION ====================

  async createAndPublishLocalTracks(constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<void> {
    // Create tracks with simulcast configuration
    const tracks = await createLocalTracks({
      audio: constraints.audio ? { 
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } : false,
      video: constraints.video ? {
        resolution: VideoPreset.h720, // Base resolution; simulcast layers scale down
        facingMode: 'user',
      } : false,
      // Simulcast encodings
      videoEncoding: this.config.simulcast.layers.map(l => ({
        rid: l.rid,
        scaleResolutionDownBy: l.scaleResolutionDownBy,
        maxBitrate: l.maxBitrate,
        maxFramerate: l.maxFramerate,
        active: l.active,
        codec: this.getPreferredVideoCodecMimeType(),
      })),
    });

    // Separate video and audio tracks
    for (const track of tracks) {
      if (track.kind === Track.Kind.Video) {
        this.localVideoTrack = track as LocalVideoTrack;
        
        // Apply Encoded Transform BEFORE publishing (critical for SFrame)
        if (this.config.sframe.enabled && this.config.sframe.useEncodedTransform && this.senderTransform) {
          await this.applySenderTransform(this.localVideoTrack);
        }
        
        await this.room!.localParticipant.publishTrack(this.localVideoTrack, {
          name: 'camera',
          simulcast: this.config.simulcast.enabled,
          videoEncoding: this.config.simulcast.layers.map(l => ({
            rid: l.rid,
            scaleResolutionDownBy: l.scaleResolutionDownBy,
            maxBitrate: l.maxBitrate,
            maxFramerate: l.maxFramerate,
            active: l.active,
          })),
        });
      } else if (track.kind === Track.Kind.Audio) {
        this.localAudioTrack = track as LocalAudioTrack;
        await this.room!.localParticipant.publishTrack(this.localAudioTrack, {
          name: 'microphone',
        });
      }
    }
    
    this.emit('tracks-published', { video: this.localVideoTrack, audio: this.localAudioTrack });
  }

  private async applySenderTransform(track: LocalVideoTrack): Promise<void> {
    if (!this.senderTransform) return;
    
    // Get the underlying RTCRtpSender
    const sender = track.sender;
    if (!sender) {
      console.warn('No sender available for transform');
      return;
    }
    
    // Create transformer
    const transformer = this.senderTransform.createSenderTransformer();
    
    // Apply via RTCRtpScriptTransform (requires Insertable Streams)
    // This must be done before the track is published or via replaceTrack
    // For LiveKit, we use the approach of setting up transform on the sender
    try {
      // @ts-ignore - RTCRtpScriptTransform is not in standard types yet
      const transform = new RTCRtpScriptTransform(transformer);
      sender.setStreams([transform.readable]);
      sender.setParameters({
        ...sender.getParameters(),
        encodings: this.config.simulcast.layers.map(l => ({
          rid: l.rid,
          scaleResolutionDownBy: l.scaleResolutionDownBy,
          maxBitrate: l.maxBitrate,
          maxFramerate: l.maxFramerate,
          active: l.active,
        })),
      });
      console.log('Encoded Transform applied to local video sender');
    } catch (error) {
      console.error('Failed to apply Encoded Transform:', error);
      throw error;
    }
  }

  // ==================== TRACK SUBSCRIPTION ====================

  private handleTrackSubscribed(track: RemoteTrack, participant: any): void {
    const participantId = participant.identity;
    
    if (track.kind === Track.Kind.Video) {
      const videoTrack = track as RemoteVideoTrack;
      
      // Apply receiver transform for SFrame decryption
      if (this.config.sframe.enabled && this.config.sframe.useEncodedTransform) {
        this.applyReceiverTransform(participantId, videoTrack);
      }
      
      // Attach to video element (handled by React components)
      this.emit('track-subscribed', { 
        track: videoTrack, 
        participantId,
        stream: videoTrack.mediaStreamTrack ? new MediaStream([videoTrack.mediaStreamTrack]) : null,
      });
    } else if (track.kind === Track.Kind.Audio) {
      this.emit('track-subscribed', { 
        track, 
        participantId,
        stream: track.mediaStreamTrack ? new MediaStream([track.mediaStreamTrack]) : null,
      });
    }
  }

  private applyReceiverTransform(participantId: string, track: RemoteVideoTrack): void {
    if (!this.config.sframe.useEncodedTransform || !this.isEncodedTransformSupported()) return;
    
    const transform = new SFrameTransform({
      keyManager: this.keyManager,
      cipherSuite: this.config.sframe.cipherSuite,
      getCurrentKID: () => this.currentKID,
    });
    
    this.receiverTransforms.set(participantId, transform);
    
    const sender = track.sender; // RTCRtpReceiver for remote track
    if (sender) {
      const transformer = transform.createReceiverTransformer();
      try {
        // @ts-ignore
        const transformObj = new RTCRtpScriptTransform(transformer);
        sender.setStreams([transformObj.readable]);
        console.log(`Encoded Transform applied to receiver for ${participantId}`);
      } catch (error) {
        console.error(`Failed to apply receiver transform for ${participantId}:`, error);
      }
    }
  }

  private handleTrackUnsubscribed(track: RemoteTrack, participant: any): void {
    const participantId = participant.identity;
    this.receiverTransforms.delete(participantId);
    this.emit('track-unsubscribed', { track, participantId });
  }

  // ==================== SCREEN SHARE ====================

  async startScreenShare(constraints?: DisplayMediaStreamConstraints): Promise<void> {
    if (this.isScreenSharing) throw new Error('Screen share already active');
    
    const stream = await this.screenManager.startScreenShare(constraints);
    const videoTrack = stream.getVideoTracks()[0];
    
    if (!videoTrack) throw new Error('No video track in screen share stream');
    
    // Create LocalVideoTrack from screen capture
    this.screenTrack = new LocalVideoTrack(videoTrack, {
      name: 'screen-share',
      simulcast: this.config.simulcast.enabled,
      videoEncoding: this.config.simulcast.layers.map(l => ({
        rid: l.rid,
        scaleResolutionDownBy: l.scaleResolutionDownBy,
        maxBitrate: l.maxBitrate,
        maxFramerate: l.maxFramerate,
        active: l.active,
      })),
    });
    
    // Apply SFrame transform to screen track
    if (this.config.sframe.enabled && this.config.sframe.useEncodedTransform && this.senderTransform) {
      await this.applySenderTransform(this.screenTrack);
    }
    
    // Replace camera track with screen track
    await this.room!.localParticipant.publishTrack(this.screenTrack, {
      name: 'screen-share',
      simulcast: this.config.simulcast.enabled,
    });
    
    // Stop camera track
    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
    }
    
    this.isScreenSharing = true;
    this.emit('screen-share-started', { stream, track: this.screenTrack });
  }

  async stopScreenShare(): Promise<void> {
    if (!this.isScreenSharing || !this.screenTrack) return;
    
    // Unpublish screen track
    await this.room!.localParticipant.unpublishTrack(this.screenTrack.sid);
    this.screenTrack.stop();
    this.screenTrack = null;
    
    // Restore camera track
    if (this.localVideoTrack) {
      await this.createAndPublishLocalTracks({ video: true, audio: false });
    }
    
    await this.screenManager.stopScreenShare();
    this.isScreenSharing = false;
    this.emit('screen-share-stopped');
  }

  // ==================== KEY ROTATION ====================

  private async handleParticipantJoined(participant: any): Promise<void> {
    const participantId = participant.identity;
    
    // Check if participant has HPKE pubkey in metadata
    const metadata = participant.metadata ? JSON.parse(participant.metadata) : {};
    if (metadata.hpkePublicKey) {
      try {
        const peerPub = await this.keyManager.importHPKEPublicKey(metadata.hpkePublicKey);
        this.keyManager.setParticipantHPKEPublicKey(participantId, peerPub);
        this.hpkePubKeys.set(participantId, peerPub);
      } catch (e) {
        console.warn('Failed to import peer HPKE public key on join:', e);
      }
    }
    
    // Derive sender key for new participant
    if (this.epochSecret) {
      const senderKey = await this.keyManager.deriveSenderKey(this.epochSecret, participantId);
      this.senderKeys.set(participantId, senderKey);
    }
    
    this.emit('participant-joined', { participantId });
    
    // Re-broadcast our HPKE pubkey for the newcomer
    const hpkePubB64 = await this.keyManager.exportHPKEPublicKey();
    await this.broadcastHPKEPublicKey(hpkePubB64);
    
    // Rotate epoch on join (MLS-style)
    setTimeout(() => this.rotateOnJoin(participantId), 150);
  }

  private async handleParticipantLeft(participant: any): Promise<void> {
    const participantId = participant.identity;
    
    // Zeroize sender key
    const key = this.senderKeys.get(participantId);
    if (key) {
      await this.keyManager.zeroizeKey(key);
      this.senderKeys.delete(participantId);
    }
    
    // Remove HPKE public key
    this.keyManager.removeParticipantHPKEPublicKey(participantId);
    this.hpkePubKeys.delete(participantId);
    
    // Remove receiver transform
    this.receiverTransforms.delete(participantId);
    
    this.emit('participant-left', { participantId });
    
    // Trigger epoch rotation on leave
    await this.rotateAndBroadcastEpoch('leave', participantId);
  }

  private async rotateOnJoin(joinerId: string): Promise<void> {
    // Wait for joiner's HPKE pubkey
    let attempts = 0;
    while (!this.keyManager.getParticipantHPKEPublicKey(joinerId) && attempts < 10) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    await this.rotateAndBroadcastEpoch('join', undefined, joinerId);
    
    // Send Welcome to joiner via signaling (LiveKit doesn't have direct peer signaling)
    // We'll use publishData to the specific participant (if supported) or rely on SFU relay
    await this.sendWelcomeToJoiner(joinerId);
  }

  private async sendWelcomeToJoiner(joinerId: string): Promise<void> {
    if (!this.epochSecret) return;
    const targetPub = this.keyManager.getParticipantHPKEPublicKey(joinerId);
    if (!targetPub) return;
    
    try {
      const welcome = await this.keyManager.createWelcome(this.epochSecret, targetPub);
      // Send via DataChannel (reliable, to specific participant)
      // LiveKit publishData broadcasts to all; we encrypt for joiner only
      await this.room!.localParticipant.publishData(
        JSON.stringify({
          type: 'welcome',
          epoch: this.currentKID,
          welcome: Array.from(welcome),
          targetParticipant: joinerId,
        }),
        { reliable: true, topic: 'sframe-keys' }
      );
    } catch (e) {
      console.warn('Failed to send Welcome to joiner:', e);
    }
  }

  private async rotateAndBroadcastEpoch(
    trigger: 'join' | 'leave' | 'periodic' | 'manual',
    leavingId?: string,
    excludeJoinerId?: string
  ): Promise<void> {
    const start = performance.now();
    try {
      const { commits, newEpoch } = await this.keyManager.rotateEpoch(trigger, leavingId);
      
      // Filter commits
      const filtered = new Map<string, Uint8Array>();
      for (const [pid, ct] of commits) {
        if (pid === excludeJoinerId) continue;
        if (leavingId && pid === leavingId) continue;
        filtered.set(pid, ct);
      }
      
      // Update our epoch state
      if (this.epochSecret) await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = this.keyManager.getCurrentEpochSecret();
      this.currentKID = newEpoch;
      
      // Broadcast via DataChannel (reliable, topic: sframe-keys)
      await this.broadcastCommitsViaDataChannel(filtered, newEpoch);
      
      const latency = performance.now() - start;
      this.metrics.recordKeyRotationLatency(latency);
      this.emit('key-rotated', { epoch: newEpoch, latency });
    } catch (e) {
      console.error('Epoch rotation failed:', e);
      this.emit('key-rotation-failed', e);
    }
  }

  private async broadcastCommitsViaDataChannel(commits: Map<string, Uint8Array>, epoch: number): Promise<void> {
    if (!this.keyChannelOpen) {
      console.warn('DataChannel not open, cannot broadcast commits');
      return;
    }
    
    const commitsObj: Record<string, number[]> = {};
    for (const [pid, ct] of commits) commitsObj[pid] = Array.from(ct);
    
    await this.room!.localParticipant.publishData(
      JSON.stringify({
        type: 'commit',
        epoch,
        senderId: this.config.participantIdentity,
        commits: commitsObj,
      }),
      { reliable: true, topic: 'sframe-keys' }
    );
  }

  private handleDataChannelMessage(payload: Uint8Array, senderIdentity: string): void {
    try {
      const message = JSON.parse(new TextDecoder().decode(payload));
      
      switch (message.type) {
        case 'hpke-pubkey':
          this.handleHPKEPubKey(message);
          break;
        case 'commit':
          this.handleDataChannelCommit(message);
          break;
        case 'welcome':
          if (message.targetParticipant === this.config.participantIdentity) {
            this.handleWelcome(message);
          }
          break;
        case 'key-rotation-ack':
          this.metrics.recordKeyRotationAck(message.epoch);
          break;
      }
    } catch (error) {
      console.error('Data channel message parse error:', error);
    }
  }

  private async handleHPKEPubKey(data: { participantId: string; hpkePublicKey: string }): Promise<void> {
    if (data.participantId === this.config.participantIdentity) return;
    try {
      const peerPub = await this.keyManager.importHPKEPublicKey(data.hpkePublicKey);
      this.keyManager.setParticipantHPKEPublicKey(data.participantId, peerPub);
      this.hpkePubKeys.set(data.participantId, peerPub);
    } catch (e) {
      console.warn('Failed to import HPKE pubkey:', e);
    }
  }

  private async handleDataChannelCommit(data: { epoch: number; commits: Record<string, number[]>; senderId: string }): Promise<void> {
    const myCiphertextArr = data.commits[this.config.participantIdentity];
    if (!myCiphertextArr) {
      console.log('No commit for us, ignoring');
      return;
    }
    
    const startTime = performance.now();
    try {
      const ciphertext = new Uint8Array(myCiphertextArr);
      const newEpochSecret = await this.keyManager.processCommit(ciphertext);
      
      if (this.epochSecret) await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = newEpochSecret;
      
      // Re-derive sender keys
      for (const [participantId] of this.senderKeys) {
        const newKey = await this.keyManager.deriveSenderKey(newEpochSecret, participantId);
        const oldKey = this.senderKeys.get(participantId);
        if (oldKey) await this.keyManager.zeroizeKey(oldKey);
        this.senderKeys.set(participantId, newKey);
      }
      
      this.currentKID = data.epoch;
      
      const latency = performance.now() - startTime;
      this.metrics.recordKeyRotationLatency(latency);
      
      // Ack
      await this.room!.localParticipant.publishData(
        JSON.stringify({ type: 'key-rotation-ack', epoch: data.epoch }),
        { reliable: true, topic: 'sframe-keys' }
      );
      
      this.emit('key-rotated', { epoch: data.epoch, latency });
    } catch (error) {
      console.error('DataChannel Commit decrypt failed:', error);
      this.emit('key-rotation-failed', error);
    }
  }

  private async handleWelcome(data: { welcome: number[]; epoch: number }): Promise<void> {
    const epochSecret = await this.keyManager.processWelcome(new Uint8Array(data.welcome));
    this.epochSecret = epochSecret;
    this.currentKID = data.epoch;
    this.emit('welcome-received', { epoch: data.epoch });
  }

  private startPeriodicRotation(): void {
    const interval = this.config.sframe.keyRotationIntervalMs || 300000;
    setInterval(() => {
      if (this.keyChannelOpen && this.keyManager.getCurrentEpoch() >= 0) {
        this.rotateAndBroadcastEpoch('periodic');
      }
    }, interval);
  }

  // ==================== RECONNECT ====================

  private async reconnectSignaling(): Promise<void> {
    // LiveKit handles reconnection automatically via RoomOptions.reconnect=true
    // This is called by ReconnectManager if custom logic needed
    if (this.room && this.room.connectionState !== ConnectionState.Connected) {
      await this.room.connect(this.config.sfuUrl, this.config.token);
    }
  }

  private async triggerIceRestart(): Promise<void> {
    // LiveKit handles ICE restart internally
    // We can force by disconnecting/reconnecting or using updateNetworkConfig
    if (this.room) {
      // LiveKit 2.x: room.restartIce() or similar
      // For now, reconnect triggers ICE restart
      await this.room.disconnect();
      await this.room.connect(this.config.sfuUrl, this.config.token);
    }
  }

  // ==================== MEDIA CONTROLS ====================

  async setVideoEnabled(enabled: boolean): Promise<void> {
    if (this.localVideoTrack) {
      this.localVideoTrack.setEnabled(enabled);
    }
    // Notify peers via data channel or track mute
    this.emit('video-toggled', { enabled });
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    if (this.localAudioTrack) {
      this.localAudioTrack.setEnabled(enabled);
    }
    this.emit('audio-toggled', { enabled });
  }

  // ==================== CLEANUP ====================

  async leave(): Promise<void> {
    this.keyManager.stopRotationTimer();
    
    // Zeroize all keys
    for (const [, key] of this.senderKeys) {
      await this.keyManager.zeroizeKey(key);
    }
    this.senderKeys.clear();
    
    if (this.epochSecret) {
      await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = null;
    }
    
    // Unpublish tracks
    if (this.localVideoTrack) await this.room?.localParticipant.unpublishTrack(this.localVideoTrack.sid);
    if (this.localAudioTrack) await this.room?.localParticipant.unpublishTrack(this.localAudioTrack.sid);
    if (this.screenTrack) await this.room?.localParticipant.unpublishTrack(this.screenTrack.sid);
    
    // Disconnect
    this.room?.disconnect();
    this.room = null;
    
    this.metrics.stop();
    this.emit('left');
  }

  getMetrics(): MetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  isConnected(): boolean {
    return this.room?.connectionState === ConnectionState.Connected;
  }

  destroy(): void {
    this.leave();
    this.removeAllListeners();
  }
}
```

---

## 2. Track Publication/Subscription Design

### 2.1 Simulcast 3×2 Configuration

```typescript
// src/livekit/simulcast.ts (NEW FILE - extracted from DEFAULT_P0_CONFIG)

export const LIVEKIT_SIMULCAST_LAYERS = [
  // q: 180p @ 300kbps, 15fps
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 300_000, maxFramerate: 15, active: true },
  // h: 360p @ 800kbps, 30fps  
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 800_000, maxFramerate: 30, active: true },
  // f: 720p @ 1.8Mbps, 30fps
  { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 1_800_000, maxFramerate: 30, active: true },
];

export const VP9_SVC_CODEC = 'video/VP9'; // profile-id=2 for SVC
export const H264_BASELINE_CODEC = 'video/H264'; // profile-level-id=42e01f

export function getLiveKitVideoEncodings(): any[] {
  return LIVEKIT_SIMULCAST_LAYERS.map(l => ({
    rid: l.rid,
    scaleResolutionDownBy: l.scaleResolutionDownBy,
    maxBitrate: l.maxBitrate,
    maxFramerate: l.maxFramerate,
    active: l.active,
    // Codec preference handled by LiveKit server config
  }));
}
```

### 2.2 Last-N=9 / Dynacast with Blind-Forward Fallback

| Mode | SFU Behavior | Client Behavior |
|------|--------------|-----------------|
| **Header-aware (target)** | SFU reads SFrame KID/CTR from header, forwards only requested layer per Last-N | Subscribe to 1 layer per remote participant |
| **Blind-forward (fallback)** | SFU forwards all 3 layers for all participants (Last-N=9 → ~10-12 Mbps down) | Subscribe to all 3 layers, discard unwanted locally |
| **DTLS-only (NO-GO)** | SFU decrypts, forwards plaintext | ⚠️ Warning banner, no E2EE |

**Implementation:** LiveKit server config (`livekit.yaml`) controls this:
```yaml
# livekit.yaml
e2ee:
  mode: "blind"  # or "sframe" when header-aware works
  key_provider: "none"  # We manage keys client-side
```

**Blind-forward bandwidth calculation (≤20p):**
- 9 participants × 3 layers × avg 1Mbps = ~27 Mbps down (high but acceptable for P0)
- Actual: q=300k, h=800k, f=1.8M → max ~27 Mbps, typical ~10-12 Mbps with layer adaptation
- UI shows shield badge: "E2EE · 3-layer relay"

### 2.3 Screen Share Track

```typescript
// Reuses existing ScreenShareManager with LiveKit track publishing

// In LiveKitConnection.startScreenShare():
// 1. Get display media via ScreenShareManager (getDisplayMedia)
// 2. Create LocalVideoTrack from MediaStreamTrack
// 3. Apply SFrame sender transform (same as camera)
// 4. Publish with name="screen-share", simulcast enabled
// 5. Unpublish camera track
// 6. On stop: reverse
```

---

## 3. HPKE/SFrame Integration Impact

### 3.1 Architecture Comparison

| Component | Mesh (Current) | LiveKit (Target) | Change |
|-----------|----------------|------------------|--------|
| **Peer Connection** | 1 RTCPeerConnection per peer | 1 Room → SFU | ✅ Simplified |
| **Signaling** | WSS `/signal` (custom frames) | LiveKit WebSocket protocol | 🔄 Replace |
| **Key Distribution** | DataChannel (mesh) + WSS Welcome | LiveKit DataChannel (publishData) | 🔄 Adapt |
| **SFrame Sender** | `sender.setParameters` + Encoded Transform | `LocalVideoTrack.sender` + Encoded Transform | 🔄 Adapt |
| **SFrame Receiver** | `ontrack` → `receiver.setStreams` | `RemoteVideoTrack.receiver` + Encoded Transform | 🔄 Adapt |
| **Key Rotation** | DataChannel mesh broadcast | LiveKit `publishData` reliable broadcast | 🔄 Adapt |
| **Welcome** | WSS `welcome` frame | LiveKit `publishData` to joiner | 🔄 Adapt |
| **HPKE Pubkey** | WSS `hpke-pubkey` frame | LiveKit `publishData` or participant metadata | 🔄 Adapt |

### 3.2 Key Rotation via LiveKit DataChannel

```typescript
// Key difference: Mesh uses RTCDataChannel per-peer; LiveKit uses single Room DataChannel

// Mesh (current): this.dataChannel.send(msg) → each peer's DataChannel
// LiveKit (target): room.localParticipant.publishData(msg, { reliable: true, topic: 'sframe-keys' })
//                   → SFU broadcasts to all participants in room
//                   → RoomEvent.DataReceived fires for each recipient

// Encryption unchanged: each commit is HPKE-encrypted per-recipient
// Recipient filters: if (commits[myId]) decrypt, else ignore
```

### 3.3 SFrameTransform Integration Points

```typescript
// SENDER SIDE (outbound video)
// Mesh: WebRTCManager.setupEncodedTransform() → sender.setParameters({ encodings }) → sender.setStreams([transform.readable])
// LiveKit: LiveKitConnection.applySenderTransform() → track.sender.setStreams([transform.readable])

// RECEIVER SIDE (inbound video)  
// Mesh: ontrack → applyReceiverTransform(receiver) → receiver.setStreams([transform.readable])
// LiveKit: RoomEvent.TrackSubscribed → applyReceiverTransform(participantId, track) → track.receiver.setStreams([transform.readable])

// Both use identical SFrameTransform class — zero changes needed to transform.ts
```

### 3.4 Mesh HPKE Code — What Stays, What Goes

| File | Action | Rationale |
|------|--------|-----------|
| `keys/manager.ts` | **KEEP** — core HPKE/SFrame key logic unchanged | Derives sender keys, rotates epochs, HPKE encrypt/decrypt |
| `sframe/transform.ts` | **KEEP** — Encoded Transform + WASM implementation | Pure crypto/transform, platform-agnostic |
| `webrtc/manager.ts` | **REPLACE** → `livekit/connection.ts` | Mesh PC management → LiveKit Room management |
| `signaling/client.ts` | **REPLACE** → LiveKit protocol | Custom WSS → LiveKit WebSocket |
| `reconnect/manager.ts` | **ADAPT** — keep logic, change `signalReconnect`/`createIceRestartOffer` callbacks | Same reconnect semantics, different transport |
| `turn/manager.ts` | **KEEP** — TURN credentials still needed for ICE fallback | LiveKit token provides ICE, but TURN backup for strict NAT |
| `screen/manager.ts` | **KEEP** — `getDisplayMedia` logic unchanged | Platform-specific screen capture |
| `hooks/useWebRTC.ts` | **REFACTOR** — swap `WebRTCManager` for `LiveKitConnection` | Same hook interface, different implementation |

---

## 4. Minimal Diff to Mesh Files

### 4.1 Files to DELETE
```
src/webrtc/manager.ts           → Replaced by livekit/connection.ts
src/signaling/client.ts         → Replaced by LiveKit protocol
```

### 4.2 Files to CREATE
```
src/livekit/types.ts            → LiveKitRoomConfig, exports
src/livekit/connection.ts       → LiveKitConnection class (main replacement)
src/livekit/simulcast.ts        → Simulcast layer constants
src/livekit/index.ts            → Barrel export
```

### 4.3 Files to MODIFY (Minimal)

| File | Changes |
|------|---------|
| `src/index.ts` | Export `LiveKitConnection`, `createLiveKitConnection`; deprecate `WebRTCManager` |
| `src/hooks/useWebRTC.ts` | Swap `createWebRTCManager` → `createLiveKitConnection`; same event interface |
| `src/store/appStore.ts` | Add `e2eeMode` field; no logic change |
| `vite.config.ts` | Ensure `livekit-client` in `optimizeDeps.include` (already there) |
| `package.json` | Verify `livekit-client` version ≥2.4.0 (already 2.4.0) |

### 4.4 Hook Interface Preservation (Critical)

```typescript
// useWebRTC.ts must maintain identical return type:

return {
  manager: LiveKitConnection,  // Same EventEmitter interface
  localStream: MediaStream,    // Combined local video+audio
  remoteStreams: MediaStream[], // Array of remote MediaStreams
  screenStream: MediaStream,   // Screen share stream
  stats: RTCStatsReport,       // From room.getStats()
  toggleAudio: () => Promise<void>,
  toggleVideo: () => Promise<void>,
  startScreenShare: () => Promise<void>,
  stopScreenShare: () => Promise<void>,
  leave: () => Promise<void>,
};
```

**Event mapping (WebRTCManager → LiveKitConnection):**
| WebRTCManager Event | LiveKitConnection Event | Notes |
|---------------------|------------------------|-------|
| `connected` | `connected` | Same |
| `reconnecting` | `reconnecting` | Same |
| `reconnected` | `reconnected` | Same |
| `reconnect-failed` | `reconnect-failed` | Same |
| `track` | `track-subscribed` | Payload: `{ track, participantId, stream }` |
| `participant-joined` | `participant-joined` | Same |
| `participant-left` | `participant-left` | Same |
| `key-rotated` | `key-rotated` | Same |
| `screen-share-started` | `screen-share-started` | Same |
| `screen-share-stopped` | `screen-share-stopped` | Same |
| `error` | `error` | Same |

---

## 5. SFU Assignment Flow (meet-sfu-manager Integration)

```typescript
// In useWebRTC.ts initialization flow:

async function initialize() {
  // 1. Get SFU assignment from meet-sfu-manager
  const sfuResponse = await fetch(`/api/sfu/assign?roomId=${roomId}`);
  const { sfuUrl } = await sfuResponse.json(); // e.g., "wss://livekit-1.example.com"
  
  // 2. Get token from meet-signal
  const tokenResponse = await fetch('/token', {
    method: 'POST',
    body: JSON.stringify({ roomId, name: participantName }),
  });
  const { token, participantId } = await tokenResponse.json();
  
  // 3. Get TURN credentials
  const turnResponse = await fetch('/turn/credentials', {
    method: 'POST',
    body: JSON.stringify({ roomId, participantHash: participantId }),
  });
  const turnCredentials = await turnResponse.json();
  const iceServers = buildIceServers(turnCredentials); // From TURNManager
  
  // 4. Create LiveKit connection
  const config: LiveKitRoomConfig = {
    sfuUrl,
    roomName: roomId,
    participantIdentity: participantId,
    participantName: participantName,
    token,
    e2eeMode: 'sframe', // or 'blind' based on feature flag
    sframe: DEFAULT_P0_CONFIG.sframe,
    simulcast: DEFAULT_P0_CONFIG.simulcast,
    lastN: 9,
    dynacast: DEFAULT_P0_CONFIG.dynacast,
    reconnect: DEFAULT_P0_CONFIG.reconnect,
    iceServers,
  };
  
  const connection = await createLiveKitConnection(config);
  // ... rest same as before
}
```

---

## 6. E2EE Mode Decision Matrix

| Condition | e2eeMode | UI Shield Text |
|-----------|----------|----------------|
| Encoded Transform supported + WASM loaded | `'sframe'` | "E2EE · SFrame" |
| Encoded Transform fails, WASM works | `'sframe'` (WASM) | "E2EE · SFrame (WASM)" |
| Header-aware Dynacast fails (SFU can't read KID) | `'blind'` | "E2EE · 3-layer relay" |
| SFrame completely unavailable | `'dtls-only'` | ⚠️ "WARNING: No E2EE — DTLS only" |

**Decision logic in `useWebRTC.ts`:**
```typescript
// After initializeSFrame() attempt:
let e2eeMode: 'sframe' | 'blind' | 'dtls-only' = 'sframe';
if (!encodedTransformWorks && !wasmWorks) {
  e2eeMode = 'dtls-only';
  setError('⚠️ SFrame unavailable — falling back to DTLS-only (no E2EE)');
} else if (!headerAwareWorks) {
  e2eeMode = 'blind';
  // UI shows "3-layer relay" badge
}
```

---

## 7. Testing Requirements (M0-P0 Criteria)

| Criterion | Test | Target |
|-----------|------|--------|
| **4. SFrame ciphertext proof** | Wireshark `rtp && sframe` on port 7880/7881 | No plaintext NALs, SFU opaque |
| **5. Screen share** | `getDisplayMedia` on Chrome/Edge/Firefox/Safari 17+ | All 4 browsers |
| **6. Key rotation p95** | 20 trials, 20p load, `qa/reports/key-rotation-latency.json` | ≤500ms |
| **7. Reconnect p95** | 10 trials/browser × 4 browsers, `qa/reports/reconnect-latency.json` | ≤5s |
| **8. TURN relay** | Force `iceTransportPolicy: relay`, verify `candidateType=relay` | 24h HMAC, Prometheus `turn_allocations_active` |

---

## 8. Migration Sequence (Zero-Downtime)

1. **Phase 1:** Add `livekit/` module alongside `webrtc/` (no removal)
2. **Phase 2:** Feature flag `VITE_USE_LIVEKIT=true` in `useWebRTC.ts`
3. **Phase 3:** Run load tests against LiveKit branch (20p × 10min)
4. **Phase 4:** If all 10 criteria PASS → flip flag default to `true`
5. **Phase 5:** Remove `webrtc/manager.ts`, `signaling/client.ts` after freeze

---

## 9. Open Questions / Risks

1. **LiveKit DataChannel reliability:** `publishData` with `reliable: true` uses SCTP ordered — confirm ordering guarantees match mesh DataChannel.
2. **Encoded Transform timing:** Must apply transform **before** track publish. LiveKit's `createLocalTracks` returns tracks with senders not yet attached. Solution: apply transform in `LocalTrackPublished` handler or use `replaceTrack` after.
3. **Welcome delivery:** Mesh uses WSS direct to joiner. LiveKit broadcasts to room. Joiner must filter `targetParticipant === me`. Risk: Welcome delivered before joiner subscribes to DataChannel. Mitigation: retry Welcome on `ParticipantConnected` + `DataChannel` open.
4. **VP9 SVC on LiveKit:** Confirm LiveKit 1.25 SFU supports VP9 SVC layer selection for Last-N. If not, blind-forward is mandatory.

---

## 10. Deliverables

| File | Status |
|------|--------|
| `docs/design/d-038-livekit-room-connect-sframe.md` | ✅ This document |
| `src/livekit/types.ts` | 🔄 To implement |
| `src/livekit/connection.ts` | 🔄 To implement |
| `src/livekit/simulcast.ts` | 🔄 To implement |
| `src/livekit/index.ts` | 🔄 To implement |
| `src/hooks/useWebRTC.ts` (modified) | 🔄 To implement |
| `src/index.ts` (modified) | 🔄 To implement |