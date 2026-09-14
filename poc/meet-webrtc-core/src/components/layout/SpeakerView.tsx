import { useMemo } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile } from '../../layout/types';
import { VideoTile } from '../VideoTile';
import { layoutEngine } from '../../layout/layoutEngine';

interface SpeakerViewProps {
  tiles: LayoutParticipantTile[];
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function SpeakerView({ tiles, onPin, onSpotlight }: SpeakerViewProps) {
  const pinnedParticipantId = useLayoutStore((s) => s.pinnedParticipantId);
  const pinnedParticipantIds = useLayoutStore((s) => s.pinnedParticipantIds);
  const spotlightParticipantId = useLayoutStore((s) => s.spotlightParticipantId);
  const activeSpeakerId = useLayoutStore((s) => s.activeSpeakerId);
  const filmstripPosition = useLayoutStore((s) => s.filmstripPosition);
  const pinParticipant = useLayoutStore((s) => s.pinParticipant);

  // Determine stage participant(s) via deterministic hierarchy (Multi-Pin > Pin > Spotlight > Speaker)
  const { stageTiles, filmstripTiles } = useMemo(() => {
    if (tiles.length === 0) {
      return { stageTiles: [], filmstripTiles: [] };
    }

    const tileMap = new Map(tiles.map((t) => [t.id, t]));
    const pinnedTiles = (pinnedParticipantIds || [])
      .map((id) => tileMap.get(id))
      .filter((t): t is LayoutParticipantTile => Boolean(t));

    // Multi-pin stage: when multiple participants are pinned, render them all on stage
    if (pinnedTiles.length > 1) {
      const stageSet = new Set(pinnedTiles.map((t) => t.id));
      const rest = tiles.filter((t) => !stageSet.has(t.id));
      return { stageTiles: pinnedTiles, filmstripTiles: rest };
    }

    // Single pinned participant
    if (pinnedTiles.length === 1) {
      const stage = pinnedTiles[0];
      const rest = tiles.filter((t) => t.id !== stage.id);
      return { stageTiles: [stage], filmstripTiles: rest };
    }

    // Default: resolve via layoutEngine (Spotlight > Speaker > First Remote)
    const resolved = layoutEngine.resolveStageParticipant({
      hasScreenShare: false,
      screenShareOwnerId: null,
      spotlightParticipantId,
      pinnedParticipantId,
      activeSpeakerId,
      speakerConfidence: useLayoutStore.getState().speakerConfidence,
      userLockedMode: null,
      totalParticipants: tiles.length,
    });

    let featuredId: string | null = null;
    if (resolved && tiles.some((t) => t.id === resolved)) {
      featuredId = resolved;
    } else {
      // Default to first non-local participant, or local
      const firstRemote = tiles.find((t) => !t.isLocal);
      featuredId = firstRemote ? firstRemote.id : tiles[0].id;
    }

    const stage = tiles.find((t) => t.id === featuredId) || tiles[0];
    const rest = tiles.filter((t) => t.id !== stage.id);

    return { stageTiles: [stage], filmstripTiles: rest };
  }, [tiles, spotlightParticipantId, pinnedParticipantId, pinnedParticipantIds, activeSpeakerId]);

  if (stageTiles.length === 0) {
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
        {stageTiles.length > 1 ? (
          <div
            data-testid="multi-pin-stage-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${stageTiles.length === 2 ? 2 : stageTiles.length <= 4 ? 2 : 3}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.ceil(stageTiles.length / (stageTiles.length === 2 ? 2 : stageTiles.length <= 4 ? 2 : 3))}, minmax(0, 1fr))`,
              gap: '8px',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
            }}
          >
            {stageTiles.map((tile) => (
              <div
                key={tile.id}
                style={{
                  minHeight: 0,
                  minWidth: 0,
                  height: '100%',
                  position: 'relative',
                  borderRadius: '8px',
                  overflow: 'hidden',
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
        ) : (
          <VideoTile
            id={stageTiles[0].id}
            stream={stageTiles[0].stream}
            name={stageTiles[0].name}
            isLocal={stageTiles[0].isLocal}
            isScreen={stageTiles[0].isScreen}
            videoEnabled={stageTiles[0].videoEnabled}
            audioEnabled={stageTiles[0].audioEnabled}
            speaking={stageTiles[0].speaking}
            onPin={onPin}
            onSpotlight={onSpotlight}
          />
        )}
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
