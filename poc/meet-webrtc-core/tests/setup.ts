// tests/setup.ts
import { vi } from 'vitest';

// Mock WebRTC APIs
Object.defineProperty(global, 'RTCPeerConnection', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: '' }),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: '' }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    addTransceiver: vi.fn().mockReturnValue({ sender: { replaceTrack: vi.fn() } }),
    getSenders: vi.fn().mockReturnValue([]),
    getReceivers: vi.fn().mockReturnValue([]),
    close: vi.fn(),
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    ontrack: null,
    onicecandidate: null,
    onnegotiationneeded: null,
    connectionState: 'connected',
    iceConnectionState: 'connected',
  })),
});

Object.defineProperty(global, 'MediaStream', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    getTracks: vi.fn().mockReturnValue([]),
    getAudioTracks: vi.fn().mockReturnValue([]),
    getVideoTracks: vi.fn().mockReturnValue([]),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  })),
});

Object.defineProperty(global, 'MediaStreamTrack', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    enabled: true,
    kind: 'video',
    stop: vi.fn(),
  })),
});

import { webcrypto } from 'node:crypto';

const existingNavigator = (global as any).navigator || {};
Object.defineProperty(global, 'navigator', {
  writable: true,
  value: {
    ...existingNavigator,
    userAgent: existingNavigator.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  },
});

Object.defineProperty(global, 'crypto', {
  writable: true,
  value: webcrypto,
});

Object.defineProperty(global, 'WebSocket', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  })),
});

Object.defineProperty(global, 'Worker', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  })),
});

Object.defineProperty(global, 'OffscreenCanvas', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    width: 0,
    height: 0,
    getContext: vi.fn(),
  })),
});

Object.defineProperty(global, 'VideoFrame', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    codedWidth: 0,
    codedHeight: 0,
    format: 'I420',
    timestamp: 0,
    close: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Silence console errors in tests
const originalError = console.error;
console.error = (...args) => {
  if (args[0]?.includes?.('Warning: ReactDOM.render is no longer supported')) return;
  originalError.apply(console, args);
};