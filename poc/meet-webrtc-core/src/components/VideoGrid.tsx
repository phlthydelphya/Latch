import { useMemo } from 'react';
import { VideoTile } from './VideoTile';
import { useAppStore } from '../store/appStore';

interface VideoGridProps {
  localStream: MediaStream | null;
  remoteStreams: MediaStream[];
  screenStream: MediaStream | null;
  localVideoEnabled: boolean;
  localAudioEnabled: boolean;
  screenSharing: boolean;
  maxTiles?: number;
}

export function VideoGrid({
  localStream,
  remoteStreams,
  screenStream,
  localVideoEnabled,
  localAudioEnabled,
  screenSharing,
  maxTiles = 9,
}: VideoGridProps) {
  const lastN = useAppStore((s) => s.lastN);

  // Build participant list for grid: local first, then remotes up to Last-N
  const tiles = useMemo(() => {
    const result: Array<{
      id: string;
      stream: MediaStream | null;
      name: string;
      isLocal: boolean;
      isScreen: boolean;
      videoEnabled: boolean;
      audioEnabled: boolean;
      speaking: boolean;
    }> = [];

    // Local tile (always included)
    result.push({
      id: 'local',
      stream: screenSharing ? screenStream : localStream,
      name: 'You',
      isLocal: true,
      isScreen: screenSharing,
      videoEnabled: localVideoEnabled,
      audioEnabled: localAudioEnabled,
      speaking: false,
    });

    // Remote tiles (up to Last-N)
    const remotes = remoteStreams.slice(0, lastN - 1);
    remotes.forEach((stream, idx) => {
      result.push({
        id: `remote-${idx}`,
        stream,
        name: `Participant ${idx + 1}`,
        isLocal: false,
        isScreen: false,
        videoEnabled: true,
        audioEnabled: true,
        speaking: false,
      });
    });

    return result;
  }, [localStream, remoteStreams, screenStream, localVideoEnabled, localAudioEnabled, screenSharing, lastN]);

  const gridClass = `video-grid video-grid--${Math.min(tiles.length, 9)}`;

  return (
    <div className={gridClass} role="region" aria-label="Meeting participants" style={{ height: '100%', minHeight: 0 }}>
      {tiles.map((tile) => (
        <VideoTile
          key={tile.id}
          id={tile.id}
          stream={tile.stream}
          name={tile.name}
          isLocal={tile.isLocal}
          isScreen={tile.isScreen}
          videoEnabled={tile.videoEnabled}
          audioEnabled={tile.audioEnabled}
          speaking={tile.speaking}
        />
      ))}
      {tiles.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)', gap: '1rem' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Waiting for participants…</span>
        </div>
      )}
    </div>
  );
}