/**
 * Test Vectors for M0-P0 Validation
 * Used by @qa for browser matrix, load testing, and criterion verification
 */

import type { 
  BrowserTestResult, 
  KeyRotationLatencyReport, 
  ReconnectLatencyReport, 
  TURNRelayReport,
  BrowserMatrixReport,
  LighthouseReport,
  HistogramData 
} from '../src/types.js';

// ==================== BROWSER MATRIX TEST VECTORS ====================

export const BROWSER_TEST_MATRIX: Array<{
  browser: string;
  version: string;
  platform: string;
  userAgent: string;
  capabilities: {
    getDisplayMedia: boolean;
    insertableStreams: boolean;
    encodedTransform: boolean;
    offscreenCanvas: boolean;
    videoFrame: boolean;
    vp9: boolean;
    h264: boolean;
    av1: boolean;
    webgpu: boolean;
  };
  expectedResults: {
    join: boolean;
    publish: boolean;
    subscribe: boolean;
    mute: boolean;
    leave: boolean;
    iceRestart: boolean;
    screenShare: boolean;
    sframeEncrypt: boolean;
    sframeDecrypt: boolean;
    keyRotation: boolean;
    reconnect: boolean;
    turnRelay: boolean;
  };
}> = [
  {
    browser: 'Chrome',
    version: '127+',
    platform: 'Windows/macOS/Linux',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    capabilities: {
      getDisplayMedia: true,
      insertableStreams: true,
      encodedTransform: true,
      offscreenCanvas: true,
      videoFrame: true,
      vp9: true,
      h264: true,
      av1: true,
      webgpu: true,
    },
    expectedResults: {
      join: true,
      publish: true,
      subscribe: true,
      mute: true,
      leave: true,
      iceRestart: true,
      screenShare: true,
      sframeEncrypt: true,
      sframeDecrypt: true,
      keyRotation: true,
      reconnect: true,
      turnRelay: true,
    },
  },
  {
    browser: 'Edge',
    version: '127+',
    platform: 'Windows/macOS/Linux',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
    capabilities: {
      getDisplayMedia: true,
      insertableStreams: true,
      encodedTransform: true,
      offscreenCanvas: true,
      videoFrame: true,
      vp9: true,
      h264: true,
      av1: true,
      webgpu: true,
    },
    expectedResults: {
      join: true,
      publish: true,
      subscribe: true,
      mute: true,
      leave: true,
      iceRestart: true,
      screenShare: true,
      sframeEncrypt: true,
      sframeDecrypt: true,
      keyRotation: true,
      reconnect: true,
      turnRelay: true,
    },
  },
  {
    browser: 'Firefox',
    version: '128+',
    platform: 'Windows/macOS/Linux',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    capabilities: {
      getDisplayMedia: true,
      insertableStreams: true,
      encodedTransform: true,
      offscreenCanvas: true,
      videoFrame: true,
      vp9: true,
      h264: true,
      av1: true,
      webgpu: true,
    },
    expectedResults: {
      join: true,
      publish: true,
      subscribe: true,
      mute: true,
      leave: true,
      iceRestart: true,
      screenShare: true,
      sframeEncrypt: true,
      sframeDecrypt: true,
      keyRotation: true,
      reconnect: true,
      turnRelay: true,
    },
  },
  {
    browser: 'Safari',
    version: '17.4+',
    platform: 'macOS',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    capabilities: {
      getDisplayMedia: true,
      insertableStreams: false, // Safari 17.4+ has partial support
      encodedTransform: true, // Safari 17.4+ supports Encoded Transform
      offscreenCanvas: true,
      videoFrame: true,
      vp9: false, // Safari uses H264
      h264: true,
      av1: false,
      webgpu: false,
    },
    expectedResults: {
      join: true,
      publish: true,
      subscribe: true,
      mute: true,
      leave: true,
      iceRestart: true,
      screenShare: true, // Via getDisplayMedia
      sframeEncrypt: true, // Via Encoded Transform
      sframeDecrypt: true,
      keyRotation: true,
      reconnect: true,
      turnRelay: true,
    },
  },
  {
    browser: 'Safari',
    version: '17.4+ (iOS PWA)',
    platform: 'iOS 17.4+',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    capabilities: {
      getDisplayMedia: true, // Limited on iOS
      insertableStreams: false,
      encodedTransform: true,
      offscreenCanvas: true,
      videoFrame: true,
      vp9: false,
      h264: true,
      av1: false,
      webgpu: false,
    },
    expectedResults: {
      join: true,
      publish: true,
      subscribe: true,
      mute: true,
      leave: true,
      iceRestart: true,
      screenShare: true, // iOS screen share via getDisplayMedia (limited)
      sframeEncrypt: true,
      sframeDecrypt: true,
      keyRotation: true,
      reconnect: true,
      turnRelay: true,
    },
  },
];

// ==================== KEY ROTATION TEST VECTORS ====================

export const KEY_ROTATION_TEST_VECTORS = {
  // 20 trials under 20p load
  trials: 20,
  participantCount: 20,
  loadDurationMs: 600000, // 10 minutes
  
  // Histogram buckets (ms)
  histogramBuckets: [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000],
  
  // Pass thresholds
  thresholds: {
    p50: 300,  // p50 ≤ 300ms
    p95: 500,  // p95 ≤ 500ms
    p99: 1000,
  },
  
  // Test scenarios
  scenarios: [
    { name: 'join-trigger', description: 'New participant joins, Commit broadcast via DataChannel' },
    { name: 'leave-trigger', description: 'Participant leaves, Commit broadcast via DataChannel' },
    { name: 'periodic', description: 'Periodic rotation at 5min interval' },
    { name: 'reconnect-replay', description: 'Reconnect with buffered Commit replay' },
  ],
  
  // Expected histogram for passing test
  expectedPassingHistogram: {
    buckets: [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000],
    counts: [2, 3, 4, 3, 2, 2, 2, 1, 0, 0, 0, 1], // p95 ≈ 400ms
    min: 45,
    max: 1200,
    mean: 280,
    median: 180,
    p50: 180,
    p95: 400,
    p99: 1000,
    sum: 5600,
    count: 20,
  } as HistogramData,
};

// ==================== RECONNECT TEST VECTORS ====================

export const RECONNECT_TEST_VECTORS = {
  trials: 10,
  participantCount: 20,
  
  // Disconnect simulation: kill WSS for 3s
  disconnectDurationMs: 3000,
  
  // Histogram buckets (ms)
  histogramBuckets: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000],
  
  // Pass thresholds
  thresholds: {
    p50: 2000,
    p95: 5000,
    p99: 8000,
  },
  
  // Test scenarios per browser
  scenarios: [
    { name: 'wss-kill-3s', description: 'WSS killed for 3s, then ICE restart' },
    { name: 'tcp-drop-3s', description: 'tc drop 100% TCP for 3s' },
    { name: 'wifi-handoff', description: 'Simulated WiFi to cellular handoff' },
    { name: 'sfu-restart', description: 'SFU container restart, client ICE restart' },
  ],
  
  // Expected passing histogram
  expectedPassingHistogram: {
    buckets: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000],
    counts: [1, 2, 2, 2, 1, 1, 1, 0, 0, 0], // p95 ≈ 3500ms
    min: 800,
    max: 4200,
    mean: 2100,
    median: 1800,
    p50: 1800,
    p95: 3500,
    p99: 4200,
    sum: 21000,
    count: 10,
  } as HistogramData,
};

// ==================== TURN RELAY TEST VECTORS ====================

export const TURN_TEST_VECTORS = {
  // Fallback chain test order
  fallbackChain: [
    { name: 'STUN', urls: ['stun:stun.l.google.com:19302'], expectedType: 'srflx' as RTCIceCandidateType },
    { name: 'TURN UDP', urls: ['turn:turn.example.com:3478?transport=udp'], expectedType: 'relay' as RTCIceCandidateType },
    { name: 'TURN TCP 443', urls: ['turn:turn.example.com:443?transport=tcp'], expectedType: 'relay' as RTCIceCandidateType },
    { name: 'TURNS TLS 443', urls: ['turns:turn.example.com:443'], expectedType: 'relay' as RTCIceCandidateType },
  ],
  
  // Strict NAT simulation
  strictNAT: {
    blockUDP3478: true,
    blockUDPRange: '1024-65535',
    expectedPath: 'TURN TCP 443 → TURNS TLS 443',
    maxAllocationLatencyMs: 2000,
  },
  
  // HMAC credentials
  hmacConfig: {
    algorithm: 'HMAC-SHA256',
    ttlHours: 24,
    usernameFormat: '<expiry>:<userHash>',
    sharedSecretRotation: 'daily',
  },
  
  // Verification
  verification: {
    candidateTypeCheck: 'relay',
    mediaFlowCheck: true,
    e2eePreservedCheck: true, // SFrame ciphertext on wire
    prometheusMetrics: ['turn_allocations_active', 'turn_relayed_bytes', 'turn_allocation_failures'],
  },
  
  // Expected results
  expectedResults: {
    allocationLatencyMs: 1500,
    candidateType: 'relay',
    protocol: 'tcp',
    mediaFlowConfirmed: true,
    e2eePreserved: true,
  },
};

// ==================== LOAD TEST VECTORS (20p) ====================

export const LOAD_TEST_VECTORS = {
  participantCount: 20,
  durationMinutes: 10,
  
  // Media configuration per participant
  media: {
    video: {
      codec: 'VP9',
      svc: true,
      simulcastLayers: 3,
      temporalLayers: 2,
      resolutions: ['180p', '360p', '720p'],
      bitrates: [300000, 800000, 1800000], // bps
      framerates: [15, 30, 30],
    },
    audio: {
      codec: 'opus',
      bitrate: 32000,
      channels: 1,
      sampleRate: 48000,
    },
  },
  
  // SFU configuration
  sfu: {
    lastN: 9,
    dynacastEnabled: true,
    headerAware: true, // Attempt
    blindForwardFallback: true, // Ship all 3 layers
    maxDownlinkLayers: 9 * 3, // 9 participants × 3 layers
  },
  
  // Pass thresholds
  thresholds: {
    roomStabilityMinutes: 10,
    maxParticipantDrop: 0, // No drops >5s
    maxCpuPercent: 70, // On 1 vCPU (or 2 vCPU documented)
    maxPacketLossPercent: 1,
    p50LatencyMs: 150,
    p95LatencyMs: 300,
    maxMemoryMB: 2048,
  },
  
  // Expected metrics
  expectedMetrics: {
    activeParticipants: 20,
    distinctParticipantIds: 20,
    cpuPercent: 65,
    memoryMB: 620,
    packetLossPercent: 0.5,
    p50LatencyMs: 120,
    p95LatencyMs: 250,
    downlinkMbpsPerViewer: 8, // With blind-forward Last-N=9
  },
};

// ==================== SFRAME CIPHERTEXT VERIFICATION ====================

export const SFRAME_VERIFICATION_VECTORS = {
  // Wireshark capture validation
  wireshark: {
    filter: 'rtp && sframe',
    expectedFields: {
      version: 0,
      flags: 0,
      keyId: 'varint',
      counter: 'varint',
      ciphertext: 'present',
      authTag: 'present (16 bytes for AES-GCM)',
    },
    forbiddenFields: {
      plaintextPayload: true,
      clearKey: true,
      sdpInClear: false, // SDP is encrypted via WSS
    },
  },
  
  // Test vectors for interop
  testVectors: [
    {
      name: 'AES-GCM 128-bit key',
      cipherSuite: 0x0001,
      key: new Uint8Array(16).fill(0x42),
      salt: new Uint8Array(12).fill(0x24),
      kid: 1,
      ctr: 0n,
      plaintext: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
      expectedCiphertext: null, // Computed at runtime
    },
    {
      name: 'AES-CTR 128-bit key',
      cipherSuite: 0x0002,
      key: new Uint8Array(16).fill(0x42),
      salt: new Uint8Array(12).fill(0x24),
      kid: 2,
      ctr: 1n,
      plaintext: new Uint8Array([0x10, 0x11, 0x12, 0x13, 0x14, 0x15]),
      expectedCiphertext: null,
    },
  ],
  
  // Key derivation test vectors
  keyDerivation: {
    epochSecret: new Uint8Array(32).fill(0xAA),
    senderId: 'participant-123',
    expectedSenderKey: null, // HKDF(epochSecret, "sframe", senderId)
    algorithm: 'HKDF-SHA256',
    info: 'sframeparticipant-123',
  },
};

// ==================== LIGHTHOUSE TEST VECTORS ====================

export const LIGHTHOUSE_TEST_VECTORS = {
  urls: [
    '/join/test-room-id',
    '/join/test-room-id?in-meeting=true',
  ],
  
  throttling: {
    cpu: 4, // 4× slowdown
    network: 'Slow 4G',
  },
  
  budgets: {
    bundleGzippedKB: 120, // Without WASM
    wasmKB: 150, // Async loaded
    totalBlockingTimeMs: 200,
    cls: 0,
  },
  
  thresholds: {
    performance: 95,
    accessibility: 95,
    bestPractices: 95,
    seo: 90,
    pwa: 90,
  },
  
  metrics: {
    fcp: 1800, // ms
    lcp: 2500,
    cls: 0,
    tti: 3500,
    speedIndex: 3000,
    tbt: 150,
  },
};

// ==================== PRIVACY SCAN VECTORS ====================

export const PRIVACY_SCAN_VECTORS = {
  forbiddenPatterns: [
    'analytics',
    'tracking',
    'ga(',
    'gtag(',
    'mixpanel',
    'segment',
    'amplitude',
    'sentry', // Unless PII scrub configured
    'fingerprint',
    'canvas.toDataURL',
    'navigator.userAgent',
    'localStorage.setItem',
    'document.cookie',
  ],
  
  requiredHeaders: {
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; worker-src 'self' blob:;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), display-capture=(), geolocation=()',
  },
  
  cookieRequirements: {
    allowed: ['__Host-session', '__Host-csrf'],
    requiredFlags: ['Secure', 'HttpOnly', 'SameSite=Strict'],
    maxAge: 300, // 5 min for JWT
  },
  
  dataRetention: {
    redisTtlHours: 24,
    pgTtlHours: 24,
    minioTtlDays: 30,
    logRetentionHours: 24,
    ipHashSaltRotation: 'daily',
  },
};

// ==================== EXPORT ALL ====================

export const ALL_TEST_VECTORS = {
  browserMatrix: BROWSER_TEST_MATRIX,
  keyRotation: KEY_ROTATION_TEST_VECTORS,
  reconnect: RECONNECT_TEST_VECTORS,
  turn: TURN_TEST_VECTORS,
  load: LOAD_TEST_VECTORS,
  sframeVerification: SFRAME_VERIFICATION_VECTORS,
  lighthouse: LIGHTHOUSE_TEST_VECTORS,
  privacy: PRIVACY_SCAN_VECTORS,
};