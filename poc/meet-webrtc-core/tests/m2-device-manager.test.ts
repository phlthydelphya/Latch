import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceManager } from '../src/devices/deviceManager';
import { useDeviceStore } from '../src/devices/deviceStore';

describe('M2 Phase D: DeviceManager', () => {
  let manager: DeviceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    useDeviceStore.getState().reset();
    manager = DeviceManager.getInstance();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('D-10: Detects sinkId support correctly for modern browsers vs Safari', () => {
    // 1. Simulating browser with setSinkId on HTMLMediaElement
    const originalProto = (window as any).HTMLMediaElement?.prototype;
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
      writable: true,
    });

    expect(manager.supportsSetSinkId()).toBe(true);

    // 2. Simulating Safari without setSinkId
    delete (HTMLMediaElement.prototype as any).setSinkId;
    if (window.AudioContext) {
      delete (window.AudioContext.prototype as any).setSinkId;
    }
    expect(manager.supportsSetSinkId()).toBe(false);

    // Restore
    if (originalProto) {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
  });

  it('D-11: Enumerates devices and formats fallback labels for unlabelled devices', async () => {
    const mockDevices: MediaDeviceInfo[] = [
      {
        deviceId: 'mic-id-1',
        groupId: 'grp-1',
        kind: 'audioinput',
        label: '', // empty label (e.g. before permission granted)
        toJSON: () => ({}),
      },
      {
        deviceId: 'spk-id-1',
        groupId: 'grp-1',
        kind: 'audiooutput',
        label: 'USB Headset',
        toJSON: () => ({}),
      },
      {
        deviceId: 'cam-id-1',
        groupId: 'grp-2',
        kind: 'videoinput',
        label: '',
        toJSON: () => ({}),
      },
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    await manager.enumerateAndSyncDevices();

    const state = useDeviceStore.getState();
    expect(state.audioInputs).toHaveLength(1);
    expect(state.audioInputs[0].label).toBe('Microphone 1');
    expect(state.audioOutputs).toHaveLength(1);
    expect(state.audioOutputs[0].label).toBe('USB Headset');
    expect(state.videoInputs).toHaveLength(1);
    expect(state.videoInputs[0].label).toBe('Camera 1');
  });

  it('D-12: Delegates switchActiveDevice to LiveKit room and updates store', async () => {
    const mockRoom = {
      switchActiveDevice: vi.fn().mockResolvedValue(true),
    };

    await manager.switchActiveDevice(mockRoom as any, 'audioinput', 'mic-target');
    expect(mockRoom.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'mic-target');
    expect(useDeviceStore.getState().selectedAudioInputId).toBe('mic-target');

    await manager.switchActiveDevice(mockRoom as any, 'videoinput', 'cam-target');
    expect(mockRoom.switchActiveDevice).toHaveBeenCalledWith('videoinput', 'cam-target');
    expect(useDeviceStore.getState().selectedVideoInputId).toBe('cam-target');

    await manager.switchActiveDevice(mockRoom as any, 'audiooutput', 'spk-target');
    expect(mockRoom.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'spk-target');
    expect(useDeviceStore.getState().selectedAudioOutputId).toBe('spk-target');
  });

  it('D-13: Manages microphone VU level monitoring lifecycle cleanly', async () => {
    const stopTrackFn = vi.fn();
    const mockTrack = { stop: stopTrackFn };
    const mockStream = {
      getTracks: () => [mockTrack],
    };

    const mockAnalyser = {
      fftSize: 256,
      smoothingTimeConstant: 0.4,
      frequencyBinCount: 128,
      getByteTimeDomainData: vi.fn((buf: Uint8Array) => {
        // Mock non-silent audio data (loud input)
        buf.fill(160);
      }),
    };

    const mockSource = {
      connect: vi.fn(),
    };

    const mockAudioCtx = {
      state: 'running',
      createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
      createAnalyser: vi.fn().mockReturnValue(mockAnalyser),
      close: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
      writable: true,
    });

    window.AudioContext = vi.fn().mockImplementation(() => mockAudioCtx) as any;

    await manager.startMicMeter('mic-test');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-test' } },
      video: false,
    });

    // Level should be computed and > 0
    expect(useDeviceStore.getState().micLevel).toBeGreaterThan(0);

    // Stop meter
    manager.stopMicMeter();
    expect(stopTrackFn).toHaveBeenCalled();
    expect(mockAudioCtx.close).toHaveBeenCalled();
    expect(useDeviceStore.getState().micLevel).toBe(0);
  });

  it('D-14: Synthesizes dual-tone speaker test chime using AudioContext oscillator', async () => {
    const mockOsc1 = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const mockOsc2 = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };

    let oscCallCount = 0;
    const mockAudioCtx = {
      currentTime: 10,
      state: 'running',
      destination: {},
      createGain: vi.fn().mockReturnValue(mockGain),
      createOscillator: vi.fn().mockImplementation(() => {
        oscCallCount++;
        return oscCallCount === 1 ? mockOsc1 : mockOsc2;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    window.AudioContext = vi.fn().mockImplementation(() => mockAudioCtx) as any;

    await manager.playSpeakerTestChime('spk-test');

    expect(useDeviceStore.getState().isSpeakerTesting).toBe(true);
    expect(mockOsc1.start).toHaveBeenCalled();
    expect(mockOsc2.start).toHaveBeenCalled();

    // Advance past chime timeout (1250ms)
    vi.advanceTimersByTime(1300);
    expect(useDeviceStore.getState().isSpeakerTesting).toBe(false);
    expect(mockAudioCtx.close).toHaveBeenCalled();
  });

  it('D-15: Manages devicechange event listeners cleanly', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: addListener,
        removeEventListener: removeListener,
      },
      configurable: true,
      writable: true,
    });

    manager.startDeviceChangeListener();
    expect(addListener).toHaveBeenCalledWith('devicechange', expect.any(Function));

    manager.stopDeviceChangeListener();
    expect(removeListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });
});
