import { useRef, useEffect } from 'react';
import { usePresenceStore } from '../presence/presenceStore';
import { MAX_PINNED_PARTICIPANTS, useLayoutStore } from '../layout/layoutStore';
import { ConnectionBadge } from './ConnectionBadge';
import { usePermissions } from '../hooks/usePermissions';

interface VideoTileProps {
  id: string;
  stream: MediaStream | null;
  name: string;
  isLocal: boolean;
  isScreen: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  speaking: boolean;
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function VideoTile({ id, stream, name, isLocal, isScreen, videoEnabled, audioEnabled, speaking, onPin, onSpotlight }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const presence = usePresenceStore((s) => s.participants.get(id));
  const { isPrivileged, isParticipantHost, isParticipantCoHost } = usePermissions();
  const isHost = isParticipantHost(id);
  const isCoHost = isParticipantCoHost(id);
  const isPinned = useLayoutStore((s) => s.pinnedParticipantIds.includes(id));
  const pinLimitReached = useLayoutStore((s) => s.pinnedParticipantIds.length >= MAX_PINNED_PARTICIPANTS);
  const isSpotlighted = useLayoutStore((s) => s.spotlightParticipantId === id);
  const pinParticipant = useLayoutStore((s) => s.pinParticipant);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase() || '?';

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={`video-tile ${isLocal ? 'video-tile--local' : ''} ${!videoEnabled ? 'video-tile--camera-off' : ''} ${speaking ? 'video-tile--speaking' : ''} ${isPinned ? 'video-tile--pinned' : ''} ${isSpotlighted ? 'video-tile--spotlighted' : ''}`}
      data-participant-id={id}
      role="group"
      aria-label={name}
    >
      <video ref={videoRef} autoPlay playsInline muted={isLocal} style={{ opacity: videoEnabled ? 1 : 0 }} aria-hidden={true} />
      {!videoEnabled && (
        <div className="video-tile__standby">
          <div className="video-tile__linework" aria-hidden="true" />
          <span className="video-tile__initials" aria-hidden="true">{initials}</span>
          <span className="video-tile__camera-status">Camera off</span>
        </div>
      )}
      <div className="video-tile__badges">
        {isHost && <span className="video-tile__badge video-tile__badge--host">Host</span>}
        {isCoHost && <span className="video-tile__badge video-tile__badge--cohost">Co-Host</span>}
        {presence?.isHandRaised && <span className="video-tile__badge video-tile__badge--raised">✋ Raised</span>}
        {isPinned && <span className="video-tile__badge">Pinned</span>}
        {isSpotlighted && <span className="video-tile__badge video-tile__badge--spotlight">Spotlight</span>}
      </div>
      <div className="video-tile__actions">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (onPin) onPin(id); else pinParticipant(id); }}
          title={isPinned ? 'Unpin from your view' : pinLimitReached ? 'Up to 9 people can be pinned' : 'Pin to your stage'}
          disabled={!isPinned && pinLimitReached}
          aria-label={isPinned ? 'Unpin participant' : 'Pin participant'}
          aria-pressed={isPinned}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m16 3 5 5-5 2-2 5-2 2-5-5 2-2 5-2Z" /><path d="m7 17-4 4" /></svg>
        </button>
        {isPrivileged && onSpotlight && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onSpotlight(isSpotlighted ? '' : id); }} title={isSpotlighted ? 'Remove Spotlight' : 'Spotlight for all'} aria-label={isSpotlighted ? 'Remove spotlight' : 'Spotlight participant for all'} aria-pressed={isSpotlighted}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
          </button>
        )}
      </div>
      <div className="video-tile__label">
        <span>{name}{isLocal && ' (you)'}</span>
        {presence?.connectionQuality && <ConnectionBadge quality={presence.connectionQuality} />}
      </div>
      <div className="video-tile__indicators">
        {speaking && !isLocal && <span className="video-tile__indicator" aria-label="Speaking" />}
        {isScreen && <span className="video-tile__indicator video-tile__indicator--screen" aria-label="Screen sharing" />}
        {!audioEnabled && (
          <svg className="video-tile__mute" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-label="Muted">
            <path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M5 10v2a7 7 0 0 0 12 4.9M12 19v3M8 22h8" />
          </svg>
        )}
      </div>
    </div>
  );
}
