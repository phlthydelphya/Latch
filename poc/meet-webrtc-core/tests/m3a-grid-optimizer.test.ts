// tests/m3a-grid-optimizer.test.ts
import { describe, it, expect } from 'vitest';
import { calculateOptimalGrid, paginateParticipants, MAX_PAGE_TILES } from '../src/layout/gridOptimizer';

describe('M3A: Grid Optimizer & Geometric Aspect-Ratio Math', () => {
  it('calculates single-tile geometry for 1 participant', () => {
    const grid = calculateOptimalGrid({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 1,
    });

    expect(grid.cols).toBe(1);
    expect(grid.rows).toBe(1);
    expect(grid.tileWidth).toBeGreaterThan(0);
    expect(grid.tileHeight).toBeGreaterThan(0);
    expect(grid.orphans).toBe(0);
    expect(grid.totalPages).toBe(1);
  });

  it('calculates 2x1 geometry for 2 participants', () => {
    const grid = calculateOptimalGrid({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 2,
    });

    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(1);
    expect(grid.orphans).toBe(0);
  });

  it('calculates 2x2 geometry for 4 participants', () => {
    const grid = calculateOptimalGrid({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 4,
    });

    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.orphans).toBe(0);
  });

  it('calculates 3x2 geometry for 6 participants', () => {
    const grid = calculateOptimalGrid({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 6,
    });

    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(2);
    expect(grid.orphans).toBe(0);
  });

  it('caps at 9 tiles per page (Last-N ceiling) and computes correct pagination for 20 users', () => {
    const grid = calculateOptimalGrid({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 20,
    });

    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(3);
    expect(grid.perPage).toBe(MAX_PAGE_TILES);
    expect(grid.totalPages).toBe(3); // 9 + 9 + 2 = 20
  });

  it('correctly partitions visible vs throttled tiles across pages', () => {
    const participantIds = Array.from({ length: 15 }, (_, i) => `p-${i + 1}`);

    // Page 0 (items 1 to 9)
    const page0 = paginateParticipants(participantIds, 0, 9);
    expect(page0.totalPages).toBe(2);
    expect(page0.currentPage).toBe(0);
    expect(page0.visibleTileIds.length).toBe(9);
    expect(page0.visibleTileIds[0]).toBe('p-1');
    expect(page0.visibleTileIds[8]).toBe('p-9');
    expect(page0.throttledTileIds.length).toBe(6);
    expect(page0.throttledTileIds[0]).toBe('p-10');

    // Page 1 (items 10 to 15)
    const page1 = paginateParticipants(participantIds, 1, 9);
    expect(page1.currentPage).toBe(1);
    expect(page1.visibleTileIds.length).toBe(6);
    expect(page1.visibleTileIds[0]).toBe('p-10');
    expect(page1.throttledTileIds.length).toBe(9);
    expect(page1.throttledTileIds[0]).toBe('p-1');
  });

  it('clamps invalid page indices gracefully', () => {
    const ids = ['p-1', 'p-2', 'p-3'];
    const negativePage = paginateParticipants(ids, -5, 9);
    expect(negativePage.currentPage).toBe(0);

    const excessivePage = paginateParticipants(ids, 999, 9);
    expect(excessivePage.currentPage).toBe(0);
  });
});
