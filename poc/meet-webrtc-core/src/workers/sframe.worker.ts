// SFrame WASM Worker — OffscreenCanvas + VideoFrame recycling
// Budget: 150KB WASM, async load, integrity hash verified

/// <reference lib="webworker" />

interface WASMModule {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  sframe_encrypt: (framePtr: number, frameLen: number, keyPtr: number, keyLen: number, kid: number, counter: bigint, outPtr: number) => number;
  sframe_decrypt: (framePtr: number, frameLen: number, keyPtr: number, keyLen: number, kid: number, counter: bigint, outPtr: number) => number;
}

let wasmModule: WASMModule | null = null;
const framePool: VideoFrame[] = [];
const MAX_POOL_SIZE = 10;

// WASM integrity hash (SHA-384) - update when WASM rebuilds
const WASM_INTEGRITY = 'sha384-placeholder-replace-on-build';

async function initWASM(wasmUrl: string): Promise<boolean> {
  try {
    const response = await fetch(wasmUrl, { integrity: WASM_INTEGRITY });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const bytes = await response.arrayBuffer();
    const imports = {
      env: {
        memory: new WebAssembly.Memory({ initial: 10, maximum: 100 }),
        crypto_getRandomValues: (ptr: number, len: number) => {
          const arr = new Uint8Array(wasmModule!.memory.buffer, ptr, len);
          crypto.getRandomValues(arr);
        },
      },
    };
    
    const module = await WebAssembly.instantiate(bytes, imports);
    wasmModule = module.instance.exports as unknown as WASMModule;
    return true;
  } catch (error) {
    console.error('[WASM Worker] Init failed:', error);
    return false;
  }
}

function getRecycledFrame(width: number, height: number, format: VideoPixelFormat = 'I420'): VideoFrame {
  for (let i = framePool.length - 1; i >= 0; i--) {
    const frame = framePool[i];
    if (frame.codedWidth === width && frame.codedHeight === height && frame.format === format) {
      framePool.splice(i, 1);
      return frame;
    }
  }
  const buffer = new Uint8Array(width * height * 1.5);
  return new VideoFrame(buffer, { codedWidth: width, codedHeight: height, format, timestamp: 0 });
}

function recycleFrame(frame: VideoFrame): void {
  if (framePool.length < MAX_POOL_SIZE) {
    framePool.push(frame);
  } else {
    frame.close();
  }
}

function encryptFrame(frameData: Uint8Array, key: Uint8Array, kid: number, counter: bigint): Uint8Array {
  if (!wasmModule) throw new Error('WASM not initialized');
  
  const framePtr = wasmModule.malloc(frameData.length);
  const keyPtr = wasmModule.malloc(key.length);
  const outPtr = wasmModule.malloc(frameData.length + 32);
  
  const memory = new Uint8Array(wasmModule.memory.buffer);
  memory.set(frameData, framePtr);
  memory.set(key, keyPtr);
  
  const result = wasmModule.sframe_encrypt(framePtr, frameData.length, keyPtr, key.length, kid, counter, outPtr);
  
  if (result < 0) {
    wasmModule.free(framePtr);
    wasmModule.free(keyPtr);
    wasmModule.free(outPtr);
    throw new Error('WASM encryption failed: ' + result);
  }
  
  const output = new Uint8Array(memory.buffer, outPtr, result);
  const outputCopy = output.slice();
  
  wasmModule.free(framePtr);
  wasmModule.free(keyPtr);
  wasmModule.free(outPtr);
  
  return outputCopy;
}

function decryptFrame(frameData: Uint8Array, key: Uint8Array, kid: number, counter: bigint): Uint8Array {
  if (!wasmModule) throw new Error('WASM not initialized');
  
  const framePtr = wasmModule.malloc(frameData.length);
  const keyPtr = wasmModule.malloc(key.length);
  const outPtr = wasmModule.malloc(frameData.length);
  
  const memory = new Uint8Array(wasmModule.memory.buffer);
  memory.set(frameData, framePtr);
  memory.set(key, keyPtr);
  
  const result = wasmModule.sframe_decrypt(framePtr, frameData.length, keyPtr, key.length, kid, counter, outPtr);
  
  if (result < 0) {
    wasmModule.free(framePtr);
    wasmModule.free(keyPtr);
    wasmModule.free(outPtr);
    throw new Error('WASM decryption failed: ' + result);
  }
  
  const output = new Uint8Array(memory.buffer, outPtr, result);
  const outputCopy = output.slice();
  
  wasmModule.free(framePtr);
  wasmModule.free(keyPtr);
  wasmModule.free(outPtr);
  
  return outputCopy;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, payload } = event.data;
  
  try {
    let result: unknown;
    
    switch (type) {
      case 'init':
        const success = await initWASM(payload.wasmUrl);
        result = { success };
        break;
        
      case 'encrypt':
        result = encryptFrame(payload.frameData, payload.key, payload.kid, payload.counter);
        break;
        
      case 'decrypt':
        result = decryptFrame(payload.frameData, payload.key, payload.kid, payload.counter);
        break;
        
      case 'recycle-frame':
        if (payload.frame) recycleFrame(payload.frame);
        result = { success: true };
        break;
        
      default:
        throw new Error('Unknown message type: ' + type);
    }
    
    self.postMessage({ id, type: 'response', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};

// Export for type checking
export {};