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

  it('BHS-001A: Semantic lifecycle - fails camera, succeeds fallback, maintains error, clears on manual retry', async () => {
    let testPhase: 'CAMERA_FAILURE' | 'RECOVERY_SUCCESS' = 'CAMERA_FAILURE';

    const mockGetUserMedia = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
      console.log(`[TEST MOCK] getUserMedia called with`, JSON.stringify(constraints), `| phase: ${testPhase}`);

      if (testPhase === 'CAMERA_FAILURE') {
        // Any request containing video must reject with NotReadableError
        if (constraints.video) {
          return Promise.reject(new DOMException('Failed to allocate videosource', 'NotReadableError'));
        }
        // Audio-only fallback must succeed
        if (constraints.audio && constraints.video === false) {
          return Promise.resolve({
            getTracks: () => [{ kind: 'audio', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) }],
            getAudioTracks: () => [{ kind: 'audio', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) }],
            getVideoTracks: () => [],
          });
        }
      }

      if (testPhase === 'RECOVERY_SUCCESS') {
        return Promise.resolve({
          getTracks: () => [
            { kind: 'video', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'cam-1' }) },
            { kind: 'audio', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) },
          ],
          getAudioTracks: () => [{ kind: 'audio', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) }],
          getVideoTracks: () => [{ kind: 'video', stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'cam-1' }) }],
        });
      }

      return Promise.resolve({
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      });
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

    const { unmount } = render(
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

    // Verify video is disabled in the toggle button
    const cameraToggle = screen.getByLabelText('Turn on camera');
    expect(cameraToggle.className).toContain('muted');

    // Set test fixture to success phase before clicking retry
    testPhase = 'RECOVERY_SUCCESS';

    // Click Retry Camera
    fireEvent.click(retryBtn);

    // After retry succeeds, alert and retry button should be cleared
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /retry camera/i })).toBeNull();
      expect(screen.queryByText(/Camera is in use by another application/i)).toBeNull();
    });

    // Verify unmount behavior
    unmount();
  });
});
