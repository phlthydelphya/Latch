// tests/m3b-simulcast.test.ts
import { describe, it, expect } from 'vitest';
import { SIMULCAST_LAYERS, M3B_PUBLISH_DEFAULTS } from '../src/webrtc/simulcastConfig';
import { VideoQuality } from 'livekit-client';

describe('M3B: Simulcast & Video Encoding Configuration', () => {
  it('defines exactly 3 spatial simulcast layers (Low, Medium, High)', () => {
    expect(SIMULCAST_LAYERS).toHaveLength(3);

    const [low, med, high] = SIMULCAST_LAYERS;

    // Low layer (180p for gallery tiles)
    expect(low.rid).toBe('q');
    expect(low.width).toBe(320);
    expect(low.height).toBe(180);
    expect(low.maxFramerate).toBe(15);
    expect(low.maxBitrate).toBeLessThanOrEqual(160_000);
    expect(low.quality).toBe(VideoQuality.LOW);

    // Medium layer (360p for small grids)
    expect(med.rid).toBe('h');
    expect(med.width).toBe(640);
    expect(med.height).toBe(360);
    expect(med.maxFramerate).toBe(30);
    expect(med.maxBitrate).toBeLessThanOrEqual(500_000);
    expect(med.quality).toBe(VideoQuality.MEDIUM);

    // High layer (720p for stage/presentation)
    expect(high.rid).toBe('f');
    expect(high.width).toBe(1280);
    expect(high.height).toBe(720);
    expect(high.maxFramerate).toBe(30);
    expect(high.maxBitrate).toBeLessThanOrEqual(1_800_000);
    expect(high.quality).toBe(VideoQuality.HIGH);
  });

  it('enforces simulcast enabled in M3B_PUBLISH_DEFAULTS', () => {
    expect(M3B_PUBLISH_DEFAULTS.simulcast).toBe(true);
    expect(M3B_PUBLISH_DEFAULTS.videoSimulcastLayers).toBeDefined();
    expect(M3B_PUBLISH_DEFAULTS.videoSimulcastLayers?.length).toBe(3);
    expect(M3B_PUBLISH_DEFAULTS.videoEncoding?.maxBitrate).toBe(1_800_000);
  });
});
