/**
 * Speaker Smoothing & Hysteresis Engine (M3A Phase 3)
 *
 * Prevents rapid stage thrashing and jitter caused by coughs, short interjections,
 * or momentary background noises.
 *
 * Rules:
 * 1. Rolling window smoothing: 300 ms audio energy averaging.
 * 2. Qualification threshold: newly detected speaker must sustain continuous speech >= 600 ms.
 * 3. Hysteresis hold: once promoted to stage, speaker retains stage for >= 1500 ms of silence.
 * 4. Confidence scoring: deterministically ranks concurrent speakers.
 */

export interface SpeakerSmoothingConfig {
  windowMs: number;              // 300 ms default
  qualificationThresholdMs: number; // 600 ms default
  hysteresisHoldMs: number;      // 1500 ms default
  energyThreshold: number;       // 0.15 threshold for audible speech
  silenceHoldMs?: number;        // 3000 ms default (silence release)
}

export const DEFAULT_SMOOTHING_CONFIG: SpeakerSmoothingConfig = {
  windowMs: 300,
  qualificationThresholdMs: 600,
  hysteresisHoldMs: 1500,
  energyThreshold: 0.15,
  silenceHoldMs: 3000,
};

interface SpeakerEnergySample {
  timestamp: number;
  energy: number;
}

export interface SpeakerState {
  id: string;
  samples: SpeakerEnergySample[];
  speechStartTime: number | null;
  lastAudibleTime: number;
  currentSmoothedEnergy: number;
  isQualified: boolean;
}

export class SpeakerSmoothingEngine {
  private config: SpeakerSmoothingConfig;
  private speakers: Map<string, SpeakerState> = new Map();
  private activeSpeakerId: string | null = null;
  private activeSpeakerPromotedAt: number = 0;
  private activeSpeakerLastSpokeAt: number = 0;

  constructor(config: Partial<SpeakerSmoothingConfig> = {}) {
    this.config = { ...DEFAULT_SMOOTHING_CONFIG, ...config };
  }

  /**
   * Ingest an audio energy sample for a participant.
   * @param id Participant ID
   * @param energy Raw audio energy 0..1 (e.g. from AudioContext / AnalyserNode)
   * @param now Current timestamp in milliseconds (defaults to performance.now())
   */
  public updateEnergy(id: string, energy: number, now: number = Date.now()): void {
    let state = this.speakers.get(id);
    if (!state) {
      state = {
        id,
        samples: [],
        speechStartTime: null,
        lastAudibleTime: 0,
        currentSmoothedEnergy: 0,
        isQualified: false,
      };
      this.speakers.set(id, state);
    }

    // Append sample
    state.samples.push({ timestamp: now, energy });

    // Prune samples older than windowMs (300 ms)
    const cutoff = now - this.config.windowMs;
    state.samples = state.samples.filter((s) => s.timestamp >= cutoff);

    // Compute rolling average smoothed energy
    const totalEnergy = state.samples.reduce((acc, s) => acc + s.energy, 0);
    state.currentSmoothedEnergy = state.samples.length > 0 ? totalEnergy / state.samples.length : 0;

    // Evaluate continuous speech qualification (600 ms)
    const isAudible = state.currentSmoothedEnergy >= this.config.energyThreshold;
    if (isAudible) {
      const silenceGap = state.lastAudibleTime > 0 ? now - state.lastAudibleTime : 0;
      if (state.speechStartTime === null || silenceGap > this.config.windowMs) {
        state.speechStartTime = now;
      }
      state.lastAudibleTime = now;
      const speechDuration = now - state.speechStartTime;
      state.isQualified = speechDuration >= this.config.qualificationThresholdMs;
    } else {
      // Speech dropped below threshold - reset speech duration
      state.speechStartTime = null;
      state.isQualified = false;
    }

    // If this speaker is currently on stage, update their audible tracking
    if (this.activeSpeakerId === id && isAudible) {
      this.activeSpeakerLastSpokeAt = now;
    }
  }

  /**
   * Compute confidence score for a candidate.
   * Formula: C = (energy * 0.5) + (durationWeight * 0.3) + (recency * 0.2)
   */
  public getConfidence(id: string, now: number = Date.now()): number {
    const state = this.speakers.get(id);
    if (!state || !state.isQualified) return 0;

    const duration = state.speechStartTime ? Math.min(now - state.speechStartTime, 5000) / 5000 : 0;
    const recency = Math.max(0, 1 - (now - state.lastAudibleTime) / 2000);

    return (state.currentSmoothedEnergy * 0.5) + (duration * 0.3) + (recency * 0.2);
  }

  /**
   * Evaluates active speaker transitions adhering to hysteresis rules.
   * Returns the elected active speaker ID (or null).
   */
  public resolveActiveSpeaker(now: number = Date.now()): string | null {
    // Check if current active speaker is protected by hysteresis
    if (this.activeSpeakerId !== null) {
      const timeSinceLastSpoke = now - this.activeSpeakerLastSpokeAt;
      const stageTenure = now - this.activeSpeakerPromotedAt;

      // Hysteresis rule: If current speaker spoke recently (< 1500 ms ago), retain stage
      if (timeSinceLastSpoke < this.config.hysteresisHoldMs) {
        return this.activeSpeakerId;
      }
    }

    // Find the highest confidence qualified candidate who is currently audible
    let bestCandidate: string | null = null;
    let highestConfidence = 0;

    for (const [id, state] of this.speakers.entries()) {
      // Must be qualified and actively speaking within the rolling window
      const isCurrentlyAudible = (now - state.lastAudibleTime) <= this.config.windowMs;
      if (!state.isQualified || !isCurrentlyAudible) continue;
      const conf = this.getConfidence(id, now);
      if (conf > highestConfidence) {
        highestConfidence = conf;
        bestCandidate = id;
      }
    }

    // Elect new active speaker if qualified
    if (bestCandidate && bestCandidate !== this.activeSpeakerId) {
      this.activeSpeakerId = bestCandidate;
      this.activeSpeakerPromotedAt = now;
      this.activeSpeakerLastSpokeAt = now;
    } else if (!bestCandidate && this.activeSpeakerId !== null) {
      const timeSinceLastSpoke = now - this.activeSpeakerLastSpokeAt;
      // Release stage only after silence hold expires completely (3000ms default)
      const silenceLimit = this.config.silenceHoldMs ?? (this.config.hysteresisHoldMs * 2);
      if (timeSinceLastSpoke >= silenceLimit) {
        this.activeSpeakerId = null;
      }
    }

    return this.activeSpeakerId;
  }

  public removeSpeaker(id: string): void {
    this.speakers.delete(id);
    if (this.activeSpeakerId === id) {
      this.activeSpeakerId = null;
    }
  }

  public reset(): void {
    this.speakers.clear();
    this.activeSpeakerId = null;
    this.activeSpeakerPromotedAt = 0;
    this.activeSpeakerLastSpokeAt = 0;
  }

  public getActiveSpeakerId(): string | null {
    return this.activeSpeakerId;
  }
}
