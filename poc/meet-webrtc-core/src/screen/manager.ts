/**
 * Screen Share Manager - getDisplayMedia with SFrame encryption
 * Separate TrackPublished, same epoch, dynamic switch camera↔screen
 * Handles permission errors across Chrome/Edge/Firefox/Safari
 */

import { EventEmitter } from 'eventemitter3';
import type { SimulcastConfig, SFrameConfig, MediaStreamConstraints, DisplayMediaStreamConstraints } from '../types.js';

export interface ScreenShareConfig {
  simulcast: SimulcastConfig;
  sframe: SFrameConfig;
  preferredDisplaySurface?: 'browser' | 'window' | 'screen' | 'monitor';
  cursor?: 'always' | 'motion' | 'never';
  frameRate?: number;
}

export interface ScreenShareState {
  isSharing: boolean;
  stream: MediaStream | null;
  displaySurface: string | null;
  error: Error | null;
}

export class ScreenShareManager extends EventEmitter {
  private config: ScreenShareConfig;
  private state: ScreenShareState = {
    isSharing: false,
    stream: null,
    displaySurface: null,
    error: null,
  };
  private originalVideoTrack: MediaStreamTrack | null = null;
  private screenVideoTrack: MediaStreamTrack | null = null;

  constructor(config: ScreenShareConfig) {
    super();
    this.config = config;
  }

  async startScreenShare(constraints?: DisplayMediaStreamConstraints): Promise<MediaStream> {
    if (this.state.isSharing) {
      throw new Error('Screen share already active');
    }

    try {
      // Build getDisplayMedia constraints with browser-specific handling
      const displayConstraints = this.buildDisplayConstraints(constraints);
      
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints as unknown as DisplayMediaStreamOptions);
      
      // Configure video track with simulcast
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        await this.configureScreenTrack(videoTrack);
        this.screenVideoTrack = videoTrack;
      }

      // Handle track ended (user stops sharing via browser UI)
      videoTrack?.addEventListener('ended', () => {
        this.handleScreenShareEnded();
      });

      this.state = {
        isSharing: true,
        stream,
        displaySurface: (displayConstraints.video as any)?.displaySurface || 'unknown',
        error: null,
      };

      this.emit('started', { stream, displaySurface: this.state.displaySurface });
      return stream;
    } catch (error) {
      this.state.error = error as Error;
      this.handlePermissionError(error as Error);
      throw error;
    }
  }

  private buildDisplayConstraints(constraints?: DisplayMediaStreamConstraints): DisplayMediaStreamConstraints {
    const defaultConstraints: DisplayMediaStreamConstraints = {
      video: {
        displaySurface: this.config.preferredDisplaySurface || 'browser',
        cursor: this.config.cursor || 'motion',
        frameRate: this.config.frameRate || 30,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: {
        suppressLocalAudioPlayback: true,
      },
    };

    if (constraints) {
      return { ...defaultConstraints, ...constraints };
    }

    return defaultConstraints;
  }

  private async configureScreenTrack(track: MediaStreamTrack): Promise<void> {
    // Apply simulcast settings to screen share track
    // Note: Actual simulcast configuration happens at transceiver level in WebRTCManager
    // Here we just set track constraints
    
    try {
      await track.applyConstraints({
        frameRate: { ideal: this.config.frameRate || 30, max: 30 },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
      });
    } catch (error) {
      console.warn('Could not apply screen track constraints:', error);
    }
  }

  private handlePermissionError(error: Error): void {
    let userMessage = 'Screen share failed';
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      userMessage = 'Screen share permission denied. Please allow screen sharing in browser settings.';
    } else if (error.name === 'NotFoundError' || error.name === 'SourceUnavailableError') {
      userMessage = 'No screen share source available. Try selecting a different window or screen.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      userMessage = 'Could not start screen capture. Another application may be using the screen.';
    } else if (error.name === 'OverconstrainedError') {
      userMessage = 'Screen share constraints not supported. Try lower resolution.';
    } else if (error.name === 'AbortError') {
      userMessage = 'Screen share was cancelled.';
    }

    const enhancedError = new Error(userMessage) as Error & { originalError: Error; code: string };
    enhancedError.originalError = error;
    enhancedError.code = error.name;
    
    this.emit('permission-error', enhancedError);
  }

  private handleScreenShareEnded(): void {
    this.state.isSharing = false;
    this.state.stream = null;
    this.screenVideoTrack = null;
    this.emit('ended', { reason: 'user-stopped' });
  }

  async stopScreenShare(): Promise<void> {
    if (!this.state.isSharing || !this.state.stream) {
      return;
    }

    // Stop all tracks
    this.state.stream.getTracks().forEach(track => {
      track.stop();
    });

    this.state = {
      isSharing: false,
      stream: null,
      displaySurface: null,
      error: null,
    };

    this.screenVideoTrack = null;
    this.emit('stopped');
  }

  async switchToCamera(cameraTrack: MediaStreamTrack): Promise<void> {
    if (!this.state.isSharing) {
      throw new Error('Not currently screen sharing');
    }

    this.originalVideoTrack = cameraTrack;
    this.emit('switch-to-camera', { cameraTrack });
  }

  async switchToScreen(): Promise<void> {
    if (!this.originalVideoTrack) {
      throw new Error('No camera track to switch back to');
    }

    this.emit('switch-to-screen', { originalTrack: this.originalVideoTrack });
  }

  getState(): ScreenShareState {
    return { ...this.state };
  }

  isSharing(): boolean {
    return this.state.isSharing;
  }

  getScreenTrack(): MediaStreamTrack | null {
    return this.screenVideoTrack;
  }

  // Browser compatibility checks
  static async isSupported(): Promise<{ supported: boolean; constraints: DisplayMediaStreamConstraints | null; error?: string }> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return { supported: false, constraints: null, error: 'getDisplayMedia not supported' };
    }

    try {
      // Test with minimal constraints
      const testStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      testStream.getTracks().forEach(t => t.stop());
      return { supported: true, constraints: { video: true } };
    } catch (error) {
      return { supported: false, constraints: null, error: (error as Error).message };
    }
  }

  static getBrowserCapabilities(): {
    getDisplayMedia: boolean;
    displaySurface: boolean;
    cursor: boolean;
    audio: boolean;
    controller: boolean;
  } {
    const ua = navigator.userAgent;
    const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua);
    const isEdge = /Edg/.test(ua);
    const isFirefox = /Firefox/.test(ua);
    const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    return {
      getDisplayMedia: 'getDisplayMedia' in navigator.mediaDevices,
      displaySurface: isChrome || isEdge || isFirefox || (isSafari && !isIOS),
      cursor: isChrome || isEdge || isFirefox,
      audio: isChrome || isEdge || isFirefox,
      controller: isChrome || isEdge, // Screen Capture Controller API
    };
  }
}

// ==================== SAFARI/iOS POLYFILL ====================

export class SafariScreenSharePolyfill {
  static async getDisplayMedia(constraints: DisplayMediaStreamConstraints): Promise<MediaStream> {
    // Safari 17+ supports getDisplayMedia natively
    // iOS Safari requires user gesture and has limitations
    
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('getDisplayMedia not supported on this platform');
    }

    // iOS Safari specific handling
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      // iOS requires user gesture - ensure we're in event handler
      // Also, iOS only supports 'screen' displaySurface
      const iosConstraints: DisplayMediaStreamConstraints = {
        video: {
          displaySurface: 'screen',
          cursor: 'never',
        },
        audio: false, // iOS doesn't support system audio capture
      };
      return navigator.mediaDevices.getDisplayMedia(iosConstraints as unknown as DisplayMediaStreamOptions);
    }

    return navigator.mediaDevices.getDisplayMedia(constraints as unknown as DisplayMediaStreamOptions);
  }

  static isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  static isSafari(): boolean {
    return /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  }
}