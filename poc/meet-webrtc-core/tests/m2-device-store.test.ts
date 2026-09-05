import { describe, it, expect, beforeEach } from 'vitest';
import { useDeviceStore } from '../src/devices/deviceStore';
import { MediaDeviceOption } from '../src/devices/types';

describe('M2 Phase D: DeviceStore', () => {
  beforeEach(() => {
    useDeviceStore.getState().reset();
  });

  it('D-1: Initializes with default empty device catalog and closed modal', () => {
    const state = useDeviceStore.getState();
    expect(state.audioInputs).toEqual([]);
    expect(state.audioOutputs).toEqual([]);
    expect(state.videoInputs).toEqual([]);
    expect(state.selectedAudioInputId).toBe('');
    expect(state.selectedAudioOutputId).toBe('');
    expect(state.selectedVideoInputId).toBe('');
    expect(state.isSettingsOpen).toBe(false);
    expect(state.activeTab).toBe('audio');
    expect(state.micLevel).toBe(0);
    expect(state.isSpeakerTesting).toBe(false);
    expect(state.sinkIdSupported).toBe(true);
  });

  it('D-2: Populates device catalogs and auto-selects primary devices', () => {
    const inputs: MediaDeviceOption[] = [
      { deviceId: 'mic-1', label: 'USB Mic', groupId: 'g1', kind: 'audioinput' },
      { deviceId: 'mic-2', label: 'Built-in Mic', groupId: 'g2', kind: 'audioinput' },
    ];
    const outputs: MediaDeviceOption[] = [
      { deviceId: 'spk-1', label: 'Headphones', groupId: 'g1', kind: 'audiooutput' },
    ];
    const video: MediaDeviceOption[] = [
      { deviceId: 'cam-1', label: 'HD Webcam', groupId: 'g3', kind: 'videoinput' },
      { deviceId: 'cam-2', label: 'Virtual Camera', groupId: 'g4', kind: 'videoinput' },
    ];

    useDeviceStore.getState().setDevices(inputs, outputs, video);

    const state = useDeviceStore.getState();
    expect(state.audioInputs).toHaveLength(2);
    expect(state.audioOutputs).toHaveLength(1);
    expect(state.videoInputs).toHaveLength(2);
    expect(state.selectedAudioInputId).toBe('mic-1');
    expect(state.selectedAudioOutputId).toBe('spk-1');
    expect(state.selectedVideoInputId).toBe('cam-1');
  });

  it('D-3: Preserves existing selection if present in new device list', () => {
    const inputs1: MediaDeviceOption[] = [
      { deviceId: 'mic-1', label: 'Mic 1', groupId: 'g1', kind: 'audioinput' },
      { deviceId: 'mic-2', label: 'Mic 2', groupId: 'g2', kind: 'audioinput' },
    ];
    useDeviceStore.getState().setDevices(inputs1, [], []);
    useDeviceStore.getState().selectAudioInput('mic-2');
    expect(useDeviceStore.getState().selectedAudioInputId).toBe('mic-2');

    // Re-enumeration with same devices
    const inputs2: MediaDeviceOption[] = [
      { deviceId: 'mic-1', label: 'Mic 1 (Renamed)', groupId: 'g1', kind: 'audioinput' },
      { deviceId: 'mic-2', label: 'Mic 2', groupId: 'g2', kind: 'audioinput' },
      { deviceId: 'mic-3', label: 'Mic 3', groupId: 'g3', kind: 'audioinput' },
    ];
    useDeviceStore.getState().setDevices(inputs2, [], []);
    expect(useDeviceStore.getState().selectedAudioInputId).toBe('mic-2');
  });

  it('D-4: Falls back to first available device if selected device disconnected', () => {
    const inputs: MediaDeviceOption[] = [
      { deviceId: 'mic-ext', label: 'External Mic', groupId: 'g1', kind: 'audioinput' },
      { deviceId: 'mic-int', label: 'Internal Mic', groupId: 'g2', kind: 'audioinput' },
    ];
    useDeviceStore.getState().setDevices(inputs, [], []);
    useDeviceStore.getState().selectAudioInput('mic-ext');

    // External mic unplugged
    useDeviceStore.getState().setDevices([inputs[1]], [], []);
    expect(useDeviceStore.getState().selectedAudioInputId).toBe('mic-int');
  });

  it('D-5: Manages explicit device selections', () => {
    useDeviceStore.getState().selectAudioInput('mic-custom');
    expect(useDeviceStore.getState().selectedAudioInputId).toBe('mic-custom');

    useDeviceStore.getState().selectAudioOutput('spk-custom');
    expect(useDeviceStore.getState().selectedAudioOutputId).toBe('spk-custom');

    useDeviceStore.getState().selectVideoInput('cam-custom');
    expect(useDeviceStore.getState().selectedVideoInputId).toBe('cam-custom');
  });

  it('D-6: Opens settings modal with specified tab and resets ephemeral state on close', () => {
    useDeviceStore.getState().setMicLevel(75);
    useDeviceStore.getState().setSpeakerTesting(true);

    // Open to Diagnostics tab
    useDeviceStore.getState().setSettingsOpen(true, 'diagnostics');
    expect(useDeviceStore.getState().isSettingsOpen).toBe(true);
    expect(useDeviceStore.getState().activeTab).toBe('diagnostics');

    // Switch tab
    useDeviceStore.getState().setActiveTab('video');
    expect(useDeviceStore.getState().activeTab).toBe('video');

    // Close modal
    useDeviceStore.getState().setSettingsOpen(false);
    expect(useDeviceStore.getState().isSettingsOpen).toBe(false);
    expect(useDeviceStore.getState().micLevel).toBe(0);
    expect(useDeviceStore.getState().isSpeakerTesting).toBe(false);
  });

  it('D-7: Clamps micLevel safely between 0 and 100', () => {
    useDeviceStore.getState().setMicLevel(42.4);
    expect(useDeviceStore.getState().micLevel).toBe(42);

    useDeviceStore.getState().setMicLevel(150);
    expect(useDeviceStore.getState().micLevel).toBe(100);

    useDeviceStore.getState().setMicLevel(-20);
    expect(useDeviceStore.getState().micLevel).toBe(0);
  });

  it('D-8: Manages speaker testing and sinkId support state', () => {
    expect(useDeviceStore.getState().isSpeakerTesting).toBe(false);
    useDeviceStore.getState().setSpeakerTesting(true);
    expect(useDeviceStore.getState().isSpeakerTesting).toBe(true);

    useDeviceStore.getState().setSinkIdSupported(false);
    expect(useDeviceStore.getState().sinkIdSupported).toBe(false);
  });

  it('D-9: Completely purges ephemeral memory state on reset()', () => {
    useDeviceStore.getState().setDevices(
      [{ deviceId: 'mic-1', label: 'Mic', groupId: 'g1', kind: 'audioinput' }],
      [{ deviceId: 'spk-1', label: 'Spk', groupId: 'g1', kind: 'audiooutput' }],
      [{ deviceId: 'cam-1', label: 'Cam', groupId: 'g1', kind: 'videoinput' }]
    );
    useDeviceStore.getState().setSettingsOpen(true, 'video');
    useDeviceStore.getState().setMicLevel(80);
    useDeviceStore.getState().setSpeakerTesting(true);
    useDeviceStore.getState().setSinkIdSupported(false);

    useDeviceStore.getState().reset();

    const state = useDeviceStore.getState();
    expect(state.audioInputs).toEqual([]);
    expect(state.audioOutputs).toEqual([]);
    expect(state.videoInputs).toEqual([]);
    expect(state.selectedAudioInputId).toBe('');
    expect(state.selectedAudioOutputId).toBe('');
    expect(state.selectedVideoInputId).toBe('');
    expect(state.isSettingsOpen).toBe(false);
    expect(state.activeTab).toBe('audio');
    expect(state.micLevel).toBe(0);
    expect(state.isSpeakerTesting).toBe(false);
    expect(state.sinkIdSupported).toBe(true);
  });
});
