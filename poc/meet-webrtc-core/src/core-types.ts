// Type declarations and stub implementations for meet-webrtc-core (core library)
// This allows the app to type-check and build without checking core implementation

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
  svc: boolean;
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
  useEncodedTransform: boolean;
  wasmFallback: boolean;
  wasmPath: string;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
}

export interface DynacastConfig {
  enabled: boolean;
  headerAware: boolean;
  blindForwardFallback: boolean;
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

export interface KeyManagerConfig {
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
  hpkeConfig?: unknown;
}

export interface EpochKeys {
  senderKey: CryptoKey;
  epoch: number;
}

export interface WebRTCManagerEventMap {
  initialized: void;
  connected: void;
  disconnected: void;
  reconnecting: void;
  reconnected: void;
  'reconnect-failed': Error;
  'connection-state-change': RTCPeerConnectionState;
  'ice-connection-state-change': RTCIceConnectionState;
  track: { track: MediaStreamTrack; streams: MediaStream[]; receiver: RTCRtpReceiver };
  'participant-joined': { participantId: string; senderKey: string };
  'participant-left': { participantId: string };
  'key-rotated': { epoch: number; latency: number };
  'key-rotation-failed': Error;
  'welcome-received': { epoch: number };
  'screen-share-started': { stream: MediaStream };
  'screen-share-stopped': void;
  'video-toggled': { enabled: boolean };
  'audio-toggled': { enabled: boolean };
  error: Error;
  joined: { roomId: string; localStream?: MediaStream };
  left: void;
}

export class WebRTCManager extends EventTarget {
  constructor(config: WebRTCManagerConfig) { super(); }
  initialize(): Promise<void> { return Promise.resolve(); }
  join(roomId: string, constraints: MediaStreamConstraints): Promise<void> { return Promise.resolve(); }
  startScreenShare(constraints?: MediaStreamConstraints): Promise<void> { return Promise.resolve(); }
  stopScreenShare(): Promise<void> { return Promise.resolve(); }
  setVideoEnabled(enabled: boolean): Promise<void> { return Promise.resolve(); }
  setAudioEnabled(enabled: boolean): Promise<void> { return Promise.resolve(); }
  leave(): Promise<void> { return Promise.resolve(); }
  getConnectionStats(): Promise<RTCStatsReport> { return Promise.resolve({} as RTCStatsReport); }
  getMetrics(): MetricsSnapshot { return {} as MetricsSnapshot; }
  isConnected(): boolean { return false; }
  destroy(): void {}
  on<K extends keyof WebRTCManagerEventMap>(type: K, listener: (event: WebRTCManagerEventMap[K]) => void): void {}
  off<K extends keyof WebRTCManagerEventMap>(type: K, listener: (event: WebRTCManagerEventMap[K]) => void): void {}
  emit<K extends keyof WebRTCManagerEventMap>(type: K, event: WebRTCManagerEventMap[K]): void {}
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

export interface SFrameTransformConfig {
  keyManager: KeyManager;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  getCurrentKID: () => number;
  useWASM?: boolean;
  wasmModulePath?: string;
}

export interface EncodedFrame {
  data: ArrayBuffer;
  timestamp: number;
  ssrc: number;
  payloadType: number;
  sequenceNumber: number;
  marker: boolean;
}

export class SFrameTransform {
  constructor(config: SFrameTransformConfig) {}
  createSenderTransformer(): TransformStream<EncodedFrame, EncodedFrame> { return new TransformStream(); }
  createReceiverTransformer(): TransformStream<EncodedFrame, EncodedFrame> { return new TransformStream(); }
  rotateKey(newEpochSecret: CryptoKey): Promise<void> { return Promise.resolve(); }
  getCipherSuite(): unknown { return {}; }
  isUsingWASM(): boolean { return false; }
}

export class KeyManager {
  constructor(config: KeyManagerConfig) {}
  deriveSenderKey(epochSecret: CryptoKey, participantId: string): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  getCurrentSenderKey(): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  zeroizeKey(key: CryptoKey): Promise<void> { return Promise.resolve(); }
  processCommit(ciphertext: Uint8Array): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  processWelcome(welcome: Uint8Array): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  rotateEpoch(trigger: string, leavingId?: string): Promise<{ commits: Map<string, Uint8Array>; newEpoch: number }> { return Promise.resolve({ commits: new Map(), newEpoch: 0 }); }
  exportKey(key: CryptoKey): Promise<string> { return Promise.resolve(''); }
  importKey(keyData: string): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  hpkeDecrypt(ciphertext: Uint8Array): Promise<Uint8Array> { return Promise.resolve(new Uint8Array()); }
  exportHPKEPublicKey(): Promise<string> { return Promise.resolve(''); }
  importHPKEPublicKey(b64: string): Promise<CryptoKey> { return Promise.resolve({} as CryptoKey); }
  setParticipantHPKEPublicKey(participantId: string, key: CryptoKey): void {}
  getParticipantHPKEPublicKey(participantId: string): CryptoKey | null { return null; }
  removeParticipantHPKEPublicKey(participantId: string): void {}
}

export class SignalingClient extends EventTarget {
  constructor(config: SignalingConfig) { super(); }
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): void {}
  isConnected(): boolean { return false; }
  getReadyState(): number { return 0; }
  send(message: SignalingMessage): void {}
  sendOffer(offer: RTCSessionDescriptionInit): void {}
  sendAnswer(answer: RTCSessionDescriptionInit): void {}
  sendIceCandidate(candidate: RTCIceCandidateInit): void {}
  sendMute(mute: { audio?: boolean; video?: boolean }): void {}
  sendSpeaking(speaking: boolean): void {}
  publishHPKEPublicKey(hpkePublicKeyB64: string): void {}
  sendWelcome(welcome: Uint8Array, epoch: number): void {}
  sendSessionUpdate(iceUfrag: string, icePwd: string): void {}
}

export interface SignalingConfig {
  url: string;
  roomId: string;
  participantId: string;
  jwt: string;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'hpke-pubkey' | 'leave' | 'mute' | 'speaking' | 'welcome' | 'session-update' | 'ping';
  payload: unknown;
  roomId: string;
  participantId: string;
  timestamp: number;
}

export class ScreenShareManager {
  constructor(config: { simulcast: SimulcastConfig; sframe: SFrameConfig }) {}
  startScreenShare(constraints?: MediaStreamConstraints): Promise<MediaStream> { return Promise.resolve(new MediaStream()); }
  stopScreenShare(): Promise<void> { return Promise.resolve(); }
}

export class TURNManager {
  constructor(config: { credentialsUrl: string; jwt: string }) {}
  getCredentials(): Promise<RTCIceServer[]> { return Promise.resolve([]); }
}

export class ReconnectManager extends EventTarget {
  constructor(config: ReconnectConfig) { super(); }
  start(): void {}
  stop(): void {}
}

export class MetricsCollector {
  constructor(config: MetricsConfig) {}
  start(): void {}
  stop(): void {}
  getSnapshot(): MetricsSnapshot { return {} as MetricsSnapshot; }
  recordIceState(state: string): void {}
  recordKeyRotationLatency(latency: number): void {}
  recordKeyRotationAck(epoch: number): void {}
  recordIceRestart(): void {}
}

// Stub constants for P0 config
export const DEFAULT_P0_CONFIG: Partial<WebRTCManagerConfig> = {
  preferredCodecs: { video: ['VP9', 'H264'], audio: ['opus'] },
  simulcast: {
    enabled: true,
    layers: [
      { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 300000, maxFramerate: 15, active: true },
      { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 800000, maxFramerate: 30, active: true },
      { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 1800000, maxFramerate: 30, active: true },
    ],
    svc: true,
  },
  sframe: {
    enabled: true,
    useEncodedTransform: true,
    wasmFallback: true,
    wasmPath: '/wasm/sframe.js',
    cipherSuite: 'AES_GCM',
    keyRotationIntervalMs: 300000,
  },
  lastN: 9,
  dynacast: {
    enabled: true,
    headerAware: true,
    blindForwardFallback: true,
    maxLayersForwarded: 3,
  },
  reconnect: {
    maxAttempts: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    iceRestart: true,
    preserveEpoch: true,
  },
  metrics: {
    enabled: true,
    intervalMs: 1000,
    histogramBuckets: [50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000],
  },
};

export function createP0Config(overrides: Partial<WebRTCManagerConfig>): WebRTCManagerConfig {
  return { ...DEFAULT_P0_CONFIG, ...overrides } as WebRTCManagerConfig;
}

export async function createWebRTCManager(config: WebRTCManagerConfig): Promise<WebRTCManager> {
  const manager = new WebRTCManager(config);
  await manager.initialize();
  return manager;
}

export const SFRAME_CIPHER_SUITES: Record<string, unknown> = {};
export type SFrameCipherSuite = unknown;
export interface SFrameHeader {
  kid: number;
  ctr: bigint;
}
export interface KeyRatchetConfig {
  salt: Uint8Array;
  keyId: number;
}