import { useRef, useEffect } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { PipPosition } from '../../layout/types';
import { VideoTile } from '../VideoTile';

interface PipPresenterProps {
  presenterTile: {
    id: string;
    name: string;
    stream: MediaStream | null;
    isLocal: boolean;
    isScreen: boolean;
    videoEnabled: boolean;
    audioEnabled: boolean;
    speaking: boolean;
  };
}

const NEXT_POSITION: Record<PipPosition, PipPosition> = {
  'bottom-right': 'bottom-left',
  'bottom-left': 'top-left',
  'top-left': 'top-right',
  'top-right': 'bottom-right',
};

const POSITION_STYLES: Record<PipPosition, React.CSSProperties> = {
  'bottom-right': { bottom: '24px', right: '24px' },
  'bottom-left': { bottom: '24px', left: '24px' },
  'top-right': { top: '24px', right: '24px' },
  'top-left': { top: '24px', left: '24px' },
};

export function PipPresenter({ presenterTile }: PipPresenterProps) {
  const isPipEnabled = useLayoutStore((s) => s.isPipEnabled);
  const pipPosition = useLayoutStore((s) => s.pipPosition);
  const togglePip = useLayoutStore((s) => s.togglePip);
  const setPipPosition = useLayoutStore((s) => s.setPipPosition);

  if (!isPipEnabled) {
    return (
      <button
        onClick={togglePip}
        aria-label="Show Picture-in-Picture presenter"
        style={{
          position: 'absolute',
          bottom: '24px',
          right: '24px',
          zIndex: 30,
          background: 'rgba(20, 20, 30, 0.85)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '0.8rem',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        📷 Show Presenter
      </button>
    );
  }

  const handleCyclePosition = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPipPosition(NEXT_POSITION[pipPosition]);
  };

  return (
    <div
      style={{
        position: 'absolute',
        ...POSITION_STYLES[pipPosition],
        width: '240px',
        height: '140px',
        zIndex: 30,
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.15)',
        transition: 'all 200ms ease',
        background: '#0a0a0f',
      }}
    >
      <VideoTile
        id={presenterTile.id}
        name={presenterTile.name}
        stream={presenterTile.stream}
        isLocal={presenterTile.isLocal}
        isScreen={false}
        videoEnabled={presenterTile.videoEnabled}
        audioEnabled={presenterTile.audioEnabled}
        speaking={presenterTile.speaking}
      />

      {/* Floating control buttons */}
      <div
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          display: 'flex',
          gap: '4px',
          zIndex: 35,
        }}
      >
        <button
          onClick={handleCyclePosition}
          title="Move PiP corner"
          aria-label="Move PiP corner"
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '3px 6px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          ⤢
        </button>
        <button
          onClick={togglePip}
          title="Minimize PiP"
          aria-label="Minimize PiP"
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '3px 6px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
