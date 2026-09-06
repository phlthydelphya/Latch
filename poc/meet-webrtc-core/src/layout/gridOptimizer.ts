/**
 * Grid Optimizer (M3A Phase 2)
 *
 * Geometric aspect-ratio layout math for 1-20 participants.
 * Computes optimal columns, rows, and dimensions while eliminating orphaned single tiles.
 * Enforces Last-N=9 pagination ceiling for bandwidth conservation.
 */

import { GridGeometry } from './types';

export const MAX_PAGE_TILES = 9; // Last-N ceiling invariant
export const TARGET_ASPECT = 16 / 9;

export interface GridCalcOptions {
  containerWidth: number;
  containerHeight: number;
  participantCount: number;
  maxPerPage?: number;
  gap?: number;
}

/**
 * Calculates optimal grid layout for a given container and participant count.
 */
export function calculateOptimalGrid({
  containerWidth,
  containerHeight,
  participantCount,
  maxPerPage = MAX_PAGE_TILES,
  gap = 12,
}: GridCalcOptions): GridGeometry {
  if (participantCount <= 0) {
    return {
      rows: 0,
      cols: 0,
      tileWidth: 0,
      tileHeight: 0,
      orphans: 0,
      perPage: maxPerPage,
      totalPages: 1,
    };
  }

  const perPage = Math.min(participantCount, maxPerPage);
  const totalPages = Math.max(1, Math.ceil(participantCount / maxPerPage));

  // Determine optimal rows and cols for the current page count
  let bestCols = 1;
  let bestRows = 1;
  let maxTileArea = 0;
  let bestTileWidth = 0;
  let bestTileHeight = 0;

  // Test possible column counts from 1 up to perPage
  for (let cols = 1; cols <= perPage; cols++) {
    const rows = Math.ceil(perPage / cols);
    
    // Check if dimensions fit
    const availableWidth = containerWidth - (cols - 1) * gap;
    const availableHeight = containerHeight - (rows - 1) * gap;

    if (availableWidth <= 0 || availableHeight <= 0) continue;

    const candidateWidth = availableWidth / cols;
    const candidateHeight = availableHeight / rows;

    // Constrain to 16:9 aspect ratio or best fit
    let tileW = candidateWidth;
    let tileH = candidateWidth / TARGET_ASPECT;

    if (tileH > candidateHeight) {
      tileH = candidateHeight;
      tileW = candidateHeight * TARGET_ASPECT;
    }

    const area = tileW * tileH;
    if (area > maxTileArea) {
      maxTileArea = area;
      bestCols = cols;
      bestRows = rows;
      bestTileWidth = Math.floor(tileW);
      bestTileHeight = Math.floor(tileH);
    }
  }

  // Handle orphans: items on last row
  const itemsOnLastRow = perPage % bestCols;
  const orphans = itemsOnLastRow === 1 && bestCols > 2 ? 1 : 0;

  return {
    rows: bestRows,
    cols: bestCols,
    tileWidth: bestTileWidth,
    tileHeight: bestTileHeight,
    orphans,
    perPage: maxPerPage,
    totalPages,
  };
}

/**
 * Paginates a list of participant IDs and computes active vs throttled sets.
 */
export function paginateParticipants(
  allParticipantIds: string[],
  pageIndex: number,
  pageSize = MAX_PAGE_TILES
): {
  visibleTileIds: string[];
  throttledTileIds: string[];
  totalPages: number;
  currentPage: number;
} {
  const total = allParticipantIds.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(0, pageIndex), totalPages - 1);

  const startIdx = currentPage * pageSize;
  const endIdx = startIdx + pageSize;

  const visibleTileIds = allParticipantIds.slice(startIdx, endIdx);
  const visibleSet = new Set(visibleTileIds);
  const throttledTileIds = allParticipantIds.filter((id) => !visibleSet.has(id));

  return {
    visibleTileIds,
    throttledTileIds,
    totalPages,
    currentPage,
  };
}
