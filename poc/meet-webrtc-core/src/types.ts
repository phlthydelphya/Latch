/**
 * Type definitions for meet-webrtc-core
 */

export interface RTCConfiguration {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy?: 'require' | 'negotiate';
  sdpSemantics?: 'unified-plan' | 'plan-b';
  iceCandidatePoolSize?: number;
  certificates?: RTCCertificate[];
}

export interface MediaStreamConstraints {
  video?: boolean | MediaTrackConstraints;
  audio?: boolean | MediaTrackConstraints;
}

export interface MediaTrackConstraints {
  width?: number | ConstrainLongRange;
  height?: number | ConstrainLongRange;
  frameRate?: number | ConstrainLongRange;
  facingMode?: string | string[];
  deviceId?: string | string[];
}

export interface ConstrainLongRange {
  min?: number;
  max?: number;
  exact?: number;
  ideal?: number;
}

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

export interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RTCTrackEvent extends Event {
  readonly receiver: RTCRtpReceiver;
  readonly track: MediaStreamTrack;
  readonly streams: ReadonlyArray<MediaStream>;
  readonly transceiver: RTCRtpTransceiver;
}

export interface RTCPeerConnectionIceEvent extends Event {
  readonly candidate: RTCIceCandidate | null;
}

export interface RTCDataChannelEvent extends Event {
  readonly channel: RTCDataChannel;
}

export interface RTCStatsReport {
  forEach(callbackfn: (value: RTCStats, key: string, parent: RTCStatsReport) => void, thisArg?: any): void;
  get(key: string): RTCStats | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<RTCStats>;
  entries(): IterableIterator<[string, RTCStats]>;
  readonly size: number;
}

export interface RTCStats {
  readonly id: string;
  readonly timestamp: number;
  readonly type: RTCStatsType;
}

export type RTCStatsType = 
  | 'codec' 
  | 'inbound-rtp' 
  | 'outbound-rtp' 
  | 'remote-inbound-rtp' 
  | 'remote-outbound-rtp' 
  | 'media-source' 
  | 'media-playout' 
  | 'peer-connection' 
  | 'data-channel' 
  | 'transport' 
  | 'candidate-pair' 
  | 'local-candidate' 
  | 'remote-candidate' 
  | 'certificate';

export interface RTCInboundRtpStreamStats extends RTCStats {
  readonly ssrc: number;
  readonly kind: 'audio' | 'video';
  readonly trackIdentifier: string;
  readonly transportId: string;
  readonly codecId: string;
  readonly packetsReceived: number;
  readonly packetsLost: number;
  readonly jitter: number;
  readonly framesDecoded: number;
  readonly framesDropped: number;
  readonly framesPerSecond: number;
  readonly qpSum: number;
  readonly totalDecodeTime: number;
  readonly totalProcessingDelay: number;
}

export interface RTCOutboundRtpStreamStats extends RTCStats {
  readonly ssrc: number;
  readonly kind: 'audio' | 'video';
  readonly trackIdentifier: string;
  readonly transportId: string;
  readonly codecId: string;
  readonly packetsSent: number;
  readonly bytesSent: number;
  readonly targetBitrate: number;
  readonly totalEncodeTime: number;
  readonly framesEncoded: number;
  readonly nackCount: number;
  readonly firCount: number;
  readonly pliCount: number;
  readonly qualityLimitationReason: string | null;
  readonly qualityLimitationDurations: Record<string, number>;
}

export interface RTCRemoteInboundRtpStreamStats extends RTCStats {
  readonly ssrc: number;
  readonly kind: 'audio' | 'video';
  readonly trackIdentifier: string;
  readonly transportId: string;
  readonly codecId: string;
  readonly packetsReceived: number;
  readonly roundTripTime: number;
  readonly totalRoundTripTime: number;
  readonly fractionLost: number;
}

export interface RTCPeerConnectionStats extends RTCStats {
  readonly dataChannelsOpened: number;
  readonly dataChannelsClosed: number;
}

export interface RTCTransportStats extends RTCStats {
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly rtcpTransportStatsId: string | null;
  readonly iceRole: 'controlling' | 'controlled' | 'unknown';
  readonly dtlsState: 'new' | 'connecting' | 'connected' | 'closed' | 'failed';
  readonly selectedCandidatePairId: string | null;
  readonly localCertificateId: string | null;
  readonly remoteCertificateId: string | null;
  readonly tlsVersion: string | null;
  readonly dtlsCipher: string | null;
  readonly srtpCipher: string | null;
}

export interface RTCIceCandidatePairStats extends RTCStats {
  readonly transportId: string;
  readonly localCandidateId: string;
  readonly remoteCandidateId: string;
  readonly state: 'frozen' | 'waiting' | 'in-progress' | 'failed' | 'succeeded';
  readonly nominated: boolean;
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly totalRoundTripTime: number;
  readonly currentRoundTripTime: number;
  readonly availableOutgoingBitrate: number;
  readonly availableIncomingBitrate: number;
  readonly requestsReceived: number;
  readonly requestsSent: number;
  readonly responsesReceived: number;
  readonly responsesSent: number;
  readonly retransmissionsReceived: number;
  readonly retransmissionsSent: number;
  readonly consentRequestsSent: number;
  readonly consentExpiredTimestamp: number;
}

export interface RTCIceCandidateStats extends RTCStats {
  readonly transportId: string;
  readonly networkType: 'wifi' | 'ethernet' | 'cellular' | 'unknown' | 'vpn';
  readonly ip: string;
  readonly port: number;
  readonly protocol: 'udp' | 'tcp';
  readonly candidateType: 'host' | 'srflx' | 'prflx' | 'relay';
  readonly priority: number;
  readonly url: string | null;
  readonly relayProtocol: 'udp' | 'tcp' | 'tls' | null;
  readonly foundation: string;
  readonly relatedAddress: string | null;
  readonly relatedPort: number | null;
}

export interface SFrameHeader {
  KID: number;      // Key ID
  CTR: bigint;      // Counter
  // Optional extensions
  PT?: number;      // Payload Type (if extended)
}

export interface SFrameCipherSuite {
  id: number;
  name: string;
  keyLen: number;
  saltLen: number;
  tagLen: number;
}

export const SFRAME_CIPHER_SUITES: Record<string, SFrameCipherSuite> = {
  AES_GCM: { id: 0x0001, name: 'AES-GCM', keyLen: 16, saltLen: 12, tagLen: 16 },
  AES_CTR: { id: 0x0002, name: 'AES-CTR', keyLen: 16, saltLen: 12, tagLen: 0 },
};

export interface KeyRatchetConfig {
  epochSecret: CryptoKey;
  senderId: string;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
}

export interface KeyRotationMessage {
  type: 'commit' | 'welcome' | 'key-rotation' | 'key-rotation-ack' | 'sync-request' | 'sync-response';
  epoch: number;
  /** Per-recipient HPKE-encrypted commits: participantId -> ciphertext bytes (S-02, DataChannel only) */
  commits?: Record<string, number[]>;
  /** Single commit ciphertext for the addressed recipient via DataChannel */
  commit?: number[];
  welcome?: number[];
  senderId?: string;
  requestId?: string;
  keys?: Record<string, string>;
  /** HPKE public key broadcast during join (base64 raw 65 bytes) */
  hpkePublicKey?: string;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'hpke-pubkey' | 'leave' | 'mute' | 'speaking' | 'welcome' | 'session-update' | 'ping';
  payload: any;
  roomId: string;
  participantId: string;
  timestamp: number;
}

export interface TURNCredentials {
  username: string;
  credential: string;
  urls: string[];
  ttl: number;
}

export interface LoadTestConfig {
  participantCount: number;
  durationMs: number;
  simulcastLayers: number;
  targetBitrate: number;
  codec: 'VP9' | 'H264';
  sframeEnabled: boolean;
}

export interface BrowserTestResult {
  browser: string;
  version: string;
  platform: string;
  passed: boolean;
  tests: TestResult[];
  errors: string[];
  warnings: string[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: any;
}

export interface HistogramData {
  buckets: number[];
  counts: number[];
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p95: number;
  p99: number;
  sum: number;
  count: number;
}

export interface KeyRotationLatencyReport {
  trials: number;
  histogram: HistogramData;
  rawLatencies: number[];
  zeroizedKeys: number;
  passed: boolean;
}

export interface ReconnectLatencyReport {
  trials: number;
  histogram: HistogramData;
  rawLatencies: number[];
  epochPreserved: number;
  passed: boolean;
}

export interface TURNRelayReport {
  allocationLatencyMs: number;
  candidateType: 'relay' | 'srflx' | 'host' | 'prflx';
  protocol: 'udp' | 'tcp' | 'tls';
  mediaFlowConfirmed: boolean;
  e2eePreserved: boolean;
  passed: boolean;
}

export interface BrowserMatrixReport {
  browsers: BrowserTestResult[];
  overallPass: boolean;
  timestamp: string;
}

export interface LighthouseReport {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  pwa: number;
  metrics: {
    fcp: number;
    lcp: number;
    cls: number;
    tti: number;
    speedIndex: number;
    tbt: number;
  };
  passed: boolean;
}

// ==================== CORE MANAGER TYPES ====================
// These types are shared by the real manager modules (webrtc/, keys/,
// metrics/, screen/, reconnect/, turn/). The Web Crypto `CryptoKey` is a
// DOM global re-exported here so modules can import it uniformly.

export type CryptoKey = globalThis.CryptoKey;

export interface SimulcastLayer {
  rid: string;
  scaleResolutionDownBy: number;
  maxBitrate: number;
  maxFramerate: number;
  active: boolean;
}

export interface SimulcastConfig {
  enabled: boolean;
  layers: SimulcastLayer[];
  svc: boolean;
}

export interface SFrameConfig {
  enabled: boolean;
  useEncodedTransform: boolean;
  wasmFallback: boolean;
  wasmPath: string;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
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

export interface DisplayMediaStreamConstraints {
  video?: boolean | (MediaTrackConstraints & {
    displaySurface?: 'browser' | 'window' | 'screen' | 'monitor';
    cursor?: 'always' | 'motion' | 'never';
  });
  audio?: boolean | (MediaTrackConstraints & {
    suppressLocalAudioPlayback?: boolean;
  });
}