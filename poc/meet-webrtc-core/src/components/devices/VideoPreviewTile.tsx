import { useEffect, useRef, useState } from 'react';
import { useDeviceStore } from '../../devices/deviceStore';

export function VideoPreviewTile() {
  const selectedVideoInputId = useDeviceStore((s) => s.selectedVideoInputId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    let stream: MediaStream | null = null;

    async function startPreview() {
      setIsLoading(true);
      setError(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera access not supported in this browser');
        setIsLoading(false);
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: selectedVideoInputId
            ? { deviceId: { exact: selectedVideoInputId }, width: { ideal: 640 }, height: { ideal: 360 } }
            : { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to access camera');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    startPreview();

    return () => {
      isCancelled = true;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [selectedVideoInputId]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        backgroundColor: '#0a0a0f',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border, #222233)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)', // Mirrored mirror preview
          display: error || isLoading ? 'none' : 'block',
        }}
      />

      {isLoading && (
        <span style={{ fontSize: '0.85rem', color: 'var(--fg-muted, #888899)' }}>
          Starting camera preview…
        </span>
      )}

      {error && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--danger, #ff4757)', fontSize: '0.85rem' }}>
          <span>🚫 Camera unavailable: {error}</span>
        </div>
      )}

      {!error && !isLoading && (
        <span
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            fontSize: '0.7rem',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: '4px',
            backdropFilter: 'blur(4px)',
          }}
        >
          📷 Mirror Preview
        </span>
      )}
    </div>
  );
}
