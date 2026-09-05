import { useMemo } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile } from '../../layout/types';
import { VideoTile } from '../VideoTile';

interface SpeakerViewProps {
  tiles: LayoutParticipantTile[];
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function SpeakerView({ tiles, onPin, onSpotlight }: SpeakerViewProps) {
  const pinnedParticipantId = useLayoutStore((s) => s.pinnedParticipantId);
  const spotlightParticipantId = useLayoutStore((s) => s.spotlightParticipantId);
  const activeSpeakerId = useLayoutStore((s) => s.activeSpeakerId);
  const filmstripPosition = useLayoutStore((s) => s.filmstripPosition);
  const pinParticipant = useLayoutStore((s) => s.pinParticipant);

  // Determine stage participant
  const { stageTile, filmstripTiles } = useMemo(() => {
    if (tiles.length === 0) {
      return { stageTile: null, filmstripTiles: [] };
    }

    let featuredId: string | null = null;
    if (spotlightParticipantId && tiles.some((t) => t.id === spotlightParticipantId)) {
      featuredId = spotlightParticipantId;
    } else if (pinnedParticipantId && tiles.some((t) => t.id === pinnedParticipantId)) {
      featuredId = pinnedParticipantId;
    } else if (activeSpeakerId && tiles.some((t) => t.id === activeSpeakerId)) {
      featuredId = activeSpeakerId;
    } else {
      // Default to first non-local participant, or local
      const firstRemote = tiles.find((t) => !t.isLocal);
      featuredId = firstRemote ? firstRemote.id : tiles[0].id;
    }

    const stage = tiles.find((t) => t.id === featuredId) || tiles[0];
    const rest = tiles.filter((t) => t.id !== stage.id);

    return { stageTile: stage, filmstripTiles: rest };
  }, [tiles, spotlightParticipantId, pinnedParticipantId, activeSpeakerId]);

  if (!stageTile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)' }}>
        <span>No participants in meeting</span>
      </div>
    );
  }

  const isVertical = filmstripPosition === 'side';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'row' : 'column',
        height: '100%',
        minHeight: 0,
        gap: '8px',
        padding: '8px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Primary Stage */}
      <div
        role="region"
        aria-label="Active speaker stage"
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <VideoTile
          id={stageTile.id}
          stream={stageTile.stream}
          name={stageTile.name}
          isLocal={stageTile.isLocal}
          isScreen={stageTile.isScreen}
          videoEnabled={stageTile.videoEnabled}
          audioEnabled={stageTile.audioEnabled}
          speaking={stageTile.speaking}
          onPin={onPin}
          onSpotlight={onSpotlight}
        />
      </div>

      {/* Peer Filmstrip */}
      {filmstripTiles.length > 0 && (
        <div
          role="region"
          aria-label="Peer participants filmstrip"
          style={{
            display: 'flex',
            flexDirection: isVertical ? 'column' : 'row',
            gap: '8px',
            overflowX: isVertical ? 'hidden' : 'auto',
            overflowY: isVertical ? 'auto' : 'hidden',
            width: isVertical ? '200px' : '100%',
            height: isVertical ? '100%' : '140px',
            minHeight: isVertical ? 'auto' : '140px',
            flexShrink: 0,
            padding: '4px',
            boxSizing: 'border-box',
          }}
        >
          {filmstripTiles.map((tile) => (
            <div
              key={tile.id}
              onClick={() => pinParticipant(tile.id)}
              title={`Click to pin ${tile.name}`}
              style={{
                width: isVertical ? '100%' : '200px',
                height: isVertical ? '120px' : '100%',
                flexShrink: 0,
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                border: '1px solid var(--border)',
              }}
            >
              <VideoTile
                id={tile.id}
                stream={tile.stream}
                name={tile.name}
                isLocal={tile.isLocal}
                isScreen={tile.isScreen}
                videoEnabled={tile.videoEnabled}
                audioEnabled={tile.audioEnabled}
                speaking={tile.speaking}
                onPin={onPin}
                onSpotlight={onSpotlight}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
