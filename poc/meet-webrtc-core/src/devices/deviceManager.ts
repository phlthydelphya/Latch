import { Room } from 'livekit-client';
import { useDeviceStore } from './deviceStore';
import { MediaDeviceOption } from './types';

export class DeviceManager {
  private static instance: DeviceManager | null = null;
  private micStream: MediaStream | null = null;
  private micAudioContext: AudioContext | null = null;
  private micAnimFrameId: number | null = null;
  private deviceChangeListener: (() => void) | null = null;

  static getInstance(): DeviceManager {
    if (!DeviceManager.instance) {
      DeviceManager.instance = new DeviceManager();
    }
    return DeviceManager.instance;
  }

  /**
   * Check if the browser supports setSinkId on media elements or AudioContext.
   */
  supportsSetSinkId(): boolean {
    if (typeof window === 'undefined') return false;
    const mediaProto = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype : null;
    const audioContextProto =
      typeof window.AudioContext !== 'undefined' ? window.AudioContext.prototype : null;
    return !!(
      (mediaProto && 'setSinkId' in mediaProto) ||
      (audioContextProto && 'setSinkId' in audioContextProto)
    );
  }

  /**
   * Query mediaDevices, categorize into inputs/outputs/cameras, and populate store.
   */
  async enumerateAndSyncDevices(): Promise<void> {
    const sinkSupported = this.supportsSetSinkId();
    useDeviceStore.getState().setSinkIdSupported(sinkSupported);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const audioInputs: MediaDeviceOption[] = [];
      const audioOutputs: MediaDeviceOption[] = [];
      const videoInputs: MediaDeviceOption[] = [];

      let micIdx = 1;
      let speakerIdx = 1;
      let camIdx = 1;

      for (const d of devices) {
        if (d.kind === 'audioinput') {
          audioInputs.push({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${micIdx++}`,
            groupId: d.groupId,
            kind: d.kind,
          });
        } else if (d.kind === 'audiooutput') {
          audioOutputs.push({
            deviceId: d.deviceId,
            label: d.label || `Speaker ${speakerIdx++}`,
            groupId: d.groupId,
            kind: d.kind,
          });
        } else if (d.kind === 'videoinput') {
          videoInputs.push({
            deviceId: d.deviceId,
            label: d.label || `Camera ${camIdx++}`,
            groupId: d.groupId,
            kind: d.kind,
          });
        }
      }

      useDeviceStore.getState().setDevices(audioInputs, audioOutputs, videoInputs);
    } catch (err) {
      console.warn('[DeviceManager] Failed to enumerate devices:', err);
    }
  }

  /**
   * Start listening for device plug/unplug events.
   */
  startDeviceChangeListener(): void {
    if (
      this.deviceChangeListener ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.addEventListener !== 'function'
    ) {
      return;
    }
    this.deviceChangeListener = () => {
      this.enumerateAndSyncDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeListener);
  }

  /**
   * Stop listening for device plug/unplug events.
   */
  stopDeviceChangeListener(): void {
    if (
      this.deviceChangeListener &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.removeEventListener === 'function'
    ) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeListener);
      this.deviceChangeListener = null;
    }
  }

  /**
   * Switch the active hardware device mid-call.
   */
  async switchActiveDevice(
    room: Room | null,
    kind: MediaDeviceKind,
    deviceId: string
  ): Promise<void> {
    if (kind === 'audioinput') {
      useDeviceStore.getState().selectAudioInput(deviceId);
    } else if (kind === 'audiooutput') {
      useDeviceStore.getState().selectAudioOutput(deviceId);
    } else if (kind === 'videoinput') {
      useDeviceStore.getState().selectVideoInput(deviceId);
    }

    if (room) {
      try {
        await room.switchActiveDevice(kind, deviceId);
      } catch (err) {
        console.warn(`[DeviceManager] Failed to switch ${kind} to ${deviceId}:`, err);
        throw err;
      }
    }
  }

  /**
   * Start real-time microphone VU level monitoring via Web Audio AnalyserNode.
   */
  async startMicMeter(deviceId?: string): Promise<void> {
    this.stopMicMeter();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micStream = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.micAudioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!this.micAudioContext || this.micAudioContext.state === 'closed') return;

        analyser.getByteTimeDomainData(buffer);

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const norm = (buffer[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        // Scaled non-linear volume representation
        const level = Math.min(100, Math.round(rms * 280));
        useDeviceStore.getState().setMicLevel(level);

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          this.micAnimFrameId = window.requestAnimationFrame(updateMeter);
        }
      };

      updateMeter();
    } catch (err) {
      console.warn('[DeviceManager] Failed to start mic meter:', err);
    }
  }

  /**
   * Stop real-time microphone VU level meter and release audio tracks.
   */
  stopMicMeter(): void {
    if (this.micAnimFrameId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.micAnimFrameId);
      this.micAnimFrameId = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.micAudioContext) {
      try {
        if (this.micAudioContext.state !== 'closed') {
          this.micAudioContext.close();
        }
      } catch {}
      this.micAudioContext = null;
    }

    useDeviceStore.getState().setMicLevel(0);
  }

  /**
   * Play a pleasant synthesized dual-tone speaker test chime (C5 -> E5).
   * Pure Web Audio API: Zero external asset dependencies.
   */
  async playSpeakerTestChime(outputDeviceId?: string): Promise<void> {
    useDeviceStore.getState().setSpeakerTesting(true);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        useDeviceStore.getState().setSpeakerTesting(false);
        return;
      }

      const ctx = new AudioCtx();

      // Route to output device if supported by AudioContext
      if (outputDeviceId && 'setSinkId' in ctx) {
        try {
          await (ctx as any).setSinkId(outputDeviceId);
        } catch (e) {
          console.warn('[DeviceManager] AudioContext setSinkId not supported or failed:', e);
        }
      }

      const now = ctx.currentTime;

      // Master gain node
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.connect(ctx.destination);

      // Tone 1: C5 (523.25 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);

      const gain1 = ctx.createGain();
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain1);
      gain1.connect(masterGain);

      osc1.start(now);
      osc1.stop(now + 0.5);

      // Tone 2: E5 (659.25 Hz)
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.25);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0.001, now + 0.25);
      gain2.gain.linearRampToValueAtTime(0.3, now + 0.32);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc2.start(now + 0.25);
      osc2.stop(now + 1.15);

      masterGain.gain.setValueAtTime(1, now);

      setTimeout(() => {
        try {
          if (ctx.state !== 'closed') {
            ctx.close();
          }
        } catch {}
        useDeviceStore.getState().setSpeakerTesting(false);
      }, 1250);
    } catch (err) {
      console.warn('[DeviceManager] Failed to play speaker test chime:', err);
      useDeviceStore.getState().setSpeakerTesting(false);
    }
  }

  /**
   * Teardown all resources.
   */
  destroy(): void {
    this.stopDeviceChangeListener();
    this.stopMicMeter();
  }
}
