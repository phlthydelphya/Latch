import { useMemo } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile } from '../../layout/types';
import { VideoTile } from '../VideoTile';

interface GalleryViewProps {
  tiles: LayoutParticipantTile[];
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

const PAGE_SIZE = 9; // Last-N=9 bandwidth limit

export function GalleryView({ tiles, onPin, onSpotlight }: GalleryViewProps) {
  const galleryPage = useLayoutStore((s) => s.galleryPage);
  const setGalleryPage = useLayoutStore((s) => s.setGalleryPage);

  const totalPages = Math.max(1, Math.ceil(tiles.length / PAGE_SIZE));
  const currentPage = Math.min(galleryPage, totalPages - 1);

  // Slice visible tiles for current page (enforcing Last-N=9 per page)
  const visibleTiles = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return tiles.slice(start, start + PAGE_SIZE);
  }, [tiles, currentPage]);

  const count = visibleTiles.length;
  let gridStyle: React.CSSProperties = {
    display: 'grid',
    gap: '8px',
    width: '100%',
    height: '100%',
    padding: '8px',
    boxSizing: 'border-box',
  };

  if (count === 1) {
    gridStyle.gridTemplateColumns = '1fr';
    gridStyle.gridTemplateRows = '1fr';
  } else if (count === 2) {
    gridStyle.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
    gridStyle.gridTemplateRows = '1fr';
  } else if (count <= 4) {
    gridStyle.gridTemplateColumns = 'repeat(2, 1fr)';
    gridStyle.gridTemplateRows = 'repeat(2, 1fr)';
  } else if (count <= 6) {
    gridStyle.gridTemplateColumns = 'repeat(3, 1fr)';
    gridStyle.gridTemplateRows = 'repeat(2, 1fr)';
  } else {
    // 7 to 9
    gridStyle.gridTemplateColumns = 'repeat(3, 1fr)';
    gridStyle.gridTemplateRows = 'repeat(3, 1fr)';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div
        role="region"
        aria-label="Gallery view"
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      >
        <div style={gridStyle}>
          {visibleTiles.map((tile) => (
            <div key={tile.id} style={{ minHeight: 0, height: '100%', position: 'relative' }}>
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

          {tiles.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--fg-muted)', gap: '1rem' }}>
              <span>Waiting for participants…</span>
            </div>
          )}
        </div>
      </div>

      {/* Pagination controls when >9 participants */}
      {totalPages > 1 && (
        <div
          role="navigation"
          aria-label="Gallery pages"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '6px 12px',
            background: 'rgba(10, 10, 15, 0.85)',
            backdropFilter: 'blur(8px)',
            borderTop: '1px solid var(--border)',
            zIndex: 10,
          }}
        >
          <button
            onClick={() => setGalleryPage(currentPage - 1)}
            disabled={currentPage === 0}
            aria-label="Previous participants page"
            style={{
              background: currentPage === 0 ? 'transparent' : 'var(--bg-elevated)',
              color: currentPage === 0 ? 'var(--fg-muted)' : 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.8rem',
              cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
            Page {currentPage + 1} of {totalPages} ({tiles.length} participants)
          </span>
          <button
            onClick={() => setGalleryPage(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            aria-label="Next participants page"
            style={{
              background: currentPage >= totalPages - 1 ? 'transparent' : 'var(--bg-elevated)',
              color: currentPage >= totalPages - 1 ? 'var(--fg-muted)' : 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.8rem',
              cursor: currentPage >= totalPages - 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
