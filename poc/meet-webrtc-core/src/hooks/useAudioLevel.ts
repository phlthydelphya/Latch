import { useEffect, useRef, useState } from 'react';

export function useAudioLevel(stream: MediaStream | undefined, intervalMs = 100) {
  const [level, setLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }

    const initAudio = async () => {
      try {
        audioContextRef.current = new AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.8;
        source.connect(analyserRef.current);
        dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);

        const loop = () => {
          if (analyserRef.current && dataArrayRef.current) {
            const dataArray = dataArrayRef.current as Uint8Array<ArrayBuffer>;
            analyserRef.current.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((a, b) => a + b, 0);
            const avg = sum / dataArray.length;
            setLevel(Math.min(avg / 128, 1));
          }
          animationRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.warn('Audio level monitoring failed:', err);
      }
    };

    initAudio();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audioContextRef.current?.close();
      audioContextRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    };
  }, [stream, intervalMs]);

  return level;
}