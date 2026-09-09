import { useEffect, useState, useRef } from 'react';

/**
 * useAudioMeter
 *
 * Connects an active MediaStream to an AudioContext AnalyserNode
 * to provide a smoothed 0-100 audio level value for mic activity indicators.
 */
export function useAudioMeter(stream: MediaStream | null, enabled: boolean = true) {
  const [level, setLevel] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || !enabled) {
      setLevel(0);
      return;
    }

    const audioTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : (typeof stream.getTracks === 'function' ? stream.getTracks().filter((t) => t.kind === 'audio') : []);
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      setLevel(0);
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
    } catch {
      return;
    }

    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const tick = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Normalize 0-255 to roughly 0-100 with a slight curve
        const normalized = Math.min(100, Math.round((average / 128) * 100));
        setLevel(normalized);

        animationFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (err) {
      console.warn('[useAudioMeter] Failed to attach analyser:', err);
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (source) {
        try {
          source.disconnect();
        } catch {}
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
      setLevel(0);
    };
  }, [stream, enabled]);

  return level;
}
