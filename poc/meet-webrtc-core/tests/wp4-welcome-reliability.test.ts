/**
 * @vitest-environment jsdom
 * WP-4 Welcome Reliability Unit & Integration Tests
 *
 * Test Matrix per phase2b-b06-resolution.md and phase2b-sframe-design-v2.1.md:
 * 1. KeyManager AAD verification: processWelcome validates roomId and epoch binding.
 * 2. MetricsCollector: verifies webrtc_welcome_retry_total and webrtc_rotation_contention_total.
 * 3. Leader publishWelcomeWithRetry: resolves immediately on 1st attempt when ACK received.
 * 4. Leader publishWelcomeWithRetry: retries on dropped welcome and resolves on attempt 2.
 * 5. Leader publishWelcomeWithRetry: exhausts 3 retries and falls back to POST /sync.
 * 6. Joiner sframe-welcome-request: emits with exponential backoff (500ms -> 1000ms -> 2000ms).
 * 7. Joiner cancels welcome timer & publishes sframe-welcome-ack upon receiving valid Welcome.
 * 8. Joiner rejects invalid Welcome (AAD mismatch) without cancelling backoff or ACKing.
 * 9. Teardown: cancels welcome timer and rejects pending welcome ACKs cleanly.
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
  setGlobalSFrame,
} from '../src/sframe/transform';
import { useAppStore } from '../src/store/appStore';
import {
  MetricsCollector,
  getGlobalMetricsCollector,
  setGlobalMetricsCollector,
} from '../src/metrics/collector';

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
    setCameraEnabled = vi.fn().mockResolvedValue(undefined);
    setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
    setScreenShareEnabled = vi.fn().mockResolvedValue(undefined);
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

describe('WP-4: Welcome Reliability', { timeout: 25000 }, () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomInstances.length = 0;
    setGlobalSFrame(null);
    originalFetch = globalThis.fetch;

    // Reset global metrics
    const collector = new MetricsCollector({
      enabled: true,
      intervalMs: 2000,
      histogramBuckets: [50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000],
    });
    setGlobalMetricsCollector(collector);

    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'alice',
      livekitToken: 'mock-jwt-token',
      sfuUrl: 'ws://127.0.0.1:7880',
      isConnected: false,
      shieldMode: false,
      participants: new Map(),
    });
  });

  afterEach(() => {
    setGlobalSFrame(null);
    globalThis.fetch = originalFetch;
  });

  // --------------------------------------------------------------------------
  // 1. KeyManager AAD Verification
  // --------------------------------------------------------------------------
  it('KeyManager AAD verification: processWelcome validates roomId and epoch binding', async () => {
    const leaderKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await leaderKM.initialize('alice');

    const joinerKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await joinerKM.initialize('bob');

    const bobPubB64 = await joinerKM.exportHPKEPublicKey();
    const importedBobPub = await leaderKM.importHPKEPublicKey(bobPubB64);
    leaderKM.setParticipantHPKEPublicKey('bob', importedBobPub);

    const welcome = await leaderKM.createWelcome(
      leaderKM.getCurrentEpochSecret()!,
      importedBobPub,
      'test-room',
      0
    );

    // Test 1: Successful adoption with matching roomId and epoch
    const adoptedKey = await joinerKM.processWelcome(welcome, 'test-room', 0);
    expect(adoptedKey).toBeDefined();
    expect(joinerKM.getCurrentEpoch()).toBe(0);

    // Test 2: Mismatched roomId throws (AAD verification failure)
    await expect(joinerKM.processWelcome(welcome, 'different-room', 0)).rejects.toThrow();

    // Test 3: Mismatched epoch throws
    await expect(joinerKM.processWelcome(welcome, 'test-room', 99)).rejects.toThrow(
      /Welcome epoch mismatch/
    );
  });

  // --------------------------------------------------------------------------
  // 2. Metrics: Collector tracking
  // --------------------------------------------------------------------------
  it('MetricsCollector: tracks webrtc_welcome_retry_total and webrtc_rotation_contention_total', () => {
    const metrics = getGlobalMetricsCollector();
    const events: any[] = [];
    metrics.on('metric', (e) => events.push(e));

    metrics.recordWelcomeRetry(1, false);
    metrics.recordWelcomeRetry(2, false);
    metrics.recordWelcomeRetry(4, true);

    expect(metrics.welcomeRetryCount).toBe(3);
    expect(events[0]).toEqual({
      name: 'webrtc_welcome_retry_total',
      value: 1,
      labels: { attempt: '1', fallback: 'false' },
    });
    expect(events[2]).toEqual({
      name: 'webrtc_welcome_retry_total',
      value: 1,
      labels: { attempt: '4', fallback: 'true' },
    });

    metrics.recordRotationContention('join');
    metrics.recordRotationContention('leave');

    expect(metrics.rotationContentionCount).toBe(2);
    expect(events[3]).toEqual({
      name: 'webrtc_rotation_contention_total',
      value: 1,
      labels: { trigger: 'join' },
    });

    const prometheus = metrics.getPrometheusMetrics();
    expect(prometheus).toContain('meet_webrtc_welcome_retry_total 3');
    expect(prometheus).toContain('meet_webrtc_rotation_contention_total 2');

    metrics.reset();
    expect(metrics.welcomeRetryCount).toBe(0);
    expect(metrics.rotationContentionCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 3. Leader publishWelcomeWithRetry immediate ACK resolution
  // --------------------------------------------------------------------------
  it('Leader publishWelcomeWithRetry: resolves immediately on 1st attempt when ACK received', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const metrics = getGlobalMetricsCollector();

    // Set up bob's HPKE public key on the leader
    const bobKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await bobKM.initialize('bob');
    const bobPubB64 = await bobKM.exportHPKEPublicKey();

    await act(async () => {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'hpke-pubkey',
        hpkePublicKey: bobPubB64,
      }));
      room.emit('dataReceived', payload, { identity: 'bob' }, 'reliable', 'hpke-pubkey');
    });

    // When leader publishes welcome, immediately simulate joiner sending back sframe-welcome-ack
    room.localParticipant.publishData = vi.fn().mockImplementation(async (_payload: Uint8Array, opts: any) => {
      if (opts?.topic === 'sframe-welcome') {
        setTimeout(() => {
          room.emit(
            'dataReceived',
            new TextEncoder().encode(JSON.stringify({ type: 'sframe-welcome-ack', epoch: 0 })),
            { identity: 'bob' },
            'reliable',
            'sframe-welcome-ack'
          );
        }, 10);
      }
      return undefined;
    });

    // Bob requests welcome
    await act(async () => {
      room.emit('dataReceived', new Uint8Array(0), { identity: 'bob' }, 'reliable', 'sframe-welcome-request');
      await new Promise((r) => setTimeout(r, 100));
    });

    // Check that sframe-welcome was published exactly once
    const welcomeCalls = room.localParticipant.publishData.mock.calls.filter(
      (c: any) => c[1]?.topic === 'sframe-welcome'
    );
    expect(welcomeCalls.length).toBe(1);
    expect(welcomeCalls[0][1].destinationIdentities).toEqual(['bob']);

    // No retries needed
    expect(metrics.welcomeRetryCount).toBe(0);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 4. Leader publishWelcomeWithRetry retries on dropped welcome and resolves on attempt 2
  // --------------------------------------------------------------------------
  it('Leader publishWelcomeWithRetry: retries on dropped welcome and resolves on attempt 2', async () => {
    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const metrics = getGlobalMetricsCollector();

    const bobKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await bobKM.initialize('bob');
    const bobPubB64 = await bobKM.exportHPKEPublicKey();

    await act(async () => {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'hpke-pubkey',
        hpkePublicKey: bobPubB64,
      }));
      room.emit('dataReceived', payload, { identity: 'bob' }, 'reliable', 'hpke-pubkey');
    });

    let welcomePublishAttempts = 0;
    room.localParticipant.publishData = vi.fn().mockImplementation(async (_payload: Uint8Array, opts: any) => {
      if (opts?.topic === 'sframe-welcome') {
        welcomePublishAttempts++;
        // Attempt 1: drop welcome (no ACK sent)
        // Attempt 2: send ACK after 20ms
        if (welcomePublishAttempts === 2) {
          setTimeout(() => {
            room.emit(
              'dataReceived',
              new TextEncoder().encode(JSON.stringify({ type: 'sframe-welcome-ack', epoch: 0 })),
              { identity: 'bob' },
              'reliable',
              'sframe-welcome-ack'
            );
          }, 20);
        }
      }
      return undefined;
    });

    // Bob requests welcome
    await act(async () => {
      room.emit('dataReceived', new Uint8Array(0), { identity: 'bob' }, 'reliable', 'sframe-welcome-request');
      // Wait for attempt 1 timeout (1500ms) + delay (100ms) + attempt 2 completion (~200ms)
      await new Promise((r) => setTimeout(r, 1900));
    });

    expect(welcomePublishAttempts).toBe(2);
    // 1 retry recorded for attempt 1 timeout
    expect(metrics.welcomeRetryCount).toBe(1);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 5. Leader publishWelcomeWithRetry exhausts retries and falls back to POST /sync
  // --------------------------------------------------------------------------
  it('Leader publishWelcomeWithRetry: exhausts 3 retries and falls back to POST /sync', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;

    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    const metrics = getGlobalMetricsCollector();

    const bobKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await bobKM.initialize('bob');
    const bobPubB64 = await bobKM.exportHPKEPublicKey();

    await act(async () => {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'hpke-pubkey',
        hpkePublicKey: bobPubB64,
      }));
      room.emit('dataReceived', payload, { identity: 'bob' }, 'reliable', 'hpke-pubkey');
    });

    let welcomePublishAttempts = 0;
    room.localParticipant.publishData = vi.fn().mockImplementation(async (_payload: Uint8Array, opts: any) => {
      if (opts?.topic === 'sframe-welcome') {
        welcomePublishAttempts++;
        // Never send ACK -> simulate packet loss
      }
      return undefined;
    });

    // Bob requests welcome
    await act(async () => {
      room.emit('dataReceived', new Uint8Array(0), { identity: 'bob' }, 'reliable', 'sframe-welcome-request');
      // Total duration for 3 retries:
      // Attempt 1: 1500ms timeout + 100ms delay
      // Attempt 2: 1500ms timeout + 300ms delay
      // Attempt 3: 1500ms timeout -> total = 4900ms
      await new Promise((r) => setTimeout(r, 5200));
    });

    expect(welcomePublishAttempts).toBe(3);
    // 3 retries + 1 fallback = 4 recorded metrics
    expect(metrics.welcomeRetryCount).toBe(4);

    // Fallback POST /sync was triggered
    expect(mockFetch).toHaveBeenCalled();
    const syncCall = mockFetch.mock.calls.find((c: any) => c[0] === '/sync');
    expect(syncCall).toBeDefined();
    expect(syncCall[1].method).toBe('POST');
    const body = JSON.parse(syncCall[1].body);
    expect(body.type).toBe('welcome');
    expect(body.roomId).toBe('test-room');
    expect(body.joinerId).toBe('bob');
    expect(body.epoch).toBe(0);
    expect(body.welcome).toBeDefined();

    unmount();
  });

  // --------------------------------------------------------------------------
  // 6. Joiner sframe-welcome-request: exponential backoff
  // --------------------------------------------------------------------------
  it('Joiner sframe-welcome-request: emits with exponential backoff (500ms -> 1000ms -> 2000ms)', async () => {
    // Bob joins as non-leader (alice is remote participant and lexicographically first)
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'bob',
    });

    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    room.localParticipant.identity = 'bob';
    room.remoteParticipants.set('alice', { identity: 'alice' });

    // Emitting connected starts scheduleWelcomeRequest(500)
    await act(async () => {
      room.emit('connected');
      // Wait past 500ms (attempt 1), 1000ms (attempt 2), 2000ms (attempt 3) = ~3800ms
      await new Promise((r) => setTimeout(r, 3800));
    });

    const welcomeRequests = room.localParticipant.publishData.mock.calls.filter(
      (c: any) => c[1]?.topic === 'sframe-welcome-request'
    );

    // Should have emitted at least 3 attempts
    expect(welcomeRequests.length).toBeGreaterThanOrEqual(3);

    const firstPayload = JSON.parse(new TextDecoder().decode(welcomeRequests[0][0]));
    expect(firstPayload.type).toBe('sframe-welcome-request');
    expect(firstPayload.attempt).toBe(1);

    const secondPayload = JSON.parse(new TextDecoder().decode(welcomeRequests[1][0]));
    expect(secondPayload.type).toBe('sframe-welcome-request');
    expect(secondPayload.attempt).toBe(2);

    const thirdPayload = JSON.parse(new TextDecoder().decode(welcomeRequests[2][0]));
    expect(thirdPayload.type).toBe('sframe-welcome-request');
    expect(thirdPayload.attempt).toBe(3);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 7. Joiner cancels welcome timer and sends sframe-welcome-ack upon receiving valid Welcome
  // --------------------------------------------------------------------------
  it('Joiner cancels welcome timer & publishes sframe-welcome-ack upon receiving valid Welcome', async () => {
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'bob',
    });

    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    room.localParticipant.identity = 'bob';
    room.remoteParticipants.set('alice', { identity: 'alice' });

    // Generate valid Welcome from leader alice
    const aliceKM = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await aliceKM.initialize('alice');

    // Get Bob's HPKE public key from the published hpke-pubkey data
    const hpkePubCall = room.localParticipant.publishData.mock.calls.find(
      (c: any) => c[1]?.topic === 'hpke-pubkey'
    );
    expect(hpkePubCall).toBeDefined();
    const bobPubB64 = new TextDecoder().decode(hpkePubCall[0]);
    const importedBobPub = await aliceKM.importHPKEPublicKey(bobPubB64);

    const welcomeBytes = await aliceKM.createWelcome(
      aliceKM.getCurrentEpochSecret()!,
      importedBobPub,
      'test-room',
      0
    );

    await act(async () => {
      room.emit('connected');
      // Wait 100ms (before 500ms welcome request timer fires)
      await new Promise((r) => setTimeout(r, 100));

      // Alice delivers sframe-welcome to bob
      room.emit(
        'dataReceived',
        new TextEncoder().encode(
          JSON.stringify({
            type: 'sframe-welcome',
            epoch: 0,
            welcome: Array.from(welcomeBytes),
          })
        ),
        { identity: 'alice' },
        'reliable',
        'sframe-welcome'
      );

      // Wait past 600ms to ensure backoff timer does NOT fire
      await new Promise((r) => setTimeout(r, 600));
    });

    // Verify Bob published sframe-welcome-ack to alice
    const ackCall = room.localParticipant.publishData.mock.calls.find(
      (c: any) => c[1]?.topic === 'sframe-welcome-ack'
    );
    expect(ackCall).toBeDefined();
    const ackPayload = JSON.parse(new TextDecoder().decode(ackCall[0]));
    expect(ackPayload.type).toBe('sframe-welcome-ack');
    expect(ackPayload.epoch).toBe(0);
    expect(ackCall[1].destinationIdentities).toEqual(['alice']);

    // Verify Bob never sent sframe-welcome-request because timer was cancelled
    const welcomeRequestCalls = room.localParticipant.publishData.mock.calls.filter(
      (c: any) => c[1]?.topic === 'sframe-welcome-request'
    );
    expect(welcomeRequestCalls.length).toBe(0);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 8. Joiner rejects invalid Welcome (AAD mismatch) without cancelling backoff or ACKing
  // --------------------------------------------------------------------------
  it('Joiner rejects invalid Welcome without cancelling backoff or ACKing', async () => {
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'bob',
    });

    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    room.localParticipant.identity = 'bob';
    room.remoteParticipants.set('alice', { identity: 'alice' });

    await act(async () => {
      room.emit('connected');
      await new Promise((r) => setTimeout(r, 50));

      // Deliver corrupted/invalid welcome message
      const fakeCorruptedWelcome = new Uint8Array(128).fill(0xaa);
      room.emit(
        'dataReceived',
        new TextEncoder().encode(
          JSON.stringify({
            type: 'sframe-welcome',
            epoch: 0,
            welcome: Array.from(fakeCorruptedWelcome),
          })
        ),
        { identity: 'alice' },
        'reliable',
        'sframe-welcome'
      );

      // Wait past 600ms so the 500ms welcome request timer still fires
      await new Promise((r) => setTimeout(r, 600));
    });

    // Verify Bob did NOT send sframe-welcome-ack
    const ackCall = room.localParticipant.publishData.mock.calls.find(
      (c: any) => c[1]?.topic === 'sframe-welcome-ack'
    );
    expect(ackCall).toBeUndefined();

    // Verify Bob DID send sframe-welcome-request (backoff was not cancelled)
    const welcomeRequestCalls = room.localParticipant.publishData.mock.calls.filter(
      (c: any) => c[1]?.topic === 'sframe-welcome-request'
    );
    expect(welcomeRequestCalls.length).toBeGreaterThanOrEqual(1);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 9. Teardown: cleans up timers and rejects pending ACKs
  // --------------------------------------------------------------------------
  it('Teardown: cleans up welcome timers and pending ACKs cleanly', async () => {
    useAppStore.setState({
      roomId: 'test-room',
      participantId: 'bob',
    });

    const { unmount } = renderHook(() => useWebRTC());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const room = mockRoomInstances[0];
    room.localParticipant.identity = 'bob';
    room.remoteParticipants.set('alice', { identity: 'alice' });

    await act(async () => {
      room.emit('connected');
      await new Promise((r) => setTimeout(r, 50));
    });

    // Unmount before 500ms timer fires
    unmount();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // No welcome-request should have been published after unmount
    const welcomeRequestCalls = room.localParticipant.publishData.mock.calls.filter(
      (c: any) => c[1]?.topic === 'sframe-welcome-request'
    );
    expect(welcomeRequestCalls.length).toBe(0);
  });
});
