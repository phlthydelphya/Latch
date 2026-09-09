let activeRegistration: ServiceWorkerRegistration | null = null;
let updateAvailable = false;

export async function initSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      type: 'module',
      scope: '/',
    });
    activeRegistration = registration;

    // Check if there is already a worker waiting from a previous session
    if (registration.waiting && navigator.serviceWorker.controller) {
      updateAvailable = true;
      dispatchSWUpdateEvent();
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - prompt user
          updateAvailable = true;
          dispatchSWUpdateEvent();
        }
      });
    });

    // Check for updates periodically (every 60 min)
    setInterval(() => {
      registration.update().catch(console.error);
    }, 60 * 60 * 1000);

    // Also trigger update check immediately on tab focus / visibilitychange
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    }

    // When the new worker takes control (after SKIP_WAITING), reload smoothly
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });

    console.log('[SW] Registered:', registration.scope);
  } catch (error) {
    console.error('[SW] Registration failed:', error);
  }
}

function dispatchSWUpdateEvent(): void {
  const event = new CustomEvent('sw-update', { detail: { timestamp: Date.now() } });
  window.dispatchEvent(event);
}

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

export function onSWUpdate(handler: () => void): () => void {
  window.addEventListener('sw-update', handler);
  // If update is already known available at registration time, notify listener immediately
  if (updateAvailable) {
    setTimeout(handler, 0);
  }
  return () => window.removeEventListener('sw-update', handler);
}

export async function checkForUpdate(): Promise<boolean> {
  if (!activeRegistration) {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      activeRegistration = reg ?? null;
    }
  }
  if (activeRegistration) {
    await activeRegistration.update();
    return Boolean(activeRegistration.waiting);
  }
  return false;
}

export async function applySWUpdate(): Promise<void> {
  const registration = activeRegistration || (await navigator.serviceWorker.ready);
  if (registration && registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    // If waiting worker reference wasn't immediate, reload directly
    window.location.reload();
  }
}

// WASM SFrame Worker Registration (lazy loaded)
export async function initWASMWorker(): Promise<Worker | null> {
  if (!('serviceWorker' in navigator) || !window.Worker) return null;

  try {
    const worker = new Worker(new URL('./workers/sframe.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sframe-worker',
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WASM worker init timeout')), 10000);
      
      worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      };
      
      worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      worker.postMessage({ type: 'init', payload: { wasmUrl: '/wasm/sframe.wasm' } });
    });

    return worker;
  } catch (error) {
    console.warn('[WASM] Worker initialization failed, using main-thread fallback:', error);
    return null;
  }
}