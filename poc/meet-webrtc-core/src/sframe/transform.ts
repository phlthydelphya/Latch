/**
 * SFrame Transform - RFC 9605 Implementation
 * Primary: WebRTC Encoded Transform (Insertable Streams)
 * Fallback: WASM wasm-sframe in OffscreenCanvas worker
 */

import type { SFrameCipherSuite, SFrameHeader, KeyRatchetConfig } from '../types.js';
import { SFRAME_CIPHER_SUITES } from '../types.js';
import { KeyManager } from '../keys/manager.js';

export interface SFrameTransformConfig {
  keyManager: KeyManager;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  getCurrentKID: () => number;
  useWASM?: boolean;
  wasmModulePath?: string;
}

export interface EncodedFrame {
  data: ArrayBuffer;
  timestamp: number;
  ssrc: number;
  payloadType: number;
  sequenceNumber: number;
  marker: boolean;
  decryptError?: boolean;
}

export class SFrameTransform {
  private keyManager: KeyManager;
  private cipherSuite: SFrameCipherSuite;
  private getCurrentKID: () => number;
  private useWASM: boolean;
  private wasmModule: any = null;
  private encryptCounter: Map<number, bigint> = new Map(); // KID -> counter
  private decryptCounters: Map<string, bigint> = new Map(); // senderId:KID -> counter

  constructor(config: SFrameTransformConfig) {
    this.keyManager = config.keyManager;
    this.cipherSuite = SFRAME_CIPHER_SUITES[config.cipherSuite];
    this.getCurrentKID = config.getCurrentKID;
    this.useWASM = config.useWASM || false;
    
    if (this.useWASM && config.wasmModulePath) {
      this.loadWASM(config.wasmModulePath);
    }
  }

  private async loadWASM(path: string): Promise<void> {
    try {
      const wasmModule = await import(/* @vite-ignore */ path);
      this.wasmModule = await wasmModule.default();
      console.log('WASM SFrame module loaded');
    } catch (error) {
      console.error('Failed to load WASM SFrame:', error);
      throw error;
    }
  }

  // ==================== SENDER TRANSFORM ====================

  createSenderTransformer(): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        try {
          const encryptedFrame = await this.encryptFrame(frame);
          controller.enqueue(encryptedFrame);
        } catch (error) {
          console.error('SFrame encryption failed:', error);
          controller.error(error);
        }
      },
    });
  }

  private async encryptFrame(frame: EncodedFrame): Promise<EncodedFrame> {
    const kid = this.getCurrentKID();
    const senderKey = await this.keyManager.getCurrentSenderKey();
    
    if (!senderKey) {
      throw new Error('No sender key available for encryption');
    }

    // Get/increment counter for this KID
    let counter = this.encryptCounter.get(kid) || 0n;
    this.encryptCounter.set(kid, counter + 1n);

    // Build SFrame header
    const header = this.buildHeader(kid, counter);
    
    // Encrypt payload
    const encryptedPayload = await this.encryptPayload(frame.data, senderKey, kid, counter);
    
    // Combine header + encrypted payload
    const encryptedData = this.combineHeaderAndPayload(header, encryptedPayload);

    return {
      ...frame,
      data: encryptedData,
    };
  }

  private buildHeader(kid: number, counter: bigint): Uint8Array {
    // SFrame header: KID (varint) + CTR (varint)
    // Simplified varint encoding
    const kidBytes = this.encodeVarint(kid);
    const ctrBytes = this.encodeVarintBigInt(counter);
    
    const header = new Uint8Array(kidBytes.length + ctrBytes.length);
    header.set(kidBytes, 0);
    header.set(ctrBytes, kidBytes.length);
    
    return header;
  }

  private encodeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    bytes.push(value);
    return new Uint8Array(bytes);
  }

  private encodeVarintBigInt(value: bigint): Uint8Array {
    const bytes: number[] = [];
    while (value >= 0x80n) {
      bytes.push(Number((value & 0x7fn) | 0x80n));
      value >>= 7n;
    }
    bytes.push(Number(value));
    return new Uint8Array(bytes);
  }

  private async encryptPayload(
    data: ArrayBuffer, 
    key: CryptoKey, 
    kid: number, 
    counter: bigint
  ): Promise<ArrayBuffer> {
    if (this.useWASM && this.wasmModule) {
      return this.wasmEncrypt(data, key, kid, counter);
    }
    
    // Web Crypto API encryption
    const iv = this.deriveIV(kid, counter);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: this.cipherSuite.tagLen * 8 },
      key,
      data
    );
    
    return ciphertext;
  }

  private async wasmEncrypt(
    data: ArrayBuffer, 
    key: CryptoKey, 
    kid: number, 
    counter: bigint
  ): Promise<ArrayBuffer> {
    // Export key for WASM
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    const result = this.wasmModule.encrypt(
      new Uint8Array(data),
      new Uint8Array(keyBytes),
      kid,
      counter
    );
    return result.buffer;
  }

  private deriveIV(kid: number, counter: bigint): Uint8Array<ArrayBuffer> {
    // SFrame IV = salt XOR (KID || CTR) - simplified
    const salt = new Uint8Array(this.cipherSuite.saltLen);
    // In real impl, salt comes from key derivation
    const kidBytes = new Uint8Array(4);
    new DataView(kidBytes.buffer).setUint32(0, kid, false);
    
    const ctrBytes = new Uint8Array(8);
    new DataView(ctrBytes.buffer).setBigUint64(0, counter, false);
    
    const iv = new Uint8Array(this.cipherSuite.saltLen);
    for (let i = 0; i < iv.length; i++) {
      const kidByte = kidBytes[i % kidBytes.length];
      const ctrByte = ctrBytes[i % ctrBytes.length];
      iv[i] = salt[i] ^ kidByte ^ ctrByte;
    }
    
    return iv;
  }

  private combineHeaderAndPayload(header: Uint8Array, payload: ArrayBuffer): ArrayBuffer {
    const combined = new Uint8Array(header.length + payload.byteLength);
    combined.set(header, 0);
    combined.set(new Uint8Array(payload), header.length);
    return combined.buffer;
  }

  // ==================== RECEIVER TRANSFORM ====================

  createReceiverTransformer(): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        try {
          const decryptedFrame = await this.decryptFrame(frame);
          controller.enqueue(decryptedFrame);
        } catch (error) {
          console.error('SFrame decryption failed:', error);
          // Forward undecrypted frame with error flag for debugging
          controller.enqueue({ ...frame, data: frame.data, decryptError: true });
        }
      },
    });
  }

  private async decryptFrame(frame: EncodedFrame): Promise<EncodedFrame> {
    // Parse SFrame header
    const { header, payload, kid, counter } = this.parseHeader(frame.data);
    
    // Get sender key for this KID
    // In real impl, we'd map KID to senderId via signaling
    const senderId = this.getSenderIdForKID(kid);
    const senderKey = this.keyManager.getSenderKey(senderId, kid);
    
    if (!senderKey) {
      throw new Error(`No sender key for KID ${kid}, sender ${senderId}`);
    }

    // Check replay protection
    const counterKey = `${senderId}:${kid}`;
    const lastCounter = this.decryptCounters.get(counterKey) || 0n;
    
    if (counter <= lastCounter) {
      throw new Error(`Replay detected: counter ${counter} <= ${lastCounter}`);
    }
    this.decryptCounters.set(counterKey, counter);

    // Decrypt payload
    const decryptedPayload = await this.decryptPayload(payload, senderKey, kid, counter);

    return {
      ...frame,
      data: decryptedPayload,
    };
  }

  private parseHeader(data: ArrayBuffer): { header: Uint8Array; payload: ArrayBuffer; kid: number; counter: bigint } {
    const view = new Uint8Array(data);
    let offset = 0;
    
    // Parse KID varint
    let kid = 0;
    let shift = 0;
    while (true) {
      const byte = view[offset++];
      kid |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    
    // Parse CTR varint
    let counter = 0n;
    shift = 0;
    while (true) {
      const byte = view[offset++];
      counter |= (BigInt(byte & 0x7f) << BigInt(shift));
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    
    const header = view.slice(0, offset);
    const payload = view.slice(offset).buffer;
    
    return { header, payload, kid, counter };
  }

  private getSenderIdForKID(kid: number): string {
    // In real implementation, this maps KID to senderId via signaling
    // For POC, we use a simple mapping
    return `sender-${kid}`;
  }

  private async decryptPayload(
    data: ArrayBuffer, 
    key: CryptoKey, 
    kid: number, 
    counter: bigint
  ): Promise<ArrayBuffer> {
    if (this.useWASM && this.wasmModule) {
      return this.wasmDecrypt(data, key, kid, counter);
    }
    
    const iv = this.deriveIV(kid, counter);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: this.cipherSuite.tagLen * 8 },
      key,
      data
    );
    
    return plaintext;
  }

  private async wasmDecrypt(
    data: ArrayBuffer, 
    key: CryptoKey, 
    kid: number, 
    counter: bigint
  ): Promise<ArrayBuffer> {
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    const result = this.wasmModule.decrypt(
      new Uint8Array(data),
      new Uint8Array(keyBytes),
      kid,
      counter
    );
    return result.buffer;
  }

  // ==================== UTILITIES ====================

  async rotateKey(newEpochSecret: CryptoKey): Promise<void> {
    await this.keyManager.rotateEpoch('manual');
    // Reset counters on key rotation
    this.encryptCounter.clear();
    this.decryptCounters.clear();
  }

  getCipherSuite(): SFrameCipherSuite {
    return this.cipherSuite;
  }

  isUsingWASM(): boolean {
    return this.useWASM;
  }
}

// ==================== WASM WORKER (OffscreenCanvas) ====================

export const wasmWorkerCode = `
/**
 * wasm-sframe Worker for OffscreenCanvas
 * Runs SFrame encryption/decryption off main thread
 * Budget: 150KB WASM, VideoFrame recycle
 */

let sframeModule = null;
let keyCache = new Map();

// Initialize WASM module
async function initWASM(wasmUrl) {
  const response = await fetch(wasmUrl);
  const bytes = await response.arrayBuffer();
  const module = await WebAssembly.instantiate(bytes, {
    env: {
      memory: new WebAssembly.Memory({ initial: 10, maximum: 100 }),
      // Import crypto.getRandomValues for key generation
      crypto_getRandomValues: (ptr, len) => {
        const arr = new Uint8Array(memory.buffer, ptr, len);
        crypto.getRandomValues(arr);
      },
    },
  });
  sframeModule = module.instance.exports;
  return true;
}

// Encrypt frame using WASM
function encryptFrame(frameData, key, kid, counter) {
  // Allocate memory in WASM
  const framePtr = sframeModule.malloc(frameData.length);
  const keyPtr = sframeModule.malloc(key.length);
  const outPtr = sframeModule.malloc(frameData.length + 32); // header + tag
  
  // Copy data
  const memory = new Uint8Array(sframeModule.memory.buffer);
  memory.set(new Uint8Array(frameData), framePtr);
  memory.set(key, keyPtr);
  
  // Call encrypt
  const result = sframeModule.sframe_encrypt(framePtr, frameData.length, keyPtr, key.length, kid, counter, outPtr);
  
  if (result < 0) {
    throw new Error('WASM encryption failed: ' + result);
  }
  
  // Read result
  const output = new Uint8Array(memory.buffer, outPtr, result);
  const outputCopy = output.slice(); // Copy out of WASM memory
  
  // Free memory
  sframeModule.free(framePtr);
  sframeModule.free(keyPtr);
  sframeModule.free(outPtr);
  
  return outputCopy.buffer;
}

// Decrypt frame using WASM
function decryptFrame(frameData, key, kid, counter) {
  const framePtr = sframeModule.malloc(frameData.length);
  const keyPtr = sframeModule.malloc(key.length);
  const outPtr = sframeModule.malloc(frameData.length);
  
  const memory = new Uint8Array(sframeModule.memory.buffer);
  memory.set(new Uint8Array(frameData), framePtr);
  memory.set(key, keyPtr);
  
  const result = sframeModule.sframe_decrypt(framePtr, frameData.length, keyPtr, key.length, kid, counter, outPtr);
  
  if (result < 0) {
    throw new Error('WASM decryption failed: ' + result);
  }
  
  const output = new Uint8Array(memory.buffer, outPtr, result);
  const outputCopy = output.slice();
  
  sframeModule.free(framePtr);
  sframeModule.free(keyPtr);
  sframeModule.free(outPtr);
  
  return outputCopy.buffer;
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { type, id, payload } = event.data;
  
  try {
    let result;
    switch (type) {
      case 'init':
        await initWASM(payload.wasmUrl);
        result = { success: true };
        break;
      case 'encrypt':
        result = encryptFrame(payload.frameData, payload.key, payload.kid, payload.counter);
        break;
      case 'decrypt':
        result = decryptFrame(payload.frameData, payload.key, payload.kid, payload.counter);
        break;
      case 'rotate-key':
        // Key rotation handled by main thread
        result = { success: true };
        break;
      default:
        throw new Error('Unknown message type: ' + type);
    }
    
    self.postMessage({ id, type: 'response', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error.message });
  }
};

// VideoFrame recycling for performance
const framePool = [];
function getRecycledFrame(width, height, format) {
  if (framePool.length > 0) {
    const frame = framePool.pop();
    if (frame.codedWidth === width && frame.codedHeight === height && frame.format === format) {
      return frame;
    }
  }
  return new VideoFrame(new Uint8Array(width * height * 1.5), { codedWidth: width, codedHeight: height, format });
}

function recycleFrame(frame) {
  if (framePool.length < 10) { // Limit pool size
    framePool.push(frame);
  } else {
    frame.close();
  }
}
`;

export class WASMSFrameWorker {
  private worker: Worker | null = null;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private requestId = 0;

  async initialize(wasmUrl: string): Promise<void> {
    this.worker = new Worker(URL.createObjectURL(new Blob([wasmWorkerCode], { type: 'application/javascript' })));
    
    this.worker.onmessage = (event) => {
      const { id, type, result, error } = event.data;
      const request = this.pendingRequests.get(id);
      if (!request) return;
      
      this.pendingRequests.delete(id);
      
      if (type === 'response') {
        request.resolve(result);
      } else if (type === 'error') {
        request.reject(new Error(error));
      }
    };
    
    this.worker.onerror = (error) => {
      console.error('WASM worker error:', error);
    };
    
    // Initialize WASM
    await this.sendMessage('init', { wasmUrl });
  }

  async encrypt(frameData: ArrayBuffer, key: CryptoKey, kid: number, counter: bigint): Promise<ArrayBuffer> {
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    return this.sendMessage('encrypt', { frameData, key: keyBytes, kid, counter });
  }

  async decrypt(frameData: ArrayBuffer, key: CryptoKey, kid: number, counter: bigint): Promise<ArrayBuffer> {
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    return this.sendMessage('decrypt', { frameData, key: keyBytes, kid, counter });
  }

  private sendMessage(type: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type, payload });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('WASM worker timeout'));
        }
      }, 5000);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}