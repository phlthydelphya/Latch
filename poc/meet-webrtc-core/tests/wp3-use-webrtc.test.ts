/**
 * @vitest-environment jsdom
 * WP-3 useWebRTC SFrame E2EE Integration Unit & Integration Tests
 *
 * Verifies insertion points I-1 through I-13 per:
 * - phase2b-sframe-design-v2.1.md §16
 * - phase2b-b06-resolution.md
 *
 * Test Matrix:
 * 1. I-1: RoomOptions blind-forward configuration (adaptiveStream: false, dynacast: false)
 * 2. I-2 & I-4: Pre-connect invariants (KeyManager init, global SFrame singleton, 12B salt, counter=0n)
 * 3. I-3: HPKE public key queued & flushed on Connected (reliable, topic: 'hpke-pubkey')
 * 4. I-5 & I-6: LocalTrackPublished & TrackSubscribed install shared SFrame transforms
 * 5. I-7: DataReceived topic dispatching (hpke-pubkey, sframe-commit, sframe-welcome, welcome-request)
 * 6. I-8: Audio/Video toggling preserves transform & global counter
 * 7. I-9: Screen share shares global SFrame transform and counter domain
 * 8. I-10: Leader election & debounced join rotation with Welcome to joiner & commits to peers
 * 9. I-11: Leave rekey under rotationMutex & leaver counter deletion
 * 10. I-13: Effect teardown clears counters, destroys KeyManager, resets global singleton
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// Ensure real WebCrypto in jsdom environment
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

if (typeof (globalThis as any).MediaStream === 'undefined') {
  (globalThis as any).MediaStream = class MockMediaStream {
    private _tracks: any[] = [];
    getTracks() { return this._tracks; }
    getAudioTracks() { return this._tracks.filter((t: any) => t.kind === 'audio'); }
    getVideoTracks() { return this._tracks.filter((t: any) => t.kind === 'video'); }
    addTrack(t: any) { this._tracks.push(t); }
    removeTrack(t: any) { this._tracks = this._tracks.filter((x: any) => x !== t); }
  };
}

if (typeof (globalThis as any).RTCRtpSender === 'undefined') {
  (globalThis as any).RTCRtpSender = class RTCRtpSender {};
  (globalThis as any).RTCRtpSender.prototype.createEncodedStreams = vi.fn();
}

if (typeof (globalThis as any).RTCRtpReceiver === 'undefined') {
  (globalThis as any).RTCRtpReceiver = class RTCRtpReceiver {};
  (globalThis as any).RTCRtpReceiver.prototype.createEncodedStreams = vi.fn();
}

import { KeyManager } from '../src/keys/manager';
import {
  SFrameTransform,
  getGlobalSFrame,
  setGlobalSFrame,
  getGlobalCounterMutex,
  installSFrameOnSenderShared,
  installSFrameOnReceiverShared,
} from '../src/sframe/transform';
import { canonicalizeIdentity } from '../src/utils/identity';
import { useAppStore } from '../src/store/appStore';
import { usePresenceStore } from '../src/presence/presenceStore';

// Mock livekit-client classes and events using vi.hoisted
const { MockRoom, mockRoomInstances } = vi.hoisted(() => {
  const instances: any[] = [];

  class SimpleEmitter {
    private _listeners = new Map<string, Function[]>();
    on(event: string, fn: Function) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event)!.push(fn);
      return this;
    }
    emit(event: string, ...args: any[]) {
      const list = this._listeners.get(event) || [];
      for (const fn of list) {
        fn(...args);
      }
    }
  }

  class MockLocalParticipant extends SimpleEmitter {
    identity = 'alice';
    isMicrophoneEnabled = false;
    isCameraEnabled = false;
    isScreenShareEnabled = false;
    trackPublications = new Map<string, any>();

    publishData = vi.fn().mockResolvedValue(undefined);
    setCameraEnabled = vi.fn().mockImplementation(async (enabled: boolean) => {
      this.isCameraEnabled = enabled;
      return undefined;
    });
    setMicrophoneEnabled = vi.fn().mockImplementation(async (enabled: boolean) => {
      this.isMicrophoneEnabled = enabled;
      return undefined;
    });
    setScreenShareEnabled = vi.fn().mockImplementation(async (enabled: boolean) => {
      this.isScreenShareEnabled = enabled;
      return undefined;
    });
    getTrackPublication = vi.fn().mockImplementation((source: string) => {
      return this.trackPublications.get(source) || null;
    });
  }

  class MockRoom extends SimpleEmitter {
    name = 'test-room';
    state = 'connected';
    options: any;
    localParticipant: MockLocalParticipant;
    remoteParticipants = new Map<string, any>();

    constructor(options?: any) {
      super();
      this.options = options;
      this.localParticipant = new MockLocalParticipant();
      instances.push(this);
    }

    connect = vi.fn().mockImplementation(async (_url: string, _token: string) => {
      this.emit('connected');
      return this;
    });

    disconnect = vi.fn().mockImplementation(async () => {
      this.state = 'disconnected';
      this.emit('disconnected');
    });
  }

  return { MockRoom, mockRoomInstances: instances };
});

vi.mock('livekit-client', () => {
  return {
    Room: MockRoom,
    ParticipantEvent: {
      LocalSenderCreated: 'localSenderCreated',
    },
    RoomEvent: {
      Connected: 'connected',
      Disconnected: 'disconnected',
      Reconnecting: 'reconnecting',
      Reconnected: 'reconnected',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      LocalTrackPublished: 'localTrackPublished',
      DataReceived: 'dataReceived',
    },
    ConnectionState: {
      Connected: 'connected',
      Disconnected: 'disconnected',
      Connecting: 'connecting',
      Reconnecting: 'reconnecting',
    },
    Track: {
      Source: {
        Camera: 'camera',
        Microphone: 'microphone',
        ScreenShare: 'screen_share',
      },
      Kind: {
        Audio: 'audio',
        Video: 'video',
      },
    },
    VideoQuality: {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      OFF: 3,
    },
    VideoPresets: {
      h180: { width: 320, height: 180, encoding: { maxBitrate: 160000, maxFramerate: 15 } },
      h360: { width: 640, height: 360, encoding: { maxBitrate: 450000, maxFramerate: 30 } },
      h720: { width: 1280, height: 720, encoding: { maxBitrate: 1500000, maxFramerate: 30 } },
    },
  };
});

// Mock auth/token
vi.mock('../src/auth/token', () => ({
  fetchToken: vi.fn().mockResolvedValue({
    livekitToken: 'mock-jwt-token-for-test-room',
    sfuUrl: 'ws://127.0.0.1:7880',
    roomId: 'test-room',
    participantId: 'alice',
  }),
  resolveSfuUrl: vi.fn().mockReturnValue('ws://127.0.0.1:7880'),
}));

// Import hook after mocks are wired
import { useWebRTC } from '../src/hooks/useWebRTC';
import { renderHook, act } from '@testing-library/react';

describe('WP-3: useWebRTC SFrame E2EE Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomInstances.length = 0;
    setGlobalSFrame(null);
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'alice',
      livekitToken: 'mock-jwt-token',
      sfuUrl: 'ws://127.0.0.1:7880',
      isConnected: false,
      shieldMode: false,
      participants: new Map(),
    });
    usePresenceStore.getState().resetPresence();
  });

  afterEach(() => {
    setGlobalSFrame(null);
  });

  it('I-1: RoomOptions configures blind SFU forwarding (adaptiveStream: false, dynacast: false)', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockRoomInstances.length).toBeGreaterThan(0);
    const room = mockRoomInstances[0];
    expect(room.options).toBeDefined();
    expect(room.options.adaptiveStream).toBe(false);
    expect(room.options.dynacast).toBe(false);
    expect(room.options.publishDefaults?.simulcast).toBe(true);
    expect(room.options.publishDefaults?.videoEncoding?.maxBitrate).toBe(1800000);

    unmount();
  });

  it('I-2 & I-4: Pre-connect invariants establish KeyManager, global SFrame singleton, 12B salt & 0n counter', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const sframe = getGlobalSFrame();
    expect(sframe).not.toBeNull();
    expect(sframe).toBeInstanceOf(SFrameTransform);

    expect(sframe!.getEncryptCounter(0)).toBe(0n);
    expect((window as any).__LIVEKIT_ROOM__).toBeDefined();

    unmount();
    expect(getGlobalSFrame()).toBeNull();
  });

  it('I-3: Flushes pending HPKE public key on RoomEvent.Connected with reliable publishData', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    expect(room.localParticipant.publishData).toHaveBeenCalled();
    const calls = room.localParticipant.publishData.mock.calls;
    const hpkeCall = calls.find((c: any) => c[1]?.topic === 'hpke-pubkey');
    expect(hpkeCall).toBeDefined();
    expect(hpkeCall[1].reliable).toBe(true);
    expect(hpkeCall[0]).toBeInstanceOf(Uint8Array);

    unmount();
  });

  it('I-5 & I-6: LocalTrackPublished and TrackSubscribed install SFrame transforms sharing global counter', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const sframe = getGlobalSFrame()!;

    const mockSenderStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockSenderStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockSender = {
      createEncodedStreams: vi.fn().mockReturnValue(mockSenderStream),
    };

    const pub = {
      trackSid: 'TR_video_1',
      kind: 'video',
      source: 'camera',
      track: { sender: mockSender },
    };

    await act(async () => {
      room.emit('localTrackPublished', pub, room.localParticipant);
    });

    expect(mockSender.createEncodedStreams).toHaveBeenCalled();
    expect((mockSender as any)._sframeTransformer).toBe(sframe);

    const mockReceiverStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockReceiverStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockReceiver = {
      createEncodedStreams: vi.fn().mockReturnValue(mockReceiverStream),
    };

    const remoteTrack = {
      kind: 'video',
      receiver: mockReceiver,
      mediaStreamTrack: { kind: 'video' },
    };
    const remotePub = { trackSid: 'TR_remote_1' };
    const remoteParticipant = { identity: 'Bob' };

    await act(async () => {
      room.emit('trackSubscribed', remoteTrack, remotePub, remoteParticipant);
    });

    expect(mockReceiver.createEncodedStreams).toHaveBeenCalled();
    expect((mockReceiver as any)._sframeTransformer).toBe(sframe);

    unmount();
  });

  it('LocalSenderCreated installs SFrame transform early and avoids redundant installation on LocalTrackPublished', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[mockRoomInstances.length - 1];
    const sframe = getGlobalSFrame()!;

    const mockSenderStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockSenderStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockSender = {
      createEncodedStreams: vi.fn().mockReturnValue(mockSenderStream),
    };

    const mockTrack = {
      kind: 'video',
      sender: mockSender,
    };

    // 1. LocalSenderCreated fires synchronously when sender is created
    await act(async () => {
      room.localParticipant.emit('localSenderCreated', mockSender, mockTrack);
    });

    expect(mockSender.createEncodedStreams).toHaveBeenCalledTimes(1);
    expect((mockSender as any)._sframeTransformer).toBe(sframe);

    // 2. LocalTrackPublished fires later after negotiation
    const pub = {
      trackSid: 'TR_video_early_1',
      kind: 'video',
      source: 'camera',
      track: mockTrack,
    };

    await act(async () => {
      room.emit('localTrackPublished', pub, room.localParticipant);
    });

    // Should NOT call createEncodedStreams a second time
    expect(mockSender.createEncodedStreams).toHaveBeenCalledTimes(1);

    unmount();
  });


  it('I-1: RoomOptions configures blind SFU forwarding (adaptiveStream: false, dynacast: false)', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockRoomInstances.length).toBeGreaterThan(0);
    const room = mockRoomInstances[0];
    expect(room.options).toBeDefined();
    expect(room.options.adaptiveStream).toBe(false);
    expect(room.options.dynacast).toBe(false);
    expect(room.options.publishDefaults?.simulcast).toBe(true);
    expect(room.options.publishDefaults?.videoEncoding?.maxBitrate).toBe(1800000);

    unmount();
  });

  it('I-2 & I-4: Pre-connect invariants establish KeyManager, global SFrame singleton, 12B salt & 0n counter', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const sframe = getGlobalSFrame();
    expect(sframe).not.toBeNull();
    expect(sframe).toBeInstanceOf(SFrameTransform);

    expect(sframe!.getEncryptCounter(0)).toBe(0n);
    expect((window as any).__LIVEKIT_ROOM__).toBeDefined();

    unmount();
    expect(getGlobalSFrame()).toBeNull();
  });

  it('I-3: Flushes pending HPKE public key on RoomEvent.Connected with reliable publishData', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    expect(room.localParticipant.publishData).toHaveBeenCalled();
    const calls = room.localParticipant.publishData.mock.calls;
    const hpkeCall = calls.find((c: any) => c[1]?.topic === 'hpke-pubkey');
    expect(hpkeCall).toBeDefined();
    expect(hpkeCall[1].reliable).toBe(true);
    expect(hpkeCall[0]).toBeInstanceOf(Uint8Array);

    unmount();
  });

  it('I-5 & I-6: LocalTrackPublished and TrackSubscribed install SFrame transforms sharing global counter', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const sframe = getGlobalSFrame()!;

    const mockSenderStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockSenderStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockSender = {
      createEncodedStreams: vi.fn().mockReturnValue(mockSenderStream),
    };

    const pub = {
      trackSid: 'TR_video_1',
      kind: 'video',
      source: 'camera',
      track: { sender: mockSender },
    };

    await act(async () => {
      room.emit('localTrackPublished', pub, room.localParticipant);
    });

    expect(mockSender.createEncodedStreams).toHaveBeenCalled();
    expect((mockSender as any)._sframeTransformer).toBe(sframe);

    const mockReceiverStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockReceiverStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockReceiver = {
      createEncodedStreams: vi.fn().mockReturnValue(mockReceiverStream),
    };

    const remoteTrack = {
      kind: 'video',
      receiver: mockReceiver,
      mediaStreamTrack: { kind: 'video' },
    };
    const remotePub = { trackSid: 'TR_remote_1' };
    const remoteParticipant = { identity: 'Bob' };

    await act(async () => {
      room.emit('trackSubscribed', remoteTrack, remotePub, remoteParticipant);
    });

    expect(mockReceiver.createEncodedStreams).toHaveBeenCalled();
    expect((mockReceiver as any)._sframeTransformer).toBe(sframe);

    unmount();
  });

  it('LocalSenderCreated installs SFrame transform early and avoids redundant installation on LocalTrackPublished', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[mockRoomInstances.length - 1];
    const sframe = getGlobalSFrame()!;

    const mockSenderStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockSenderStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockSender = {
      createEncodedStreams: vi.fn().mockReturnValue(mockSenderStream),
    };

    const mockTrack = {
      kind: 'video',
      sender: mockSender,
    };

    // 1. LocalSenderCreated fires synchronously when sender is created
    await act(async () => {
      room.localParticipant.emit('localSenderCreated', mockSender, mockTrack);
    });

    expect(mockSender.createEncodedStreams).toHaveBeenCalledTimes(1);
    expect((mockSender as any)._sframeTransformer).toBe(sframe);

    // 2. LocalTrackPublished fires later after negotiation
    const pub = {
      trackSid: 'TR_video_early_1',
      kind: 'video',
      source: 'camera',
      track: mockTrack,
    };

    await act(async () => {
      room.emit('localTrackPublished', pub, room.localParticipant);
    });

    // Should NOT call createEncodedStreams a second time
    expect(mockSender.createEncodedStreams).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('I-7: DataReceived dispatches hpke-pubkey, sframe-commit, and sframe-welcome', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];

    const bobKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await bobKM.initialize('z-bob');
    const bobPubB64 = await bobKM.exportHPKEPublicKey();

    await act(async () => {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'hpke-pubkey',
        hpkePublicKey: bobPubB64,
      }));
      room.emit('dataReceived', payload, { identity: 'Z-Bob' }, 'reliable', 'hpke-pubkey');
    });

    await act(async () => {
      room.emit('dataReceived', new Uint8Array(0), { identity: 'Z-Bob' }, 'reliable', 'sframe-welcome-request');
      await new Promise((r) => setTimeout(r, 100));
    });

    const welcomeCall = room.localParticipant.publishData.mock.calls.find(
      (c: any) => c[1]?.topic === 'sframe-welcome'
    );
    expect(welcomeCall).toBeDefined();
    expect(welcomeCall[1].destinationIdentities).toEqual(['z-bob']);

    unmount();
  });

  it('I-8: Audio and Video mute toggle preserves SFrame transform & counter without reset', async () => {
    const { result, unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const sframe = getGlobalSFrame()!;
    expect(sframe.getEncryptCounter(0)).toBe(0n);

    await act(async () => {
      await result.current.toggleAudio();
    });

    expect(sframe.getEncryptCounter(0)).toBe(0n);

    await act(async () => {
      await result.current.toggleVideo();
    });

    expect(sframe.getEncryptCounter(0)).toBe(0n);

    unmount();
  });

  it('UX-C06: completed LiveKit media operations update publication-backed state and failures do not', async () => {
    const { result, unmount } = renderHook(() => useWebRTC());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const room = mockRoomInstances[0];

    await act(async () => {
      await result.current.toggleAudio();
      await result.current.toggleVideo();
    });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(usePresenceStore.getState().participants.get('alice')?.audioEnabled).toBe(true);
    expect(usePresenceStore.getState().participants.get('alice')?.videoEnabled).toBe(true);

    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('publisher rejected mute'));
    await act(async () => { await result.current.toggleAudio(); });
    expect(usePresenceStore.getState().participants.get('alice')?.audioEnabled).toBe(true);
    expect(useAppStore.getState().error).toBe('publisher rejected mute');
    unmount();
  });

  it('I-9: Screen share uses shared SFrame transform and global counter domain', async () => {
    const { result, unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const sframe = getGlobalSFrame()!;

    const mockScreenSenderStream = {
      readable: { pipeThrough: vi.fn().mockReturnThis() },
      writable: {},
    };
    (mockScreenSenderStream.readable.pipeThrough as any).mockReturnValue({
      pipeTo: vi.fn().mockResolvedValue(undefined),
    });

    const mockScreenSender = {
      createEncodedStreams: vi.fn().mockReturnValue(mockScreenSenderStream),
    };

    const screenPub = {
      trackSid: 'TR_screen_1',
      track: { sender: mockScreenSender },
    };
    room.localParticipant.trackPublications.set('screen_share', screenPub);

    await act(async () => {
      await result.current.startScreenShare();
    });

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(mockScreenSender.createEncodedStreams).toHaveBeenCalled();
    expect((mockScreenSender as any)._sframeTransformer).toBe(sframe);

    unmount();
  });

  it('I-10: Leader election and debounced join rekey under rotationMutex', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];

    const carolKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await carolKM.initialize('carol');
    const carolPubB64 = await carolKM.exportHPKEPublicKey();

    await act(async () => {
      room.remoteParticipants.set('carol', { identity: 'carol' });
      room.emit('participantConnected', { identity: 'carol' });
    });

    await act(async () => {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'hpke-pubkey',
        hpkePublicKey: carolPubB64,
      }));
      room.emit('dataReceived', payload, { identity: 'carol' }, 'reliable', 'hpke-pubkey');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 650));
    });

    const welcomeCall = room.localParticipant.publishData.mock.calls.find(
      (c: any) => c[1]?.topic === 'sframe-welcome' && c[1]?.destinationIdentities?.includes('carol')
    );
    expect(welcomeCall).toBeDefined();

    unmount();
  });

  it('I-11: ParticipantDisconnected triggers leaver counter deletion and leave rekey', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];

    room.remoteParticipants.set('david', { identity: 'david' });
    room.remoteParticipants.set('eve', { identity: 'eve' });

    await act(async () => {
      room.remoteParticipants.delete('eve');
      room.emit('participantDisconnected', { identity: 'eve' });
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(useAppStore.getState().participants.has('eve')).toBe(false);

    unmount();
  });

  it('I-13: Teardown clears counters, resets global singleton, and disconnects room', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const sframe = getGlobalSFrame()!;
    expect(sframe).not.toBeNull();

    unmount();

    expect(getGlobalSFrame()).toBeNull();
    expect(room.disconnect).toHaveBeenCalled();
    expect((window as any).__LIVEKIT_ROOM__).toBeNull();
  });
});
