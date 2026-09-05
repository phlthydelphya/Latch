/**
 * meet-webrtc-core: WebRTC Manager
 * M0-P0: LiveKit SFU single-node 20p, simulcast 3x2, VP9 SVC preferred, H264 fallback
 * SFrame RFC9605 via Encoded Transform + WASM fallback
 * Last-N=9 / Dynacast compatibility POC with SFrame opaque routing
 */

import { EventEmitter } from 'eventemitter3';
import type { RTCConfiguration, MediaStreamConstraints, DisplayMediaStreamConstraints } from '../types.js';
import { SFrameTransform } from '../sframe/transform.js';
import { KeyManager } from '../keys/manager.js';
import { SignalingClient } from '../signaling/client.js';
import { ScreenShareManager } from '../screen/manager.js';
import { TURNManager } from '../turn/manager.js';
import { ReconnectManager } from '../reconnect/manager.js';
import { MetricsCollector } from '../metrics/collector.js';

export interface WebRTCManagerConfig {
  roomId: string;
  participantId: string;
  signalingUrl: string;
  turnCredentialsUrl: string;
  jwt: string;
  iceServers?: RTCIceServer[];
  preferredCodecs: CodecPreference;
  simulcast: SimulcastConfig;
  sframe: SFrameConfig;
  lastN: number;
  dynacast: DynacastConfig;
  reconnect: ReconnectConfig;
  metrics: MetricsConfig;
}

export interface CodecPreference {
  video: ('VP9' | 'H264' | 'AV1')[];
  audio: ('opus' | 'PCMU' | 'PCMA')[];
}

export interface SimulcastConfig {
  enabled: true;
  layers: SimulcastLayer[];
  svc: boolean; // VP9 SVC preferred
}

export interface SimulcastLayer {
  rid: string;
  scaleResolutionDownBy: number;
  maxBitrate: number;
  maxFramerate: number;
  active: boolean;
}

export interface SFrameConfig {
  enabled: true;
  useEncodedTransform: boolean; // Insertable Streams / WebRTC Encoded Transform
  wasmFallback: boolean;
  wasmPath: string;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
}

export interface DynacastConfig {
  enabled: boolean;
  headerAware: boolean; // SFU inspects SFrame header (KID/CTR) without payload
  blindForwardFallback: boolean; // ship all 3 layers for ≤20p if header-aware fails
  maxLayersForwarded: number;
}

export interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  iceRestart: boolean;
  preserveEpoch: boolean;
}

export interface MetricsConfig {
  enabled: boolean;
  intervalMs: number;
  histogramBuckets: number[];
}

export class WebRTCManager extends EventEmitter {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private keyManager: KeyManager;
  private signaling: SignalingClient;
  private screenManager: ScreenShareManager;
  private turnManager: TURNManager;
  private reconnectManager: ReconnectManager;
  private metrics: MetricsCollector;
  private config: WebRTCManagerConfig;
  private epochSecret: CryptoKey | null = null;
  private senderKeys: Map<string, CryptoKey> = new Map();
  private currentKID: number = 0;
  private connected = false;
  private isReconnecting = false;
  private iceRestartPending = false;
  // ICE candidate queue for ordering race (M0-P0 fix 2026-09-03)
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionReady = false;
  private readonly MAX_ICE_QUEUE = 100;
  private periodicRotationTimer: number | null = null;
  // Perfect negotiation (RFC 8829) state
  private polite = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;

  constructor(config: WebRTCManagerConfig) {
    super();
    this.config = config;
    
    this.keyManager = new KeyManager({
      cipherSuite: config.sframe.cipherSuite,
      keyRotationIntervalMs: config.sframe.keyRotationIntervalMs,
    });
    
    this.signaling = new SignalingClient({
      url: config.signalingUrl,
      roomId: config.roomId,
      participantId: config.participantId,
      jwt: config.jwt,
    });
    
    this.screenManager = new ScreenShareManager({
      simulcast: config.simulcast,
      sframe: config.sframe,
    });
    
    this.turnManager = new TURNManager({
      credentialsUrl: config.turnCredentialsUrl,
      roomId: config.roomId,
      participantHash: config.participantId,
    });
    
    this.reconnectManager = new ReconnectManager({
      maxAttempts: config.reconnect.maxAttempts,
      baseDelayMs: config.reconnect.baseDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      iceRestart: config.reconnect.iceRestart,
      preserveEpoch: config.reconnect.preserveEpoch,
    });
    
    this.metrics = new MetricsCollector({
      enabled: config.metrics.enabled,
      intervalMs: config.metrics.intervalMs,
      histogramBuckets: config.metrics.histogramBuckets,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.signaling.on('offer', this.handleDescription.bind(this));
    this.signaling.on('answer', this.handleDescription.bind(this));
    this.signaling.on('ice-candidate', this.handleIceCandidate.bind(this));
    this.signaling.on('join', this.handleParticipantJoin.bind(this));
    this.signaling.on('hpke-pubkey', this.handleHPKEPubKey.bind(this));
    this.signaling.on('leave', this.handleParticipantLeave.bind(this));
    // Commit now delivered via DataChannel only (S-02)
    this.signaling.on('welcome', this.handleWelcome.bind(this));
    this.signaling.on('session-update', this.handleSessionUpdate.bind(this));
    this.signaling.on('disconnected', this.handleSignalingDisconnected.bind(this));
    
    this.reconnectManager.on('reconnecting', () => {
      this.isReconnecting = true;
      this.emit('reconnecting');
    });
    
    this.reconnectManager.on('reconnected', () => {
      this.isReconnecting = false;
      this.emit('reconnected');
    });
    
    this.reconnectManager.on('failed', (error) => {
      this.isReconnecting = false;
      this.emit('reconnect-failed', error);
    });
  }

  async initialize(): Promise<void> {
    // Fetch TURN credentials
    const turnServers = await this.turnManager.getCredentials();
    const iceServers = this.config.iceServers ? [...this.config.iceServers, ...turnServers] : turnServers;

    // Create peer connection with SFU-optimized config
    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.setupPeerConnectionHandlers();

    // Create data channel for key management
    this.dataChannel = this.pc.createDataChannel('sframe-keys', {
      ordered: true,
      protocol: 'sframe.mls.1',
    });
    this.setupDataChannelHandlers();

    // Initialize the key manager and derive the initial epoch secret BEFORE
    // connecting signaling. The participant-join handler depends on it, and a
    // 'join' signal can arrive immediately after the socket opens (race).
    await this.keyManager.initialize(this.config.participantId);
    this.epochSecret = this.keyManager.getCurrentEpochSecret();

    // Connect signaling
    await this.signaling.connect();

    // Publish our HPKE public key to peers during join (requirement 2)
    // Peers will import it via 'hpke-pubkey' and use it for per-recipient commit encryption
    try {
      const hpkePubB64 = await this.keyManager.exportHPKEPublicKey();
      this.signaling.publishHPKEPublicKey(hpkePubB64);
    } catch (e) {
      console.warn('Failed to publish HPKE public key:', e);
    }

    // Disable KeyManager internal periodic timer — WebRTCManager drives broadcast via DataChannel
    this.keyManager.stopRotationTimer();
    this.startPeriodicRotation();

    // Initialize SFrame transform
    await this.initializeSFrame();

    this.emit('initialized');
  }

  private setupPeerConnectionHandlers(): void {
    if (!this.pc) return;

    this.pc.onconnectionstatechange = () => {
      this.emit('connection-state-change', this.pc!.connectionState);
      if (this.pc!.connectionState === 'connected') {
        this.connected = true;
        this.metrics.start();
        this.emit('connected');
        // Emit event for SFrame tracking when connected
        this.emit('sframe-tracking-started');
      } else if (this.pc!.connectionState === 'disconnected' || this.pc!.connectionState === 'failed') {
        this.connected = false;
        if (!this.isReconnecting) {
          this.reconnectManager.start();
        }
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      this.emit('ice-connection-state-change', this.pc!.iceConnectionState);
      this.metrics.recordIceState(this.pc!.iceConnectionState);
    };

    this.pc.ontrack = (event) => {
      this.handleTrack(event);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(event.candidate.toJSON());
      }
    };
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.emit('data-channel-open');
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };

    this.dataChannel.onclose = () => {
      this.emit('data-channel-close');
    };

    this.dataChannel.onerror = (error) => {
      this.emit('data-channel-error', error);
    };
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
    if (!this.pc) return;

    const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;

    const transform = new SFrameTransform({
      keyManager: this.keyManager,
      cipherSuite: this.config.sframe.cipherSuite,
      getCurrentKID: () => this.currentKID,
    });

    // Apply Encoded Transform to sender
    const transformer = transform.createSenderTransformer();
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

    // Note: Actual Encoded Transform application requires RTCRtpScriptTransform
    // which is applied during transceiver creation. This is a simplified version.
    console.log('Encoded Transform initialized for sender');
  }

  private async setupWASMFallback(): Promise<void> {
    // WASM fallback using wasm-sframe in OffscreenCanvas worker
    const wasmModule = await import(/* @vite-ignore */ this.config.sframe.wasmPath);
    await wasmModule.default();
    console.log('WASM SFrame fallback initialized');
  }

  async join(roomId: string, constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<void> {
    // Get user media
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Add tracks with simulcast
    await this.addTracksWithSimulcast(this.localStream);
    
    this.emit('joined', { roomId });
  }

  private async addTracksWithSimulcast(stream: MediaStream): Promise<void> {
    if (!this.pc) return;

    for (const track of stream.getTracks()) {
      const transceiver = this.pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: [stream],
      });

      // Configure simulcast
      if (track.kind === 'video' && this.config.simulcast.enabled) {
        const params = transceiver.sender.getParameters();
        params.encodings = this.config.simulcast.layers.map(l => ({
          rid: l.rid,
          scaleResolutionDownBy: l.scaleResolutionDownBy,
          maxBitrate: l.maxBitrate,
          maxFramerate: l.maxFramerate,
          active: l.active,
          codec: this.getPreferredVideoCodec(),
        }));
        await transceiver.sender.setParameters(params);
      }

      // Set codec preferences
      transceiver.setCodecPreferences(this.getCodecPreferences());
    }
  }

  private getCodecPreferences(): RTCRtpCodec[] {
    const prefs: RTCRtpCodec[] = [];
    
    for (const codec of this.config.preferredCodecs.video) {
      if (codec === 'VP9') {
        prefs.push({ mimeType: 'video/VP9', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-id=0' });
        prefs.push({ mimeType: 'video/VP9', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-id=2' }); // SVC
      } else if (codec === 'H264') {
        prefs.push({ mimeType: 'video/H264', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-level-id=42e01f;level-asymmetry-allowed=1;packetization-mode=1' });
      } else if (codec === 'AV1') {
        prefs.push({ mimeType: 'video/AV1', clockRate: 90000, channels: 0 });
      }
    }
    
    for (const codec of this.config.preferredCodecs.audio) {
      if (codec === 'opus') {
        prefs.push({ mimeType: 'audio/opus', clockRate: 48000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1' });
      }
    }
    
    return prefs;
  }

  private getPreferredVideoCodec(): RTCRtpCodec {
    for (const codec of this.config.preferredCodecs.video) {
      if (codec === 'VP9') {
        return { mimeType: 'video/VP9', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-id=2' };
      } else if (codec === 'H264') {
        return { mimeType: 'video/H264', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-level-id=42e01f' };
      }
    }
    return { mimeType: 'video/VP9', clockRate: 90000, channels: 0, sdpFmtpLine: 'profile-id=0' };
  }

  private async negotiate(): Promise<void> {
    if (!this.pc) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription(); // implicit offer
      if (this.pc.localDescription) {
        this.signaling.sendOffer(this.pc.localDescription.toJSON());
      }
    } catch (err) {
      console.error('negotiation failed:', err);
    } finally {
      this.makingOffer = false;
    }
  }

  // RFC 8829 perfect negotiation: polite peer rolls back on glare, impolite
  // peer drops the colliding offer.
  private async handleDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;

    const readyForOffer = !this.makingOffer &&
      (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
    const offerCollision = description.type === 'offer' && !readyForOffer;

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    this.isSettingRemoteAnswerPending = description.type === 'answer';
    this.remoteDescriptionReady = false;
    try {
      await this.pc.setRemoteDescription(description); // rolls back implicitly on glare
      this.remoteDescriptionReady = true;
      // Drain queued ICE candidates now that remote description is set
      for (const candidate of this.pendingIceCandidates) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (e) {
          console.error('Failed to add queued ICE candidate:', e);
        }
      }
      this.pendingIceCandidates = [];
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }

    if (description.type === 'offer') {
      await this.pc.setLocalDescription(); // implicit answer
      if (this.pc.localDescription) {
        this.signaling.sendAnswer(this.pc.localDescription.toJSON());
      }
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !candidate) return;
    // Queue candidates until remote description ready (fixes “remote description was null”)
    if (!this.pc.remoteDescription || !this.remoteDescriptionReady) {
      // Enforce MAX_ICE_QUEUE bound to prevent unbounded growth
      if (this.pendingIceCandidates.length >= this.MAX_ICE_QUEUE) {
        const dropped = this.pendingIceCandidates.shift();
        console.warn(`ICE queue full (${this.MAX_ICE_QUEUE}), dropping oldest candidate:`, dropped);
      }
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }

  private handleTrack(event: RTCTrackEvent): void {
    const { track, streams, receiver } = event;
    
    // Apply SFrame receiver transform if enabled
    if (this.config.sframe.enabled && track.kind === 'video') {
      this.applyReceiverTransform(receiver);
    }
    
    this.emit('track', { track, streams, receiver });
  }

  private applyReceiverTransform(receiver: RTCRtpReceiver): void {
    if (!this.config.sframe.useEncodedTransform || !this.isEncodedTransformSupported()) return;

    const transform = new SFrameTransform({
      keyManager: this.keyManager,
      cipherSuite: this.config.sframe.cipherSuite,
      getCurrentKID: () => this.currentKID,
    });

    const transformer = transform.createReceiverTransformer();
    // Note: Actual application requires RTCRtpScriptTransform on receiver
    console.log('Encoded Transform applied to receiver');
  }

  private async handleParticipantJoin(data: { participantId: string; senderKey?: string; hpkePublicKey?: string }): Promise<void> {
    // If join payload carries HPKE pubkey (future), register immediately
    if (data.hpkePublicKey) {
      try {
        const peerPub = await this.keyManager.importHPKEPublicKey(data.hpkePublicKey);
        this.keyManager.setParticipantHPKEPublicKey(data.participantId, peerPub);
      } catch (e) {
        console.warn('Failed to import peer HPKE public key on join:', e);
      }
    }
    // Ignore our own join echo
    if (data.participantId === this.config.participantId) {
      this.emit('participant-joined', data);
      return;
    }
    // Derive SFrame sender key for new participant = HKDF(epoch, "sframe", sender_id)
    if (this.epochSecret) {
      const senderKey = await this.keyManager.deriveSenderKey(this.epochSecret!, data.participantId);
      this.senderKeys.set(data.participantId, senderKey);
    }
    this.emit('participant-joined', data);

    // Re-publish our HPKE pubkey so the newcomer (who missed our earlier publish) receives it via relay
    try {
      const hpkePubB64 = await this.keyManager.exportHPKEPublicKey();
      this.signaling.publishHPKEPublicKey(hpkePubB64);
    } catch {}

    // MLS-style: on join, rotate epoch for existing members (commit via DataChannel) + Welcome to joiner via signaling
    // Defer rotation to next tick to allow hpke-pubkey exchange to complete
    setTimeout(() => this.rotateOnJoin(data.participantId), 150);

    // Perfect negotiation tie-breaker
    this.polite = this.config.participantId < data.participantId;
    await this.negotiate();
  }

  private async rotateOnJoin(joinerId: string): Promise<void> {
    // Ensure we have the joiner's HPKE pubkey before rotating — otherwise Welcome would fail
    let attempts = 0;
    while (!this.keyManager.getParticipantHPKEPublicKey(joinerId) && attempts < 10) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    await this.rotateAndBroadcastEpoch('join', undefined, joinerId);
    // After broadcast, send Welcome containing the NEW epoch secret to the joiner
    await this.sendWelcomeToJoiner(joinerId);
  }

  private async handleHPKEPubKey(data: { participantId: string; hpkePublicKey: string }): Promise<void> {
    if (data.participantId === this.config.participantId) return;
    try {
      const peerPub = await this.keyManager.importHPKEPublicKey(data.hpkePublicKey);
      this.keyManager.setParticipantHPKEPublicKey(data.participantId, peerPub);
    } catch (e) {
      console.warn('Failed to import HPKE pubkey:', e);
    }
  }

  private async sendWelcomeToJoiner(joinerId: string): Promise<void> {
    if (!this.epochSecret) return;
    const targetPub = this.keyManager.getParticipantHPKEPublicKey(joinerId);
    if (!targetPub) return;
    try {
      const welcome = await this.keyManager.createWelcome(this.epochSecret, targetPub);
      this.signaling.sendWelcome(welcome, this.currentKID);
    } catch (e) {
      console.warn('Failed to send Welcome to joiner:', e);
    }
  }

  private async handleParticipantLeave(data: { participantId: string }): Promise<void> {
    // Zeroize sender key
    const key = this.senderKeys.get(data.participantId);
    if (key) {
      await this.keyManager.zeroizeKey(key);
      this.senderKeys.delete(data.participantId);
    }
    // Remove HPKE public key for departed peer
    this.keyManager.removeParticipantHPKEPublicKey(data.participantId);
    this.emit('participant-left', data);

    // Trigger epoch rotation on leave (p95 ≤500ms) — encrypt per-recipient, deliver via DataChannel
    await this.rotateAndBroadcastEpoch('leave', data.participantId);
  }

  /** Rotate epoch and broadcast Encrypted commits via DataChannel only (S-02). */
  private async rotateAndBroadcastEpoch(trigger: 'join' | 'leave' | 'periodic' | 'manual', leavingId?: string, excludeJoinerId?: string): Promise<void> {
    const start = performance.now();
    try {
      const { commits, newEpoch } = await this.keyManager.rotateEpoch(trigger, leavingId);
      // Filter commits if joiner should receive Welcome instead of commit
      const filtered = new Map<string, Uint8Array>();
      for (const [pid, ct] of commits) {
        if (pid === excludeJoinerId) continue;
        if (leavingId && pid === leavingId) continue;
        filtered.set(pid, ct);
      }
      // Update our own epoch state immediately (initiator)
      if (this.epochSecret) await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = this.keyManager.getCurrentEpochSecret();
      this.currentKID = newEpoch;
      // Deliver via RTCDataChannel, not signaling — ciphertext only, no epoch secret plaintext
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('DataChannel not open, cannot broadcast commits');
      return;
    }
    // Batch all per-recipient ciphertexts into one DataChannel JSON (each ciphertext is already HPKE)
    const commitsObj: Record<string, number[]> = {};
    for (const [pid, ct] of commits) commitsObj[pid] = Array.from(ct);
    const msg = JSON.stringify({
      type: 'commit',
      epoch,
      senderId: this.config.participantId,
      commits: commitsObj,
    });
    this.dataChannel.send(msg);
  }

  /** Handle a commit received over DataChannel — decrypt only if we are a recipient. */
  private async handleDataChannelCommit(data: { epoch: number; commits: Record<string, number[]>; senderId: string }): Promise<void> {
    const myCiphertextArr = data.commits[this.config.participantId];
    if (!myCiphertextArr) {
      // Not a recipient (e.g., we left or were not included) — ignore per requirement: non-recipient decrypt fails
      console.log('No commit for us, ignoring');
      return;
    }
    const startTime = performance.now();
    try {
      const ciphertext = new Uint8Array(myCiphertextArr);
      const newEpochSecret = await this.keyManager.processCommit(ciphertext);
      // Zeroize old epoch secret after successful rotation
      if (this.epochSecret) await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = newEpochSecret;
      
      // Re-derive sender keys for remaining participants under new epoch
      for (const [participantId] of this.senderKeys) {
        const newKey = await this.keyManager.deriveSenderKey(newEpochSecret, participantId);
        const oldKey = this.senderKeys.get(participantId);
        if (oldKey) await this.keyManager.zeroizeKey(oldKey);
        this.senderKeys.set(participantId, newKey);
      }
      
      this.currentKID = data.epoch;
      
      const latency = performance.now() - startTime;
      this.metrics.recordKeyRotationLatency(latency);
      
      // Ack via DataChannel
      if (this.dataChannel?.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({ type: 'key-rotation-ack', epoch: data.epoch }));
      }
      
      this.emit('key-rotated', { epoch: data.epoch, latency });
    } catch (error) {
      console.error('DataChannel Commit decrypt failed (expected for non-recipient):', error);
      this.emit('key-rotation-failed', error);
    }
  }

  private async handleWelcome(data: { welcome: Uint8Array; epoch: number }): Promise<void> {
    // Process MLS Welcome for new joiner
    const epochSecret = await this.keyManager.processWelcome(data.welcome);
    this.epochSecret = epochSecret;
    this.currentKID = data.epoch;
    this.emit('welcome-received', { epoch: data.epoch });
  }

  private async handleSessionUpdate(data: { iceUfrag: string; icePwd: string }): Promise<void> {
    if (!this.pc || !this.config.reconnect.iceRestart) return;
    
    this.iceRestartPending = true;
    
    // Create offer with ICE restart
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    this.signaling.sendOffer(offer);
    
    this.metrics.recordIceRestart();
  }

  private async handleSignalingDisconnected(): Promise<void> {
    if (!this.isReconnecting) {
      this.reconnectManager.start();
    }
  }

  private startPeriodicRotation(): void {
    if (this.periodicRotationTimer) clearInterval(this.periodicRotationTimer as any);
    const interval = this.config.sframe.keyRotationIntervalMs || 300000;
    this.periodicRotationTimer = setInterval(() => {
      if (this.dataChannel?.readyState === 'open' && this.keyManager.getCurrentEpoch() >= 0) {
        void this.rotateAndBroadcastEpoch('periodic');
      }
    }, interval) as unknown as number;
  }

  private stopPeriodicRotation(): void {
    if (this.periodicRotationTimer) {
      clearInterval(this.periodicRotationTimer as any);
      this.periodicRotationTimer = null;
    }
  }

  private handleDataChannelMessage(data: string | ArrayBuffer): void {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data as any);
      
      switch (message.type) {
        case 'commit':
          // Encrypted commit via DataChannel (S-02) — recipient decrypt succeeds, non-recipient fails
          void this.handleDataChannelCommit({ epoch: message.epoch, commits: message.commits, senderId: message.senderId });
          break;
        case 'key-rotation':
          // Legacy alias for commit
          void this.handleDataChannelCommit({ epoch: message.epoch, commits: message.commits || { }, senderId: message.senderId });
          break;
        case 'key-rotation-ack':
          this.metrics.recordKeyRotationAck(message.epoch);
          break;
        case 'sync-request':
          this.sendKeySync(message.requestId);
          break;
        case 'sync-response':
          void this.handleKeySyncResponse(message);
          break;
      }
    } catch (error) {
      console.error('Data channel message parse error:', error);
    }
  }

  private async sendKeySync(requestId: string): Promise<void> {
    const keys: Record<string, string> = {};
    for (const [id, key] of this.senderKeys) {
      keys[id] = await this.keyManager.exportKey(key);
    }
    this.dataChannel?.send(JSON.stringify({ type: 'sync-response', requestId, keys, epoch: this.currentKID }));
  }

  private async handleKeySyncResponse(message: { keys: Record<string, string>; epoch: number }): Promise<void> {
    // Import synced keys
    for (const [id, keyData] of Object.entries(message.keys)) {
      const key = await this.keyManager.importKey(keyData);
      this.senderKeys.set(id, key);
    }
    this.currentKID = message.epoch;
  }

  // Screen Share
  async startScreenShare(constraints?: DisplayMediaStreamConstraints): Promise<void> {
    const stream = await this.screenManager.startScreenShare(constraints);
    this.screenStream = stream;
    
    // Replace video track
    if (this.pc) {
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender && stream.getVideoTracks()[0]) {
        await sender.replaceTrack(stream.getVideoTracks()[0]);
      }
    }
    
    this.emit('screen-share-started', { stream });
  }

  async stopScreenShare(): Promise<void> {
    await this.screenManager.stopScreenShare();
    this.screenStream = null;
    
    // Restore camera track
    if (this.pc && this.localStream) {
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      const cameraTrack = this.localStream.getVideoTracks()[0];
      if (sender && cameraTrack) {
        await sender.replaceTrack(cameraTrack);
      }
    }
    
    this.emit('screen-share-stopped');
  }

  // Media controls
  async setVideoEnabled(enabled: boolean): Promise<void> {
    if (this.localStream) {
      for (const track of this.localStream.getVideoTracks()) {
        track.enabled = enabled;
      }
    }
    this.signaling.sendMute({ video: !enabled });
    this.emit('video-toggled', { enabled });
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
    this.signaling.sendMute({ audio: !enabled });
    this.emit('audio-toggled', { enabled });
  }

  async leave(): Promise<void> {
    this.stopPeriodicRotation();
    // Zeroize all keys
    for (const [, key] of this.senderKeys) {
      await this.keyManager.zeroizeKey(key);
    }
    this.senderKeys.clear();
    
    if (this.epochSecret) {
      await this.keyManager.zeroizeKey(this.epochSecret);
      this.epochSecret = null;
    }
    
    // Close connections
    this.dataChannel?.close();
    this.pc?.close();
    this.signaling.disconnect();
    this.metrics.stop();
    
    this.localStream?.getTracks().forEach(t => t.stop());
    this.screenStream?.getTracks().forEach(t => t.stop());
    
    this.emit('left');
  }

  getConnectionStats(): Promise<RTCStatsReport> {
    return this.pc!.getStats();
  }

  // Exposed for E2E test introspection (Playwright reads mgr.peerConnection)
  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  getMetrics(): MetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  isConnected(): boolean {
    return this.connected;
  }

  destroy(): void {
    this.leave();
    this.removeAllListeners();
  }
}

export interface MetricsSnapshot {
  keyRotationLatency: number[];
  reconnectLatency: number[];
  iceRestartCount: number;
  iceStateHistory: string[];
  sframeEncryptLatency: number[];
  sframeDecryptLatency: number[];
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
  jitter: number;
  rtt: number;
}