// Service Worker Registration & Update Handling

export async function initSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      type: 'module',
      scope: '/',
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - prompt user
          dispatchSWUpdateEvent();
        }
      });
    });

    // Check for updates periodically
    setInterval(() => {
      registration.update().catch(console.error);
    }, 60 * 60 * 1000); // 1 hour

    console.log('[SW] Registered:', registration.scope);
  } catch (error) {
    console.error('[SW] Registration failed:', error);
  }
}

function dispatchSWUpdateEvent(): void {
  const event = new CustomEvent('sw-update', { detail: { timestamp: Date.now() } });
  window.dispatchEvent(event);
}

export function onSWUpdate(handler: () => void): () => void {
  window.addEventListener('sw-update', handler);
  return () => window.removeEventListener('sw-update', handler);
}

export async function applySWUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
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