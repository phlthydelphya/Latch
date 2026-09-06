// tests/m3b-bandwidth-engine.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BandwidthEngine } from '../src/webrtc/bandwidthEngine';
import { useLayoutStore } from '../src/layout/layoutStore';

describe('M3B: Bandwidth Adaptation & Congestion Engine', () => {
  let engine: BandwidthEngine;

  beforeEach(() => {
    useLayoutStore.getState().reset();
    engine = new BandwidthEngine({
      intervalMs: 1000,
      hysteresisRequiredCleanSamples: 3,
      targetBitrateBytesPerSec: 250_000,
    });
  });

  afterEach(() => {
    engine.detach();
  });

  it('initializes in optimal bandwidth tier with Effective N = 9', () => {
    expect(engine.getCurrentTier()).toBe('optimal');
    expect(engine.getEffectiveVideoN()).toBe(9);
    expect(useLayoutStore.getState().bandwidthTier).toBe('optimal');
  });

  it('DC-4: calculates deterministic composite congestion score', () => {
    // 1. Clean link: 0% loss, 40ms RTT, 2ms jitter, 250kbps bitrate -> score 0
    const cleanScore = BandwidthEngine.calculateCongestionScore({
      packetLossPct: 0,
      rttMs: 40,
      jitterMs: 2,
      bytesReceivedPerSec: 250_000,
    });
    expect(cleanScore).toBeLessThanOrEqual(5);

    // 2. Severe loss (18% loss) -> high congestion score (>=70)
    const lossScore = BandwidthEngine.calculateCongestionScore({
      packetLossPct: 18,
      rttMs: 120,
      jitterMs: 5,
      bytesReceivedPerSec: 200_000,
    });
    expect(lossScore).toBeGreaterThanOrEqual(40);

    // 3. High latency + jitter + loss -> emergency score (>=86)
    const severeScore = BandwidthEngine.calculateCongestionScore({
      packetLossPct: 22,
      rttMs: 450,
      jitterMs: 80,
      bytesReceivedPerSec: 20_000,
    });
    expect(severeScore).toBeGreaterThanOrEqual(86);
  });

  it('DC-2: reports authoritative effective Video N across all tiers', () => {
    expect(engine.getEffectiveVideoN('optimal')).toBe(9);
    expect(engine.getEffectiveVideoN('congested-mild')).toBe(9);
    expect(engine.getEffectiveVideoN('congested-moderate')).toBe(6);
    expect(engine.getEffectiveVideoN('congested-severe')).toBe(4);
    expect(engine.getEffectiveVideoN('emergency-audio-only')).toBe(0);
  });

  it('transitions tiers based on direct score injection (DC-4)', () => {
    // Score 25 -> congested-mild
    engine.injectCongestionScoreForTesting(25);
    expect(engine.getCurrentTier()).toBe('congested-mild');
    expect(engine.getEffectiveVideoN()).toBe(9);

    // Score 50 -> congested-moderate
    engine.injectCongestionScoreForTesting(50);
    expect(engine.getCurrentTier()).toBe('congested-moderate');
    expect(engine.getEffectiveVideoN()).toBe(6);

    // Score 75 -> congested-severe
    engine.injectCongestionScoreForTesting(75);
    expect(engine.getCurrentTier()).toBe('congested-severe');
    expect(engine.getEffectiveVideoN()).toBe(4);

    // Score 92 -> emergency-audio-only
    engine.injectCongestionScoreForTesting(92);
    expect(engine.getCurrentTier()).toBe('emergency-audio-only');
    expect(engine.getEffectiveVideoN()).toBe(0);
  });

  it('M3B-7: Audio-Only Congestion Recovery respects 3-cycle hysteresis hold', () => {
    // 1. Enter emergency audio only
    engine.injectCongestionScoreForTesting(95);
    expect(engine.getCurrentTier()).toBe('emergency-audio-only');
    expect(engine.getEffectiveVideoN()).toBe(0);

    // 2. Clean sample 1 -> still emergency
    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('emergency-audio-only');

    // 3. Clean sample 2 -> still emergency
    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('emergency-audio-only');

    // 4. Clean sample 3 -> satisfies hysteresis, promotes to optimal!
    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('optimal');
    expect(engine.getEffectiveVideoN()).toBe(9);
  });

  it('resets hysteresis counter if congestion spikes during recovery', () => {
    engine.injectCongestionScoreForTesting(50);
    expect(engine.getCurrentTier()).toBe('congested-moderate');

    // Clean sample 1 & 2
    engine.injectCongestionScoreForTesting(5);
    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('congested-moderate');

    // Spike!
    engine.injectCongestionScoreForTesting(55);
    expect(engine.getCurrentTier()).toBe('congested-moderate');

    // Needs another 3 clean samples from scratch
    engine.injectCongestionScoreForTesting(5);
    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('congested-moderate');

    engine.injectCongestionScoreForTesting(5);
    expect(engine.getCurrentTier()).toBe('optimal');
  });

  it('M3B-8: Endurance & Rapid Oscillation Simulation (100 cycles)', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      const simulatedLoss = (cycle % 10) * 2.5;
      const simulatedRtt = 40 + (cycle % 8) * 40;
      const simulatedJitter = 2 + (cycle % 5) * 5;

      const score = BandwidthEngine.calculateCongestionScore({
        packetLossPct: simulatedLoss,
        rttMs: simulatedRtt,
        jitterMs: simulatedJitter,
        bytesReceivedPerSec: 180_000,
      });

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isNaN(score)).toBe(false);

      engine.injectCongestionScoreForTesting(score);
      const metrics = engine.getMetrics();
      expect(metrics.congestionScore).toBe(score);
      expect(metrics.effectiveVideoN).toBeGreaterThanOrEqual(0);
      expect(metrics.effectiveVideoN).toBeLessThanOrEqual(9);
    }
  });
});
