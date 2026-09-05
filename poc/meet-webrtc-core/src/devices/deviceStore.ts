import { create } from 'zustand';
import { DeviceSettingsTab, MediaDeviceOption } from './types';

export interface DeviceState {
  audioInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  selectedVideoInputId: string;
  isSettingsOpen: boolean;
  activeTab: DeviceSettingsTab;
  micLevel: number;
  isSpeakerTesting: boolean;
  sinkIdSupported: boolean;

  setDevices: (
    inputs: MediaDeviceOption[],
    outputs: MediaDeviceOption[],
    video: MediaDeviceOption[]
  ) => void;
  selectAudioInput: (id: string) => void;
  selectAudioOutput: (id: string) => void;
  selectVideoInput: (id: string) => void;
  setSettingsOpen: (open: boolean, tab?: DeviceSettingsTab) => void;
  setActiveTab: (tab: DeviceSettingsTab) => void;
  setMicLevel: (level: number) => void;
  setSpeakerTesting: (testing: boolean) => void;
  setSinkIdSupported: (supported: boolean) => void;
  reset: () => void;
}

const initialState = {
  audioInputs: [] as MediaDeviceOption[],
  audioOutputs: [] as MediaDeviceOption[],
  videoInputs: [] as MediaDeviceOption[],
  selectedAudioInputId: '',
  selectedAudioOutputId: '',
  selectedVideoInputId: '',
  isSettingsOpen: false,
  activeTab: 'audio' as DeviceSettingsTab,
  micLevel: 0,
  isSpeakerTesting: false,
  sinkIdSupported: true,
};

export const useDeviceStore = create<DeviceState>((set) => ({
  ...initialState,

  setDevices: (inputs, outputs, video) =>
    set((state) => ({
      audioInputs: inputs,
      audioOutputs: outputs,
      videoInputs: video,
      selectedAudioInputId:
        state.selectedAudioInputId && inputs.some((d) => d.deviceId === state.selectedAudioInputId)
          ? state.selectedAudioInputId
          : inputs[0]?.deviceId || '',
      selectedAudioOutputId:
        state.selectedAudioOutputId && outputs.some((d) => d.deviceId === state.selectedAudioOutputId)
          ? state.selectedAudioOutputId
          : outputs[0]?.deviceId || '',
      selectedVideoInputId:
        state.selectedVideoInputId && video.some((d) => d.deviceId === state.selectedVideoInputId)
          ? state.selectedVideoInputId
          : video[0]?.deviceId || '',
    })),

  selectAudioInput: (id) => set({ selectedAudioInputId: id }),
  selectAudioOutput: (id) => set({ selectedAudioOutputId: id }),
  selectVideoInput: (id) => set({ selectedVideoInputId: id }),

  setSettingsOpen: (open, tab) =>
    set((state) => ({
      isSettingsOpen: open,
      activeTab: tab || (open ? state.activeTab : 'audio'),
      // Reset live meter on close
      micLevel: open ? state.micLevel : 0,
      isSpeakerTesting: false,
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setMicLevel: (level) => set({ micLevel: Math.max(0, Math.min(100, Math.round(level))) }),

  setSpeakerTesting: (testing) => set({ isSpeakerTesting: testing }),

  setSinkIdSupported: (supported) => set({ sinkIdSupported: supported }),

  reset: () => set(initialState),
}));
