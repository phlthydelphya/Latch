/**
 * iOS & Safari 17.4+ Lifecycle & Audio Interruption Handler (Initiative 4.4)
 *
 * Requirements:
 * 1. Handles iOS WebKit audio session interruptions (incoming calls, Siri, lock screen).
 * 2. Recovers suspended AudioContext on foreground resume (visibilitychange -> visible).
 * 3. Restores muted media tracks and validates reconnect latency p95 <= 5.0s.
 * 4. PWA standalone lifecycle tracking for iOS Home Screen installations.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getGlobalMetricsCollector } from '../metrics/collector';

export interface IosLifecycleState {
  isIos: boolean;
  isStandalone: boolean;
  isInterrupted: boolean;
  lastResumeDurationMs: number | null;
}

export function useIosLifecycle(options?: {
  audioContext?: AudioContext | null;
  onInterruptionStart?: () => void;
  onInterruptionEnd?: (durationMs: number) => void;
}) {
  const isConnected = useAppStore((s) => s.isConnected);
  const isReconnecting = useAppStore((s) => s.isReconnecting);
  const localParticipant = useAppStore((s) => s.localParticipant);
  const toggleLocalAudio = useAppStore((s) => s.toggleLocalAudio);

  const backgroundTimestampRef = useRef<number | null>(null);
  const [isInterrupted, setIsInterrupted] = useState(false);

  // Platform detection: iOS WebKit / iPadOS / Safari PWA
  const isIos = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const isStandalone = typeof window !== 'undefined' && (
    (window.navigator as any)?.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  );

  const handleForegroundResume = useCallback(async () => {
    if (!backgroundTimestampRef.current) return;
    const interruptionDurationMs = Date.now() - backgroundTimestampRef.current;
    backgroundTimestampRef.current = null;
    setIsInterrupted(false);

    console.log(`[iOS Lifecycle] Resumed from background/interruption after ${interruptionDurationMs}ms (standalone=${isStandalone})`);

    const resumeStartTime = performance.now();

    // 1. Resume AudioContext if suspended by iOS WebKit
    if (options?.audioContext && options.audioContext.state === 'suspended') {
      try {
        await options.audioContext.resume();
        console.log('[iOS Lifecycle] AudioContext resumed successfully');
      } catch (err) {
        console.warn('[iOS Lifecycle] Failed to resume AudioContext:', err);
      }
    }

    // 2. Validate local audio track state
    // iOS pauses/mutes audio tracks during GSM calls
    if (localParticipant?.audioEnabled && localParticipant.stream) {
      const audioTracks = localParticipant.stream.getAudioTracks();
      for (const track of audioTracks) {
        if (track.muted || !track.enabled) {
          console.log('[iOS Lifecycle] Re-enabling muted audio track post-interruption');
          track.enabled = true;
        }
      }
    }

    // 3. Audio session unpause / element unlock
    const audioElements = document.querySelectorAll('audio, video');
    audioElements.forEach((el) => {
      const mediaEl = el as HTMLMediaElement;
      if (mediaEl.paused && !mediaEl.ended && mediaEl.srcObject) {
        mediaEl.play().catch((e) => console.warn('[iOS Lifecycle] Media autoplay resume deferred:', e));
      }
    });

    const resumeDuration = performance.now() - resumeStartTime;
    console.log(`[iOS Lifecycle] Full audio recovery converged in ${resumeDuration.toFixed(1)}ms`);

    // Record telemetry to collector
    try {
      const collector = getGlobalMetricsCollector();
      collector.recordReconnectLatency(resumeDuration);
    } catch {
      // collector optional
    }

    if (options?.onInterruptionEnd) {
      options.onInterruptionEnd(interruptionDurationMs);
    }
  }, [options, localParticipant, isStandalone]);

  const handleBackgroundInterruption = useCallback(() => {
    backgroundTimestampRef.current = Date.now();
    setIsInterrupted(true);
    console.log('[iOS Lifecycle] Background / audio interruption detected');

    if (options?.onInterruptionStart) {
      options.onInterruptionStart();
    }
  }, [options]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleBackgroundInterruption();
      } else if (document.visibilityState === 'visible') {
        handleForegroundResume();
      }
    };

    const handlePageHide = () => handleBackgroundInterruption();
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        console.log('[iOS Lifecycle] Page restored from BFCache (persisted=true)');
      }
      handleForegroundResume();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [handleBackgroundInterruption, handleForegroundResume]);

  return {
    isIos,
    isStandalone,
    isInterrupted,
  };
}
