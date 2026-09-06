/**
 * Bandwidth Adaptation & Congestion Engine (M3B Multi-Stream Architecture)
 *
 * Ephemeral Runtime Diagnostics & Downlink Adaptation Engine.
 * Evaluates composite network conditions (packet loss, RTT, jitter, incoming bitrate)
 * via WebRTC getStats() to compute a deterministic CongestionScore in [0, 100].
 *
 * Enforces dynamic Effective Video N (DC-2):
 * - Tier 0: Optimal (score 0-15): Effective N = 9 (1 High + 8 Low/Med)
 * - Tier 1: Congested-Mild (score 16-35): Effective N = 9 (1 High + 8 Low)
 * - Tier 2: Congested-Moderate (score 36-65): Effective N = 6 (1 Med + 5 Low)
 * - Tier 3: Congested-Severe (score 66-85): Effective N = 4 (1 Low + 3 Low)
 * - Tier 4: Emergency-Audio-Only (score 86-100): Effective N = 0 (100% video paused, audio prioritized)
 *
 * Invariants (DC-6):
 * - 100% ephemeral in-memory diagnostics; zero disk, cookie, or remote storage.
 * - Destroyed on meeting exit/detach.
 */

import { Room } from 'livekit-client';
import { BandwidthTier } from '../layout/types';
import { useLayoutStore } from '../layout/layoutStore';

export interface BandwidthMetrics {
  packetLossPct: number;
  rttMs: number;
  jitterMs: number;
  bytesReceivedPerSec: number;
  congestionScore: number;
  effectiveVideoN: number;
  currentTier: BandwidthTier;
  consecutiveCleanSamples: number;
}

export interface BandwidthEngineConfig {
  intervalMs: number;
  hysteresisRequiredCleanSamples: number;
  targetBitrateBytesPerSec: number;
}

export const DEFAULT_BANDWIDTH_CONFIG: BandwidthEngineConfig = {
  intervalMs: 2000,
  hysteresisRequiredCleanSamples: 3,
  targetBitrateBytesPerSec: 250_000, // 2 Mbps baseline
};

export class BandwidthEngine {
  private config: BandwidthEngineConfig;
  private room: Room | null = null;
  private timer: any = null;
  private currentTier: BandwidthTier = 'optimal';
  private consecutiveCleanSamples = 0;
  private lastPacketsReceived = 0;
  private lastPacketsLost = 0;
  private lastBytesReceived = 0;
  private lastTimestamp = 0;
  private lastMetrics: BandwidthMetrics = {
    packetLossPct: 0,
    rttMs: 40,
    jitterMs: 3,
    bytesReceivedPerSec: 0,
    congestionScore: 0,
    effectiveVideoN: 9,
    currentTier: 'optimal',
    consecutiveCleanSamples: 0,
  };

  constructor(config: Partial<BandwidthEngineConfig> = {}) {
    this.config = { ...DEFAULT_BANDWIDTH_CONFIG, ...config };
  }

  attach(room: Room): void {
    this.detach();
    this.room = room;
    this.currentTier = useLayoutStore.getState().bandwidthTier;
    this.consecutiveCleanSamples = 0;
    this.lastTimestamp = Date.now();

    this.timer = setInterval(() => {
      this.evaluateNetworkConditions();
    }, this.config.intervalMs);
  }

  /**
   * Authoritative getter for Effective Video N (DC-2).
   */
  public getEffectiveVideoN(tier?: BandwidthTier): number {
    const t = tier ?? this.currentTier;
    switch (t) {
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
   * Deterministic Composite Congestion Score calculation (DC-4).
   * CongestionScore in [0, 100] derived from weighted loss, RTT, jitter, and bitrate deficit.
   */
  public static calculateCongestionScore(params: {
    packetLossPct: number;
    rttMs: number;
    jitterMs: number;
    bytesReceivedPerSec: number;
    targetBitrate?: number;
  }): number {
    const lossPct = Math.max(0, Math.min(100, params.packetLossPct));
    const rtt = Math.max(0, params.rttMs);
    const jitter = Math.max(0, params.jitterMs);
    const targetBps = params.targetBitrate ?? 250_000;
    const bitrateRatio = Math.min(1.0, params.bytesReceivedPerSec / targetBps);

    // Component 1: Packet Loss (Weight 0.45, 0-20% maps to 0-100)
    const sLoss = Math.min(100, lossPct * 5);

    // Component 2: RTT (Weight 0.25, 80ms-400ms maps to 0-100)
    const sRtt = Math.min(100, Math.max(0, (rtt - 80) * 0.3125));

    // Component 3: Jitter (Weight 0.15, 20ms-80ms maps to 0-100)
    const sJitter = Math.min(100, Math.max(0, (jitter - 20) * 1.67));

    // Component 4: Bitrate Deficit (Weight 0.15, 100% target -> 0, 0% target -> 100)
    const sBitrate = Math.min(100, Math.max(0, (1 - bitrateRatio) * 100));

    const composite = 0.45 * sLoss + 0.25 * sRtt + 0.15 * sJitter + 0.15 * sBitrate;
    return Math.min(100, Math.max(0, Math.round(composite)));
  }

  /**
   * Evaluates network stats and applies bandwidth adaptation tier transitions.
   */
  public async evaluateNetworkConditions(): Promise<void> {
    const stats = await this.collectWebRTCStats();
    const now = Date.now();
    const deltaSeconds = Math.max(0.5, (now - this.lastTimestamp) / 1000);

    const deltaReceived = Math.max(0, stats.packetsReceived - this.lastPacketsReceived);
    const deltaLost = Math.max(0, stats.packetsLost - this.lastPacketsLost);
    const deltaBytes = Math.max(0, stats.bytesReceived - this.lastBytesReceived);

    this.lastPacketsReceived = stats.packetsReceived;
    this.lastPacketsLost = stats.packetsLost;
    this.lastBytesReceived = stats.bytesReceived;
    this.lastTimestamp = now;

    const totalPackets = deltaReceived + deltaLost;
    const packetLossPct = totalPackets > 0 ? (deltaLost / totalPackets) * 100.0 : 0;
    const bytesReceivedPerSec = deltaBytes / deltaSeconds;

    const score = BandwidthEngine.calculateCongestionScore({
      packetLossPct,
      rttMs: stats.rttMs,
      jitterMs: stats.jitterMs,
      bytesReceivedPerSec,
      targetBitrate: this.config.targetBitrateBytesPerSec,
    });

    this.applyCandidateScore(score, {
      packetLossPct,
      rttMs: stats.rttMs,
      jitterMs: stats.jitterMs,
      bytesReceivedPerSec,
    });
  }

  private mapScoreToTier(score: number): BandwidthTier {
    if (score >= 86) return 'emergency-audio-only';
    if (score >= 66) return 'congested-severe';
    if (score >= 36) return 'congested-moderate';
    if (score >= 16) return 'congested-mild';
    return 'optimal';
  }

  private applyCandidateScore(
    score: number,
    stats: {
      packetLossPct: number;
      rttMs: number;
      jitterMs: number;
      bytesReceivedPerSec: number;
    }
  ): void {
    const candidateTier = this.mapScoreToTier(score);

    const tierSeverity: Record<BandwidthTier, number> = {
      'optimal': 0,
      'congested-mild': 1,
      'congested-moderate': 2,
      'congested-severe': 3,
      'emergency-audio-only': 4,
    };

    const currentSev = tierSeverity[this.currentTier];
    const candidateSev = tierSeverity[candidateTier];

    let nextTier = this.currentTier;

    if (candidateSev > currentSev) {
      // Immediate downgrade
      nextTier = candidateTier;
      this.consecutiveCleanSamples = 0;
    } else if (candidateSev < currentSev) {
      // Hysteresis required for upgrade (>= 3 consecutive clean cycles)
      this.consecutiveCleanSamples++;
      if (this.consecutiveCleanSamples >= this.config.hysteresisRequiredCleanSamples) {
        nextTier = candidateTier;
        this.consecutiveCleanSamples = 0;
      }
    } else {
      this.consecutiveCleanSamples = 0;
    }

    this.currentTier = nextTier;
    this.lastMetrics = {
      packetLossPct: Math.round(stats.packetLossPct * 10) / 10,
      rttMs: Math.round(stats.rttMs * 10) / 10,
      jitterMs: Math.round(stats.jitterMs * 10) / 10,
      bytesReceivedPerSec: Math.round(stats.bytesReceivedPerSec),
      congestionScore: score,
      effectiveVideoN: this.getEffectiveVideoN(this.currentTier),
      currentTier: this.currentTier,
      consecutiveCleanSamples: this.consecutiveCleanSamples,
    };

    if (useLayoutStore.getState().bandwidthTier !== this.currentTier) {
      useLayoutStore.getState().setBandwidthTier(this.currentTier);
    }
  }

  /**
   * Collects aggregated raw WebRTC stats across active receivers and candidate pairs.
   */
  public async collectWebRTCStats(): Promise<{
    packetsReceived: number;
    packetsLost: number;
    bytesReceived: number;
    rttMs: number;
    jitterMs: number;
  }> {
    let packetsReceived = 0;
    let packetsLost = 0;
    let bytesReceived = 0;
    let rttMs = 45;
    let jitterMs = 3;

    if (!this.room) {
      return { packetsReceived, packetsLost, bytesReceived, rttMs, jitterMs };
    }

    try {
      const remotes = this.room.remoteParticipants;
      if (remotes) {
        for (const remote of remotes.values()) {
          if (!remote.trackPublications) continue;
          for (const pub of remote.trackPublications.values()) {
            const receiver = (pub.track as any)?.receiver;
            if (receiver && typeof receiver.getStats === 'function') {
              try {
                const report = await receiver.getStats();
                if (report) {
                  report.forEach((stat: any) => {
                    if (stat.type === 'inbound-rtp') {
                      packetsReceived += stat.packetsReceived || 0;
                      packetsLost += stat.packetsLost || 0;
                      bytesReceived += stat.bytesReceived || 0;
                      if (stat.jitter) {
                        jitterMs = stat.jitter * 1000;
                      }
                    }
                    if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
                      if (stat.currentRoundTripTime) {
                        rttMs = stat.currentRoundTripTime * 1000;
                      }
                    }
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.warn('[BandwidthEngine] Failed to read WebRTC stats:', err);
    }

    return { packetsReceived, packetsLost, bytesReceived, rttMs, jitterMs };
  }

  /**
   * Direct score injection for testing and simulations (DC-4).
   */
  public injectCongestionScoreForTesting(score: number): void {
    this.applyCandidateScore(score, {
      packetLossPct: score > 50 ? score * 0.2 : 0,
      rttMs: score > 50 ? 200 : 45,
      jitterMs: 3,
      bytesReceivedPerSec: 150_000,
    });
  }

  /**
   * Manual override / synthetic injection for testing and simulations.
   */
  public injectMetricsForTesting(metrics: {
    packetLossPct: number;
    rttMs?: number;
    jitterMs?: number;
    bytesReceivedPerSec?: number;
  }): void {
    const rtt = metrics.rttMs ?? 45;
    const jitter = metrics.jitterMs ?? 3;
    const bytes = metrics.bytesReceivedPerSec ?? 150_000;

    const score = BandwidthEngine.calculateCongestionScore({
      packetLossPct: metrics.packetLossPct,
      rttMs: rtt,
      jitterMs: jitter,
      bytesReceivedPerSec: bytes,
      targetBitrate: this.config.targetBitrateBytesPerSec,
    });

    this.applyCandidateScore(score, {
      packetLossPct: metrics.packetLossPct,
      rttMs: rtt,
      jitterMs: jitter,
      bytesReceivedPerSec: bytes,
    });
  }

  public getMetrics(): BandwidthMetrics {
    return { ...this.lastMetrics };
  }

  public getCurrentTier(): BandwidthTier {
    return this.currentTier;
  }

  detach(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.room = null;
    this.consecutiveCleanSamples = 0;
  }
}
