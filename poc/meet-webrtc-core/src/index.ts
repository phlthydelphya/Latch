/**
 * meet-webrtc-core - Main Entry Point
 * M0-P0 WebRTC + SFrame E2EE POC
 */

export { WebRTCManager, type WebRTCManagerConfig } from './webrtc/manager.js';
export { SFrameTransform, WASMSFrameWorker, wasmWorkerCode } from './sframe/transform.js';
export { KeyManager, HPKE, type KeyManagerConfig, type EpochKeys } from './keys/manager.js';
export { SignalingClient, type SignalingConfig } from './signaling/client.js';
export { ScreenShareManager, SafariScreenSharePolyfill, type ScreenShareConfig, type ScreenShareState } from './screen/manager.js';
export { TURNManager, type TURNManagerConfig, type TURNState } from './turn/manager.js';
export { ReconnectManager, type ReconnectManagerConfig, type ReconnectState } from './reconnect/manager.js';
export { MetricsCollector, type MetricPoint, type HistogramMetric } from './metrics/collector.js';

export * from './types.js';

// ==================== FACTORY FUNCTION ====================

import { WebRTCManager } from './webrtc/manager.js';
import type { WebRTCManagerConfig } from './webrtc/manager.js';

export async function createWebRTCManager(config: WebRTCManagerConfig): Promise<WebRTCManager> {
  const manager = new WebRTCManager(config);
  await manager.initialize();
  return manager;
}

// ==================== DEFAULT CONFIG FOR P0 ====================

export const DEFAULT_P0_CONFIG: Partial<WebRTCManagerConfig> = {
  preferredCodecs: {
    video: ['VP9', 'H264'],
    audio: ['opus'],
  },
  simulcast: {
    enabled: true,
    layers: [
      { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 300000, maxFramerate: 15, active: true },   // 180p
      { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 800000, maxFramerate: 30, active: true },   // 360p
      { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 1800000, maxFramerate: 30, active: true },  // 720p
    ],
    svc: true, // VP9 SVC preferred
  },
  sframe: {
    enabled: true,
    useEncodedTransform: true,
    wasmFallback: true,
    wasmPath: '/wasm/sframe.js',
    cipherSuite: 'AES_GCM',
    keyRotationIntervalMs: 300000, // 5 minutes
  },
  lastN: 9,
  dynacast: {
    enabled: true,
    headerAware: true, // Attempt SFU header inspection (KID/CTR)
    blindForwardFallback: true, // Ship all 3 layers for ≤20p if header-aware fails
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
  return {
    ...DEFAULT_P0_CONFIG,
    ...overrides,
  } as WebRTCManagerConfig;
}