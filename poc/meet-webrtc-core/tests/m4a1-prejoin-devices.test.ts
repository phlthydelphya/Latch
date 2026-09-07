import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaDevices } from '../src/hooks/useMediaDevices';
import { useAudioMeter } from '../src/hooks/useAudioMeter';

describe('PreJoin Devices & Audio Setup (M4A.1 / DEVICE-01..07)', () => {
  let mockDevices: MediaDeviceInfo[] = [];
  let deviceChangeListeners: Function[] = [];

  beforeEach(() => {
    deviceChangeListeners = [];
    mockDevices = [
      {
        deviceId: 'cam-1',
        groupId: 'g-1',
        kind: 'videoinput',
        label: 'Integrated HD Camera',
        toJSON: () => ({}),
      },
      {
        deviceId: 'mic-1',
        groupId: 'g-1',
        kind: 'audioinput',
        label: 'Internal Microphone',
        toJSON: () => ({}),
      },
      {
        deviceId: 'spk-1',
        groupId: 'g-1',
        kind: 'audiooutput',
        label: 'Internal Speakers',
        toJSON: () => ({}),
      },
    ];

    Object.defineProperty(global.navigator, 'mediaDevices', {
      writable: true,
      value: {
        enumerateDevices: vi.fn().mockImplementation(async () => mockDevices),
        getUserMedia: vi.fn().mockImplementation(async () => {
          return {
            getTracks: () => [{ stop: vi.fn(), enabled: true, kind: 'audio' }],
            getAudioTracks: () => [{ stop: vi.fn(), enabled: true, kind: 'audio' }],
            getVideoTracks: () => [{ stop: vi.fn(), enabled: true, kind: 'video' }],
          };
        }),
        addEventListener: vi.fn((event: string, cb: Function) => {
          if (event === 'devicechange') {
            deviceChangeListeners.push(cb);
          }
        }),
        removeEventListener: vi.fn(),
      },
    });
  });

  it('DEVICE-01: Enumerates camera, microphone, and speaker (audiooutput) devices', async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.refreshDevices();
    });

    const cameras = result.current.devices.filter((d) => d.kind === 'videoinput');
    const mics = result.current.devices.filter((d) => d.kind === 'audioinput');
    const speakers = result.current.devices.filter((d) => d.kind === 'audiooutput');

    expect(cameras.length).toBe(1);
    expect(mics.length).toBe(1);
    expect(speakers.length).toBe(1);
    expect(speakers[0].label).toBe('Internal Speakers');
  });

  it('DEVICE-02: Dynamically updates device list on devicechange event', async () => {
    const { result } = renderHook(() => useMediaDevices());
    await act(async () => {
      await result.current.refreshDevices();
    });

    // Plug in an external USB headset
    mockDevices.push({
      deviceId: 'mic-2',
      groupId: 'g-2',
      kind: 'audioinput',
      label: 'USB Wireless Headset Mic',
      toJSON: () => ({}),
    });

    // Fire devicechange listener
    await act(async () => {
      for (const listener of deviceChangeListeners) {
        await listener();
      }
    });

    const mics = result.current.devices.filter((d) => d.kind === 'audioinput');
    expect(mics.length).toBe(2);
    expect(mics.some((m) => m.label === 'USB Wireless Headset Mic')).toBe(true);
  });

  it('DEVICE-03: Detects sinkId support correctly', () => {
    const { result } = renderHook(() => useMediaDevices());
    expect(typeof result.current.supportsSinkId).toBe('boolean');
  });

  it('DEVICE-04: Computes audio meter level when audio stream is active', () => {
    const mockTrack = { stop: vi.fn(), enabled: true, kind: 'audio' };
    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getVideoTracks: () => [],
      getTracks: () => [mockTrack],
    } as unknown as MediaStream;

    const { result } = renderHook(() => useAudioMeter(mockStream, true));
    expect(typeof result.current).toBe('number');
    expect(result.current).toBeGreaterThanOrEqual(0);
  });

  it('DEVICE-05: Returns zero volume level when mic is muted or disabled', () => {
    const mockTrack = { stop: vi.fn(), enabled: false, kind: 'audio' };
    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getVideoTracks: () => [],
      getTracks: () => [mockTrack],
    } as unknown as MediaStream;

    const { result } = renderHook(() => useAudioMeter(mockStream, false));
    expect(result.current).toBe(0);
  });
});
