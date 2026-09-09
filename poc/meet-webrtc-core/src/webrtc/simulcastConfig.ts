/**
 * Simulcast & Video Encoding Configuration (M3B Multi-Stream Architecture)
 *
 * Defines 3-layer spatial simulcast parameters optimized for blind SFU forwarding
 * and SFrame RFC 9605 ciphertext headroom (+16B auth tag, KID, CTR counter).
 *
 * Layers:
 * - High (h): 1280x720 @ 30fps, 1200 kbps (stage / presentation)
 * - Medium (m): 640x360 @ 30fps, 400 kbps (2-4p grids)
 * - Low (l): 320x180 @ 15fps, 120 kbps (gallery / filmstrip Last-N=9)
 */

import { VideoQuality, VideoPresets, TrackPublishDefaults } from 'livekit-client';

export interface SimulcastLayerConfig {
  rid: string;
  width: number;
  height: number;
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  quality: VideoQuality;
}

export const SIMULCAST_LAYERS: SimulcastLayerConfig[] = [
  {
    rid: 'q',
    width: 320,
    height: 180,
    maxBitrate: 120_000,
    maxFramerate: 15,
    scaleResolutionDownBy: 4.0,
    quality: VideoQuality.LOW,
  },
  {
    rid: 'h',
    width: 640,
    height: 360,
    maxBitrate: 400_000,
    maxFramerate: 30,
    scaleResolutionDownBy: 2.0,
    quality: VideoQuality.MEDIUM,
  },
  {
    rid: 'f',
    width: 1280,
    height: 720,
    maxBitrate: 1_800_000,
    maxFramerate: 30,
    scaleResolutionDownBy: 1.0,
    quality: VideoQuality.HIGH,
  },
];

export const M3B_PUBLISH_DEFAULTS: TrackPublishDefaults = {
  simulcast: true,
  videoSimulcastLayers: [
    VideoPresets.h180,
    VideoPresets.h360,
    VideoPresets.h720,
  ],
  videoEncoding: {
    maxBitrate: 1_800_000,
    maxFramerate: 30,
  },
  screenShareEncoding: {
    maxBitrate: 1_800_000,
    maxFramerate: 30,
  },
};
