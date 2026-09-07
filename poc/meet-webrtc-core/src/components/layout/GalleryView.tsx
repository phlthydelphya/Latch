import { useMemo, useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '../../layout/layoutStore';
import { LayoutParticipantTile } from '../../layout/types';
import { VideoTile } from '../VideoTile';
import { calculateOptimalGrid, paginateParticipants, MAX_PAGE_TILES } from '../../layout/gridOptimizer';

interface GalleryViewProps {
  tiles: LayoutParticipantTile[];
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function GalleryView({ tiles, onPin, onSpotlight }: GalleryViewProps) {
  const galleryPage = useLayoutStore((s) => s.galleryPage);
  const setGalleryPage = useLayoutStore((s) => s.setGalleryPage);
  const setVisibleTileIds = useLayoutStore((s) => s.setVisibleTileIds);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });

  // Dynamic viewport sizing via ResizeObserver (M3A Condition 4)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        });
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      try {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
              setDimensions({
                width: Math.floor(width),
                height: Math.floor(height),
              });
            }
          }
        });
        if (observer && typeof observer.observe === 'function') {
          observer.observe(el);
          return () => observer.disconnect();
        }
      } catch {}
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    } else {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
  }, []);

  // Deduplicated pagination via gridOptimizer.paginateParticipants (M3A Condition 6)
  const allIds = useMemo(() => tiles.map((t) => t.id), [tiles]);
  const pagination = useMemo(() => {
    return paginateParticipants(allIds, galleryPage, MAX_PAGE_TILES);
  }, [allIds, galleryPage]);

  const visibleTiles = useMemo(() => {
    const visibleSet = new Set(pagination.visibleTileIds);
    return tiles.filter((t) => visibleSet.has(t.id));
  }, [tiles, pagination.visibleTileIds]);

  // Synchronize visible tiles to store for subscriber-track throttling
  useEffect(() => {
    setVisibleTileIds(pagination.visibleTileIds);
  }, [pagination.visibleTileIds, setVisibleTileIds]);

  // Synchronize clamped page back to store when participant count changes
  useEffect(() => {
    if (galleryPage !== pagination.currentPage) {
      setGalleryPage(pagination.currentPage);
    }
  }, [galleryPage, pagination.currentPage, setGalleryPage]);

  const totalPages = pagination.totalPages;
  const currentPage = pagination.currentPage;

  const count = visibleTiles.length;
  const gridGeometry = useMemo(() => {
    return calculateOptimalGrid({
      containerWidth: dimensions.width,
      containerHeight: dimensions.height,
      participantCount: count,
      maxPerPage: MAX_PAGE_TILES,
    });
  }, [count, dimensions.width, dimensions.height]);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${gridGeometry.cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${gridGeometry.rows}, minmax(0, 1fr))`,
    gap: '8px',
    width: '100%',
    height: '100%',
    padding: '8px',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div
        ref={containerRef}
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
