import { useRef, useEffect } from 'react';
import { usePresenceStore } from '../presence/presenceStore';
import { ConnectionBadge } from './ConnectionBadge';

interface VideoTileProps {
  id: string;
  stream: MediaStream | null;
  name: string;
  isLocal: boolean;
  isScreen: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  speaking: boolean;
}

export function VideoTile({
  id,
  stream,
  name,
  isLocal,
  isScreen,
  videoEnabled,
  audioEnabled,
  speaking,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Read Presence Domain state for this participant
  const presence = usePresenceStore((s) => s.participants.get(id));
  const isHost = usePresenceStore((s) => s.hostId === id || presence?.isHost);
  const isHandRaised = presence?.isHandRaised;
  const connectionQuality = presence?.connectionQuality;

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
    } else if (video) {
      video.srcObject = null;
    }
  }, [stream]);

  const handleVideoError = () => {
    console.warn(`Video error for tile ${id}`);
  };

  return (
    <div
      className={`video-tile ${isLocal ? 'video-tile--local' : ''}`}
      data-participant-id={id}
      role="group"
      aria-label={name}
      style={{
        boxShadow: speaking ? '0 0 0 2px var(--accent, #00d4aa), 0 0 16px rgba(0, 212, 170, 0.3)' : undefined,
        transition: 'box-shadow 150ms ease',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        onError={handleVideoError}
        style={{
          opacity: videoEnabled ? 1 : 0.3,
          filter: videoEnabled ? 'none' : 'grayscale(1)',
          background: videoEnabled ? 'transparent' : 'var(--bg)',
        }}
        aria-hidden={true}
      />
      
      {!videoEnabled && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', color: 'var(--fg-muted)', fontSize: '2rem' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </div>
      )}

      {/* Badges in Top Left */}
      <div style={{ position: 'absolute', top: '8px', left: '8px', display: 'flex', gap: '4px', zIndex: 2 }}>
        {isHost && (
          <span
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.85)',
              color: '#000',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            👑 Host
          </span>
        )}
        {isHandRaised && (
          <span
            style={{
              backgroundColor: 'rgba(255, 165, 2, 0.9)',
              color: '#000',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              animation: 'bounceHand 1s infinite alternate',
            }}
          >
            ✋ Raised
          </span>
        )}
      </div>

      {/* Participant Label & Connection in Bottom Left */}
      <div className="video-tile__label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{name}{isLocal && ' (you)'}</span>
        {connectionQuality && <ConnectionBadge quality={connectionQuality} />}
      </div>

      <div className="video-tile__indicators">
        {speaking && !isLocal && (
          <span className="video-tile__indicator" aria-label="Speaking" />
        )}
        {isScreen && (
          <span className="video-tile__indicator video-tile__indicator--screen" aria-label="Screen sharing" />
        )}
        {!audioEnabled && (
          <svg className="video-tile__indicator" style={{ background: 'transparent', width: '16px', height: '16px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Muted">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95a7 7 0 0 1-14 0" />
          </svg>
        )}
      </div>

      <style>{`
        @keyframes bounceHand {
          0% { transform: translateY(0); }
          100% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}