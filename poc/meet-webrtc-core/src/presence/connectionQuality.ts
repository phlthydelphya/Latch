/**
 * Connection Quality Aggregator (M2 Phase A)
 *
 * First-class deterministic evaluator converting raw network metrics
 * (RTT, packet loss, ICE state) into standardized, vendor-agnostic quality tiers.
 */

import { ConnectionMetrics, ConnectionQualityRating } from './types';

export class ConnectionQualityAggregator {
  /**
   * Evaluates network metrics into a normalized ConnectionQualityRating.
   *
   * Thresholds:
   * - disconnected: ICE failed/disconnected or packet loss >= 50%
   * - poor: RTT > 350ms OR loss > 8%
   * - fair: RTT > 180ms OR loss > 3%
   * - good: RTT > 80ms OR loss > 0.8%
   * - excellent: RTT <= 80ms AND loss <= 0.8%
   */
  static evaluate(metrics: ConnectionMetrics): ConnectionQualityRating {
    const { rttMs, packetLossPct, iceState } = metrics;

    if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
      return 'disconnected';
    }

    if (packetLossPct >= 50.0) {
      return 'disconnected';
    }

    if (rttMs > 350 || packetLossPct > 8.0) {
      return 'poor';
    }

    if (rttMs > 180 || packetLossPct > 3.0) {
      return 'fair';
    }

    if (rttMs > 80 || packetLossPct > 0.8) {
      return 'good';
    }

    return 'excellent';
  }

  /**
   * Maps rating to human-readable label and signal bars (1 to 4).
   */
  static getRatingDetails(rating: ConnectionQualityRating): { label: string; bars: number; colorHex: string } {
    switch (rating) {
      case 'excellent':
        return { label: 'Excellent', bars: 4, colorHex: '#10b981' }; // Emerald
      case 'good':
        return { label: 'Good', bars: 3, colorHex: '#34d399' };      // Light green
      case 'fair':
        return { label: 'Fair', bars: 2, colorHex: '#f59e0b' };      // Amber
      case 'poor':
        return { label: 'Poor', bars: 1, colorHex: '#ef4444' };      // Red
      case 'disconnected':
      default:
        return { label: 'Disconnected', bars: 0, colorHex: '#6b7280' }; // Gray
    }
  }
}
