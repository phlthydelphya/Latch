// tests/m3a-speaker-smoothing.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SpeakerSmoothingEngine } from '../src/layout/speakerSmoothing';

describe('M3A: Speaker Smoothing & Hysteresis Engine', () => {
  let engine: SpeakerSmoothingEngine;
  let baseTime = 100000;

  beforeEach(() => {
    engine = new SpeakerSmoothingEngine({
      windowMs: 300,
      qualificationThresholdMs: 600,
      hysteresisHoldMs: 1500,
      energyThreshold: 0.2,
    });
    baseTime = 100000;
  });

  it('smooths raw audio energy over rolling window (300 ms)', () => {
    // Feed two samples within 100 ms
    engine.updateEnergy('alice', 0.8, baseTime);
    engine.updateEnergy('alice', 0.2, baseTime + 100);

    // After 400 ms, first sample expires (> 300 ms window)
    engine.updateEnergy('alice', 0.4, baseTime + 400);

    // Smoothing should discard 0.8 and only average recent samples
    expect(engine.getActiveSpeakerId()).toBeNull(); // not yet qualified for 600 ms
  });

  it('rejects short transient speech bursts (< 600 ms) from triggering stage swap', () => {
    // Alice coughs or says 'uh-huh' for 400 ms
    for (let t = 0; t <= 400; t += 100) {
      engine.updateEnergy('alice', 0.85, baseTime + t);
    }

    // Attempt to elect active speaker
    const speaker = engine.resolveActiveSpeaker(baseTime + 400);
    expect(speaker).toBeNull(); // Fails 600 ms qualification threshold
  });

  it('promotes speaker when speech is sustained for >= 600 ms', () => {
    // Alice speaks continuously from t=0 to t=700 ms
    for (let t = 0; t <= 700; t += 100) {
      engine.updateEnergy('alice', 0.85, baseTime + t);
    }

    const speaker = engine.resolveActiveSpeaker(baseTime + 700);
    expect(speaker).toBe('alice');
    expect(engine.getActiveSpeakerId()).toBe('alice');
  });

  it('enforces 1500 ms hysteresis hold when speaker pauses or stops talking', () => {
    // 1. Alice speaks for 700 ms and is elected
    for (let t = 0; t <= 700; t += 100) {
      engine.updateEnergy('alice', 0.85, baseTime + t);
    }
    expect(engine.resolveActiveSpeaker(baseTime + 700)).toBe('alice');

    // 2. Alice goes silent for 1000 ms (t=1700 ms, < 1500 ms hysteresis hold)
    engine.updateEnergy('alice', 0.0, baseTime + 1700);
    const retainedSpeaker = engine.resolveActiveSpeaker(baseTime + 1700);
    expect(retainedSpeaker).toBe('alice'); // Hysteresis holds stage!

    // 3. Bob makes a brief noise (300 ms) at t=1800 ms
    for (let t = 1800; t <= 2000; t += 100) {
      engine.updateEnergy('bob', 0.9, baseTime + t);
    }
    // Bob is unqualified (<600 ms) and Alice is still in hysteresis hold
    expect(engine.resolveActiveSpeaker(baseTime + 2000)).toBe('alice');

    // 4. Bob speaks continuously for 700 ms (t=2000 to t=2700 ms)
    // Alice's last speech was at t=700 ms; at t=2700 ms, 2000 ms of silence has passed (> 1500 ms hold)
    for (let t = 2000; t <= 2700; t += 100) {
      engine.updateEnergy('bob', 0.9, baseTime + t);
    }
    const newSpeaker = engine.resolveActiveSpeaker(baseTime + 2700);
    expect(newSpeaker).toBe('bob'); // Bob now legitimately takes stage!
  });

  it('calculates deterministic confidence scores based on energy and duration', () => {
    for (let t = 0; t <= 800; t += 100) {
      engine.updateEnergy('alice', 0.9, baseTime + t);
    }
    const confidence = engine.getConfidence('alice', baseTime + 800);
    expect(confidence).toBeGreaterThan(0.5);
    expect(confidence).toBeLessThanOrEqual(1.0);
  });
});
