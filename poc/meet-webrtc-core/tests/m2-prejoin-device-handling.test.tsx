import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreJoinPage } from '../src/pages/PreJoinPage';
import { useAppStore } from '../src/store/appStore';

describe('M2 Phase D: PreJoinPage Hardware Busy & Retry Affordance', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().setRoom('test-room', 'p-123', 'jwt-token', 'key-param');
    useAppStore.getState().setCredentials('lk-token', 'ws://127.0.0.1:7880');
    vi.restoreAllMocks();
  });

  it('falls back to audio-only when video allocation fails and renders Retry Camera button', async () => {
    const mockAudioStream = {
      getTracks: () => [
        { kind: 'audio', stop: vi.fn(), enabled: true },
      ],
    };

    let attempt = 0;
    const mockGetUserMedia = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
      attempt++;
      if (constraints.video) {
        if (attempt === 1) {
          const err = new DOMException('Failed to allocate videosource', 'NotReadableError');
          return Promise.reject(err);
        }
        // On retry, succeed with both
        return Promise.resolve({
          getTracks: () => [
            { kind: 'video', stop: vi.fn(), enabled: true },
            { kind: 'audio', stop: vi.fn(), enabled: true },
          ],
        });
      }
      // Audio-only fallback request
      return Promise.resolve(mockAudioStream);
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'cam-1', kind: 'videoinput', label: 'Integrated Camera', groupId: 'g1' },
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Default Microphone', groupId: 'g1' },
        ]),
        getUserMedia: mockGetUserMedia,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter initialEntries={['/r/test-room']}>
        <Routes>
          <Route path="/r/:roomId" element={<PreJoinPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the fallback alert to be displayed
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain('Camera is in use by another application or unavailable. Joined with microphone.');
    });

    // Verify Retry Camera button is present
    const retryBtn = screen.getByRole('button', { name: /retry camera/i });
    expect(retryBtn).not.toBeNull();

    // Click Retry Camera
    fireEvent.click(retryBtn);

    // After retry succeeds, alert and retry button should be cleared
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /retry camera/i })).toBeNull();
      expect(screen.queryByText(/Camera is in use by another application/i)).toBeNull();
    });
  });
});
