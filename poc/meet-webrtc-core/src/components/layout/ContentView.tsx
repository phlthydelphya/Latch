import { useMemo } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile, PresentationMode } from '../../layout/types';
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
  const presentationMode = useLayoutStore((s) => s.presentationMode);
  const setPresentationMode = useLayoutStore((s) => s.setPresentationMode);
  const splitRatio = useLayoutStore((s) => s.splitRatio);
  const setSplitRatio = useLayoutStore((s) => s.setSplitRatio);

  // Presenter tile for PiP overlay or side-by-side
  // Use cameraStream for the presenter (their camera, not screen)
  const presenterTile = useMemo(() => {
    let tile: LayoutParticipantTile | undefined;
    if (screenShareOwnerId) {
      tile = tiles.find((t) => t.id === screenShareOwnerId);
    }
    if (!tile) {
      tile = tiles.find((t) => t.isLocal) || tiles[0];
    }
    return tile;
  }, [tiles, screenShareOwnerId]);

  // Filmstrip includes ALL non-screen tiles (presenter's camera tile should remain)
  // Filter out only tiles that are explicitly screen shares (isScreen === true)
  const filmstripTiles = useMemo(() => {
    return tiles.filter((t) => !t.isScreen);
  }, [tiles]);

  const isContentOnly = presentationMode === 'content-only';
  const isSideBySide = presentationMode === 'side-by-side';
  const isOverBelow = presentationMode === 'over-below';
  const isPip = presentationMode === 'pip';

  // For PiP, we need a presenter tile with the CAMERA stream, not screen
  const pipPresenterTile = useMemo(() => {
    if (!presenterTile) return null;
    return {
      ...presenterTile,
      // Use cameraStream if available (for presenter), fallback to stream
      stream: presenterTile.cameraStream ?? presenterTile.stream,
      isScreen: false, // PiP always shows camera
    };
  }, [presenterTile]);

  return (
    <div
      data-testid="presentation-container"
      data-mode={presentationMode}
      style={{
        display: 'flex',
        flexDirection: isOverBelow ? 'column' : 'row',
        height: '100%',
        minHeight: 0,
        gap: '8px',
        padding: '8px',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Mode Switcher Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 30,
          display: 'flex',
          gap: '4px',
          background: 'rgba(10, 10, 15, 0.85)',
          padding: '4px 8px',
          borderRadius: '8px',
          border: '1px solid var(--border, #222233)',
          backdropFilter: 'blur(8px)',
        }}
        role="toolbar"
        aria-label="Presentation Layout Controls"
      >
        {(['side-by-side', 'pip', 'content-only', 'over-below'] as PresentationMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setPresentationMode(mode)}
            style={{
              background: presentationMode === mode ? 'var(--primary, #6366f1)' : 'transparent',
              color: presentationMode === mode ? '#ffffff' : 'var(--fg-muted, #888899)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
            data-testid={`mode-btn-${mode}`}
          >
            {mode.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Primary Screen Share Stage */}
      <div
        role="region"
        aria-label="Shared screen content"
        style={{
          flex: isContentOnly ? '1 1 100%' : isSideBySide ? `${splitRatio} 1 0` : isOverBelow ? `${splitRatio} 1 0` : '1 1 100%',
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#050508',
          border: '1px solid var(--border, #222233)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {screenStream ? (
          <video
            ref={(el) => {
              if (el && el.srcObject !== screenStream) {
                el.srcObject = screenStream;
              }
            }}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.9rem' }}>
            No screen content available
          </div>
        )}

        {/* Floating PiP Presenter if PiP mode is selected - shows CAMERA, not screen */}
        {isPip && pipPresenterTile && (
          <PipPresenter presenterTile={pipPresenterTile} />
        )}
      </div>

      {/* Side-by-Side or Over/Below Presenter / Filmstrip Panel */}
      {!isContentOnly && !isPip && (
        <div
          data-testid="presentation-sidebar"
          style={{
            flex: isSideBySide ? `${1 - splitRatio} 1 0` : isOverBelow ? `${1 - splitRatio} 1 0` : '0 0 auto',
            minWidth: isSideBySide ? '180px' : '0',
            maxWidth: isSideBySide ? '400px' : 'none',
            minHeight: isOverBelow ? '120px' : '0',
            display: 'flex',
            flexDirection: isSideBySide ? 'column' : 'row',
            gap: '8px',
            overflowY: isSideBySide ? 'auto' : 'hidden',
            overflowX: isOverBelow ? 'auto' : 'hidden',
          }}
        >
          {filmstripTiles.map((tile) => (
            <div
              key={tile.id}
              style={{
                width: isSideBySide ? '100%' : '180px',
                height: isSideBySide ? '140px' : '100%',
                flexShrink: 0,
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
