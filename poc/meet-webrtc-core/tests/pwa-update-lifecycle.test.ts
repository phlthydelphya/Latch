import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('PWA-UPDATE-01: Registers service worker as a CLASSIC script with scope (no type:module)', async () => {
    await initSW();
    // The built Workbox sw.js is a classic script whose UMD shim calls
    // importScripts(). Registering it with { type: 'module' } makes the browser
    // evaluate it as an ES module, where importScripts() is forbidden and throws
    // "Module scripts don't support importScripts()". Classic registration is
    // required; it also matches the vite-plugin-pwa injected registerSW.js so
    // both paths resolve to a single registration.
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
    });
    // Guard against regression: no `type` key must be passed.
    const call = vi.mocked(navigator.serviceWorker.register).mock.calls.at(-1);
    expect(call?.[1]).not.toHaveProperty('type');
  });

  it('PWA-UPDATE-05: source never registers the SW with type:module (regression guard)', () => {
    // Regression guard for the production error
    // "Module scripts don't support importScripts()". Neither the runtime
    // registration module nor the HTML entrypoint may (re)introduce a
    // module-type service worker registration for the classic Workbox sw.js.
    const swRegister = readFileSync(
      join(process.cwd(), 'src', 'sw-register.ts'),
      'utf-8',
    );
    const indexHtml = readFileSync(
      join(process.cwd(), 'index.html'),
      'utf-8',
    );

    // The only `type: 'module'` allowed in sw-register.ts is the WASM Worker
    // (initWASMWorker), NOT the service worker registration. Assert the SW
    // register() call itself carries no module type.
    const swRegisterCall = swRegister.match(
      /serviceWorker\.register\([^)]*\{[\s\S]*?\}\s*\)/,
    )?.[0];
    expect(swRegisterCall).toBeDefined();
    expect(swRegisterCall).not.toMatch(/type\s*:\s*['"]module['"]/);

    // index.html must not inline any module-type SW registration.
    expect(indexHtml).not.toMatch(/serviceWorker\.register\([^)]*type\s*:\s*['"]module['"]/);
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
