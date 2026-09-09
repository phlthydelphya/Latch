import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initSW, onSWUpdate, applySWUpdate, checkForUpdate, isUpdateAvailable } from '../src/sw-register';

describe('PWA Update Lifecycle & Cache Invalidation', () => {
  let mockRegistration: any;
  let listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  beforeEach(() => {
    listeners = {};
    mockRegistration = {
      scope: 'https://localhost:5173/',
      installing: null,
      waiting: null,
      active: { state: 'activated' },
      update: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn((event: string, cb: any) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      }),
    };

    Object.defineProperty(global.navigator, 'serviceWorker', {
      writable: true,
      value: {
        controller: { state: 'activated' },
        register: vi.fn().mockResolvedValue(mockRegistration),
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
        ready: Promise.resolve(mockRegistration),
        addEventListener: vi.fn((event: string, cb: any) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PWA-UPDATE-01: Registers service worker with module type and scope', async () => {
    await initSW();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      type: 'module',
      scope: '/',
    });
  });

  it('PWA-UPDATE-02: Emits sw-update event when new worker reaches installed state', async () => {
    const updateHandler = vi.fn();
    const unsubscribe = onSWUpdate(updateHandler);

    await initSW();

    // Simulate updatefound with a new installing worker
    const workerListeners: Record<string, Function[]> = {};
    const newWorker = {
      state: 'installing',
      addEventListener: vi.fn((event: string, cb: Function) => {
        workerListeners[event] = workerListeners[event] || [];
        workerListeners[event].push(cb);
      }),
    };

    mockRegistration.installing = newWorker;
    if (listeners['updatefound']) {
      listeners['updatefound'].forEach((cb: any) => cb());
    }

    // Trigger statechange to 'installed'
    newWorker.state = 'installed';
    if (workerListeners['statechange']) {
      workerListeners['statechange'].forEach((cb: Function) => cb());
    }

    expect(updateHandler).toHaveBeenCalled();
    expect(isUpdateAvailable()).toBe(true);

    unsubscribe();
  });

  it('PWA-UPDATE-03: applySWUpdate sends SKIP_WAITING to waiting worker', async () => {
    const waitingWorker = {
      postMessage: vi.fn(),
    };
    mockRegistration.waiting = waitingWorker;

    await initSW();
    await applySWUpdate();

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('PWA-UPDATE-04: checkForUpdate polls registration for updates', async () => {
    await initSW();
    const hasWaiting = await checkForUpdate();
    expect(mockRegistration.update).toHaveBeenCalled();
    expect(hasWaiting).toBe(false);
  });
});
