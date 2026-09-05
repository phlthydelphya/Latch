import { useMemo } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile } from '../../layout/types';
import { VideoTile } from '../VideoTile';
import { PipPresenter } from './PipPresenter';

interface ContentViewProps {
  screenStream: MediaStream | null;
  tiles: LayoutParticipantTile[];
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function ContentView({ screenStream, tiles, onPin, onSpotlight }: ContentViewProps) {
  const screenShareOwnerId = useLayoutStore((s) => s.screenShareOwnerId);
  const filmstripPosition = useLayoutStore((s) => s.filmstripPosition);

  // Presenter tile for PiP overlay
  const presenterTile = useMemo(() => {
    if (!screenShareOwnerId) {
      return tiles.find((t) => t.isScreen || t.isLocal) || tiles[0];
    }
    return (
      tiles.find((t) => t.id === screenShareOwnerId) ||
      tiles.find((t) => t.isLocal) ||
      tiles[0]
    );
  }, [tiles, screenShareOwnerId]);

  // Peer filmstrip excludes the presenter if PiP is visible, or shows peers
  const filmstripTiles = useMemo(() => {
    return tiles.filter((t) => !t.isScreen);
  }, [tiles]);

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
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Screen Share Stage */}
      <div
        role="region"
        aria-label="Shared screen content"
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#050508',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {screenStream ? (
          <video
            autoPlay
            playsInline
            muted
            ref={(el) => {
              if (el) el.srcObject = screenStream;
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
            }}
            aria-label="Screen presentation"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--fg-muted)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>Waiting for screen share content…</span>
          </div>
        )}

        {/* Picture-in-Picture Presenter Tile */}
        {presenterTile && <PipPresenter presenterTile={presenterTile} />}
      </div>

      {/* Peer Filmstrip */}
      {filmstripTiles.length > 0 && (
        <div
          role="region"
          aria-label="Audience filmstrip"
          style={{
            display: 'flex',
            flexDirection: isVertical ? 'column' : 'row',
            gap: '8px',
            overflowX: isVertical ? 'hidden' : 'auto',
            overflowY: isVertical ? 'auto' : 'hidden',
            width: isVertical ? '200px' : '100%',
            height: isVertical ? '100%' : '120px',
            minHeight: isVertical ? 'auto' : '120px',
            flexShrink: 0,
            padding: '4px',
            boxSizing: 'border-box',
          }}
        >
          {filmstripTiles.map((tile) => (
            <div
              key={tile.id}
              style={{
                width: isVertical ? '100%' : '160px',
                height: isVertical ? '100px' : '100%',
                flexShrink: 0,
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden',
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
