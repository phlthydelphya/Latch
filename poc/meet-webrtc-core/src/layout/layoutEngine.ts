/**
 * Layout Engine & Scoring Arbiter (M3A Phase 1)
 *
 * Deterministic layout scoring model:
 * S = w_share * P_share + w_spot * P_spot + w_spk * C_spk
 *
 * Fallback Hierarchy:
 * Presentation -> Spotlight / Multi-Stage -> Single Speaker -> Auto-Gallery
 */

import { LayoutMode, LayoutScores } from './types';

export interface LayoutEngineInput {
  hasScreenShare: boolean;
  screenShareOwnerId: string | null;
  spotlightParticipantId: string | null;
  pinnedParticipantId: string | null;
  activeSpeakerId: string | null;
  speakerConfidence: number; // 0..1 from SpeakerSmoothingEngine
  userLockedMode: LayoutMode | null; // User manual selection lock
  totalParticipants: number;
}

export interface LayoutWeights {
  weightScreenShare: number; // Default 100
  weightSpotlight: number;   // Default 60
  weightSpeaker: number;     // Default 30
  baseGalleryScore: number;  // Default 10
}

export const DEFAULT_LAYOUT_WEIGHTS: LayoutWeights = {
  weightScreenShare: 100,
  weightSpotlight: 60,
  weightSpeaker: 30,
  baseGalleryScore: 10,
};

export class LayoutEngine {
  private weights: LayoutWeights;

  constructor(weights: Partial<LayoutWeights> = {}) {
    this.weights = { ...DEFAULT_LAYOUT_WEIGHTS, ...weights };
  }

  /**
   * Evaluates all layout triggers and outputs deterministic scores and resolved mode.
   */
  public evaluate(input: LayoutEngineInput): LayoutScores {
    // If user explicitly locked a mode and screen share is NOT active, respect user preference
    if (input.userLockedMode && (!input.hasScreenShare || input.userLockedMode === 'content')) {
      const isManual = true;
      return {
        presentationScore: input.hasScreenShare ? this.weights.weightScreenShare : 0,
        spotlightScore: (input.spotlightParticipantId || input.pinnedParticipantId) ? this.weights.weightSpotlight : 0,
        speakerScore: input.activeSpeakerId ? this.weights.weightSpeaker * input.speakerConfidence : 0,
        galleryScore: this.weights.baseGalleryScore,
        resolvedMode: input.userLockedMode,
      };
    }

    // 1. Calculate Presentation Score (Screen share takes top priority)
    const presentationScore = input.hasScreenShare ? this.weights.weightScreenShare : 0;

    // 2. Calculate Spotlight / Pin Score
    const hasSpotlight = Boolean(input.spotlightParticipantId || input.pinnedParticipantId);
    const spotlightScore = hasSpotlight ? this.weights.weightSpotlight : 0;

    // 3. Calculate Qualified Speaker Score
    const hasSpeaker = Boolean(input.activeSpeakerId);
    const speakerScore = hasSpeaker
      ? this.weights.weightSpeaker * Math.max(0.2, input.speakerConfidence)
      : 0;

    // 4. Base Gallery Score
    const galleryScore = this.weights.baseGalleryScore;

    // Resolve Winning Mode deterministically
    let resolvedMode: LayoutMode = 'gallery';

    if (presentationScore > 0) {
      resolvedMode = 'content';
    } else if (spotlightScore > 0 || speakerScore > galleryScore) {
      resolvedMode = 'speaker';
    } else {
      resolvedMode = 'gallery';
    }

    return {
      presentationScore,
      spotlightScore,
      speakerScore,
      galleryScore,
      resolvedMode,
    };
  }

  /**
   * Determine primary stage participant ID.
   */
  public resolveStageParticipant(input: LayoutEngineInput): string | null {
    // Pin overrides spotlight
    if (input.pinnedParticipantId) {
      return input.pinnedParticipantId;
    }
    // Spotlight overrides dynamic speaker
    if (input.spotlightParticipantId) {
      return input.spotlightParticipantId;
    }
    // Qualified active speaker
    if (input.activeSpeakerId) {
      return input.activeSpeakerId;
    }
    return null;
  }
}

export const layoutEngine = new LayoutEngine();
