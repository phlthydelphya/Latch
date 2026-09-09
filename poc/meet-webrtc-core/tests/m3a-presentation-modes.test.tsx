// tests/m3a-presentation-modes.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContentView } from '../src/components/layout/ContentView';
import { useLayoutStore } from '../src/layout/layoutStore';
import { LayoutParticipantTile } from '../src/layout/types';

describe('M3A: Presentation View Modes & Resizable Divider', () => {
  const mockTiles: LayoutParticipantTile[] = [
    {
      id: 'p-presenter',
      name: 'Alice Presenter',
      stream: null,
      isLocal: false,
      isScreen: false,
      videoEnabled: true,
      audioEnabled: true,
      speaking: false,
    },
    {
      id: 'p-viewer',
      name: 'Bob Viewer',
      stream: null,
      isLocal: false,
      isScreen: false,
      videoEnabled: true,
      audioEnabled: false,
      speaking: false,
    },
  ];

  beforeEach(() => {
    useLayoutStore.getState().reset();
    useLayoutStore.getState().setScreenShareOwner('p-presenter');
  });

  it('renders in side-by-side mode by default with presentation stage and sidebar', () => {
    render(<ContentView screenStream={null} tiles={mockTiles} />);

    const container = screen.getByTestId('presentation-container');
    expect(container).not.toBeNull();
    expect(container.getAttribute('data-mode')).toBe('side-by-side');

    const sidebar = screen.getByTestId('presentation-sidebar');
    expect(sidebar).not.toBeNull();
  });

  it('switches to content-only mode and hides presenter sidebar', () => {
    render(<ContentView screenStream={null} tiles={mockTiles} />);

    const contentOnlyBtn = screen.getByTestId('mode-btn-content-only');
    fireEvent.click(contentOnlyBtn);

    expect(useLayoutStore.getState().presentationMode).toBe('content-only');
    expect(screen.queryByTestId('presentation-sidebar')).toBeNull();
  });

  it('switches to pip mode and removes lateral sidebar', () => {
    render(<ContentView screenStream={null} tiles={mockTiles} />);

    const pipBtn = screen.getByTestId('mode-btn-pip');
    fireEvent.click(pipBtn);

    expect(useLayoutStore.getState().presentationMode).toBe('pip');
    expect(screen.queryByTestId('presentation-sidebar')).toBeNull();
  });

  it('allows clamping and setting custom splitRatio between 0.2 and 0.8', () => {
    useLayoutStore.getState().setSplitRatio(0.6);
    expect(useLayoutStore.getState().splitRatio).toBe(0.6);

    // Below min
    useLayoutStore.getState().setSplitRatio(0.05);
    expect(useLayoutStore.getState().splitRatio).toBe(0.2);

    // Above max
    useLayoutStore.getState().setSplitRatio(0.95);
    expect(useLayoutStore.getState().splitRatio).toBe(0.8);
  });
});
