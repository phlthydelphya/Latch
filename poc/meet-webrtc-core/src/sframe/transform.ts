/**
 * SFrame Transform - RFC 9605 Implementation (v2.1 Global Sender Counter)
 * Primary: WebRTC Encoded Transform (Insertable Streams)
 * Fallback: WASM wasm-sframe in OffscreenCanvas worker
 *
 * Security Invariant (T-01 Nonce Reuse Mitigation):
 * IV = salt(12B) XOR BE64(counter) (injective in counter for fixed salt).
 * KID is in additionalData (AAD), NOT in IV.
 * A single monotonic counter is maintained per (epoch, canonicalSenderId)
 * and shared across all local tracks (audio, video, screen-share).
 */

import type { SFrameCipherSuite, SFrameHeader, KeyRatchetConfig } from '../types.js';
import { SFRAME_CIPHER_SUITES } from '../types.js';
import { KeyManager } from '../keys/manager.js';
import { canonicalizeIdentity } from '../utils/identity.js';
import { AsyncMutex } from '../utils/mutex.js';

export interface SFrameTransformConfig {
  keyManager: KeyManager;
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  getCurrentKID: () => number;
  epochSalt?: Uint8Array | null;
  getEpochSalt?: (kid: number) => Uint8Array | null;
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

/**
 * Derives 12-byte IV for SFrame per RFC9605 §4.7.
 * IV = salt(12B) XOR BE64(counter) (padded to last 8 bytes, first 4 bytes XOR 0).
 * KID is authenticated via additionalData (AAD), NOT placed in IV.
 * Bijective map: for a fixed salt, counter -> IV is injective.
 */
export function deriveIV(salt: Uint8Array, counter: bigint): Uint8Array {
  if (!salt || salt.byteLength !== 12) {
    throw new Error(`salt must be 12B, got ${salt ? salt.byteLength : 0}`);
  }
  if (counter < 0n || counter > 0xFFFFFFFFFFFFFFFFn) {
    throw new Error(`counter out of u64 range: ${counter}`);
  }
  const iv = new Uint8Array(12);
  const ctrBE = new Uint8Array(8);
  new DataView(ctrBE.buffer).setBigUint64(0, counter, false);
  for (let i = 0; i < 12; i++) {
    iv[i] = salt[i] ^ (i < 4 ? 0 : ctrBE[i - 4]);
  }
  return iv;
}

export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  bytes.push(value);
  return new Uint8Array(bytes);
}

export function encodeVarintBigInt(value: bigint): Uint8Array {
  const bytes: number[] = [];
  while (value >= 0x80n) {
    bytes.push(Number((value & 0x7fn) | 0x80n));
    value >>= 7n;
  }
  bytes.push(Number(value));
  return new Uint8Array(bytes);
}

export function buildHeader(kid: number, counter: bigint): Uint8Array {
  const kidBytes = encodeVarint(kid);
  const ctrBytes = encodeVarintBigInt(counter);
  const header = new Uint8Array(kidBytes.length + ctrBytes.length);
  header.set(kidBytes, 0);
  header.set(ctrBytes, kidBytes.length);
  return header;
}

export function parseHeader(data: ArrayBuffer | Uint8Array): {
  header: Uint8Array;
  payload: ArrayBuffer;
  kid: number;
  counter: bigint;
} {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  let offset = 0;

  // Parse KID varint
  let kid = 0;
  let shift = 0;
  while (true) {
    if (offset >= view.length) throw new Error('Truncated SFrame header (KID)');
    const byte = view[offset++];
    kid |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  // Parse CTR varint
  let counter = 0n;
  shift = 0;
  while (true) {
    if (offset >= view.length) throw new Error('Truncated SFrame header (CTR)');
    const byte = view[offset++];
    counter |= (BigInt(byte & 0x7f) << BigInt(shift));
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  const header = view.slice(0, offset);
  const payload = view.slice(offset).buffer;

  return { header, payload, kid, counter };
}

export class SFrameTransform {
  private keyManager: KeyManager;
  private cipherSuite: SFrameCipherSuite;
  private getCurrentKID: () => number;
  private config: SFrameTransformConfig;
  private useWASM: boolean;
  private wasmModule: any = null;

  // GLOBAL sender counter: epoch -> monotonic counter shared across all tracks (audio, video, screen)
  private encryptCounter: Map<number, bigint> = new Map();
  // Receiver replay check: epoch -> (canonicalSenderId -> lastCounter) - NO trackId
  private decryptCounters: Map<number, Map<string, bigint>> = new Map();
  // Mutex for atomic counter increments across concurrent tracks
  public readonly counterMutex: AsyncMutex = new AsyncMutex();

  constructor(config: SFrameTransformConfig) {
    this.config = config;
    this.keyManager = config.keyManager;
    this.cipherSuite = SFRAME_CIPHER_SUITES[config.cipherSuite];
    this.getCurrentKID = config.getCurrentKID;
    this.useWASM = config.useWASM || false;

    // Initialize epoch 0 counter at 0n
    const initialKID = this.getCurrentKID();
    this.encryptCounter.set(initialKID, 0n);

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
    return this.createSenderTransformerWithGlobalCounter(this.counterMutex);
  }

  createSenderTransformerWithGlobalCounter(mutex?: AsyncMutex): TransformStream<EncodedFrame, EncodedFrame> {
    const lock = mutex || this.counterMutex;
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

  async encryptFrame(frame: EncodedFrame, trackKind?: string, trackId?: string): Promise<EncodedFrame> {
    const kid = this.getCurrentKID();
    const senderKey = await this.keyManager.getCurrentSenderKey();

    if (!senderKey) {
      throw new Error('No sender key available for encryption');
    }

    const salt = this.getSaltForKID(kid);
    if (!salt) {
      throw new Error(`No salt available for KID ${kid}`);
    }

    // Atomic getAndIncrement of the global sender counter under mutex
    const counter = await this.counterMutex.run(async () => {
      const current = this.encryptCounter.get(kid) ?? 0n;
      this.encryptCounter.set(kid, current + 1n);
      return current;
    });

    // Build SFrame header: KID (varint) + CTR (varint)
    const header = buildHeader(kid, counter);

    // Encrypt payload with AES-GCM, IV=deriveIV(salt, counter), additionalData=header
    const encryptedPayload = await this.encryptPayload(frame.data, senderKey, salt, counter, header);

    // Combine header + encrypted payload
    const encryptedData = this.combineHeaderAndPayload(header, encryptedPayload);

    return {
      ...frame,
      data: encryptedData,
    };
  }

  /**
   * Helper for testing multi-track interleaving and verifying IV uniqueness.
   */
  async encryptFrameForTest(
    data: Uint8Array,
    kind: 'video' | 'audio' | 'screen',
    trackId: string
  ): Promise<{ iv: Uint8Array; counter: bigint; header: Uint8Array; encryptedData: ArrayBuffer }> {
    const dummyFrame: EncodedFrame = {
      data: (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength),
      timestamp: Date.now(),
      ssrc: 12345,
      payloadType: 96,
      sequenceNumber: 1,
      marker: false,
    };

    const kid = this.getCurrentKID();
    const salt = this.getSaltForKID(kid);
    if (!salt) throw new Error(`No salt for KID ${kid}`);

    const encryptedFrame = await this.encryptFrame(dummyFrame, kind, trackId);
    const { header, counter } = parseHeader(encryptedFrame.data);
    const iv = deriveIV(salt, counter);

    return {
      iv,
      counter,
      header,
      encryptedData: encryptedFrame.data,
    };
  }

  private async encryptPayload(
    data: ArrayBuffer,
    key: CryptoKey,
    salt: Uint8Array,
    counter: bigint,
    header: Uint8Array
  ): Promise<ArrayBuffer> {
    if (this.useWASM && this.wasmModule) {
      const kid = this.getCurrentKID();
      return this.wasmEncrypt(data, key, kid, counter);
    }

    const iv = deriveIV(salt, counter);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        tagLength: this.cipherSuite.tagLen * 8, // 128
        additionalData: header as unknown as BufferSource,
      },
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
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    const result = this.wasmModule.encrypt(
      new Uint8Array(data),
      new Uint8Array(keyBytes),
      kid,
      counter
    );
    return result.buffer;
  }

  private combineHeaderAndPayload(header: Uint8Array, payload: ArrayBuffer): ArrayBuffer {
    const combined = new Uint8Array(header.length + payload.byteLength);
    combined.set(header, 0);
    combined.set(new Uint8Array(payload), header.length);
    return combined.buffer;
  }

  // ==================== RECEIVER TRANSFORM ====================

  createReceiverTransformer(remoteSenderId?: string): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        try {
          const decryptedFrame = await this.decryptFrame(frame, remoteSenderId);
          controller.enqueue(decryptedFrame);
        } catch (error) {
          console.error('SFrame decryption failed:', error);
          // Forward undecrypted frame with error flag for debugging
          controller.enqueue({ ...frame, data: frame.data, decryptError: true });
        }
      },
    });
  }

  async decryptFrame(frame: EncodedFrame, remoteSenderId?: string): Promise<EncodedFrame> {
    // Parse SFrame header
    const { header, payload, kid, counter } = parseHeader(frame.data);

    // Resolve senderId: use provided remoteSenderId or fallback
    const senderId = canonicalizeIdentity(remoteSenderId || this.getSenderIdForKID(kid));
    const senderKey = this.keyManager.getSenderKey(senderId, kid);

    if (!senderKey) {
      throw new Error(`No sender key for KID ${kid}, sender ${senderId}`);
    }

    // Replay check per (epoch, canonicalSenderId) — NOT per track
    let senderCounters = this.decryptCounters.get(kid);
    if (!senderCounters) {
      senderCounters = new Map<string, bigint>();
      this.decryptCounters.set(kid, senderCounters);
    }

    const lastCounter = senderCounters.get(senderId);
    if (lastCounter !== undefined && counter <= lastCounter) {
      throw new Error(`Replay detected: counter ${counter} <= ${lastCounter} for sender ${senderId} epoch ${kid}`);
    }
    senderCounters.set(senderId, counter);

    const salt = this.getSaltForKID(kid);
    if (!salt) {
      throw new Error(`No salt available for KID ${kid}`);
    }

    // Decrypt payload with AES-GCM, IV=deriveIV(salt, counter), additionalData=header
    const decryptedPayload = await this.decryptPayload(payload, senderKey, salt, counter, header);

    return {
      ...frame,
      data: decryptedPayload,
    };
  }

  private getSenderIdForKID(kid: number): string {
    return `sender-${kid}`;
  }

  private async decryptPayload(
    data: ArrayBuffer,
    key: CryptoKey,
    salt: Uint8Array,
    counter: bigint,
    header: Uint8Array
  ): Promise<ArrayBuffer> {
    if (this.useWASM && this.wasmModule) {
      const kid = this.getCurrentKID();
      return this.wasmDecrypt(data, key, kid, counter);
    }

    const iv = deriveIV(salt, counter);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        tagLength: this.cipherSuite.tagLen * 8, // 128
        additionalData: header as unknown as BufferSource,
      },
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

  getSaltForKID(kid: number): Uint8Array | null {
    if (this.config.getEpochSalt) {
      const s = this.config.getEpochSalt(kid);
      if (s) return s;
    }
    if (this.keyManager.getCurrentEpoch() === kid) {
      const s = this.keyManager.getCurrentSalt();
      if (s) return s;
    }
    const prevEpochs = this.keyManager.getPreviousEpochs();
    const prev = prevEpochs.get(kid);
    if (prev?.salt) {
      return prev.salt;
    }
    if (this.config.epochSalt) {
      return this.config.epochSalt;
    }
    return null;
  }

  async rotateKey(newEpochSecret?: CryptoKey): Promise<void> {
    const currentKID = this.getCurrentKID();
    // Reset encryptCounter for new epoch
    this.encryptCounter.set(currentKID, 0n);
    if (!this.decryptCounters.has(currentKID)) {
      this.decryptCounters.set(currentKID, new Map());
    }
  }

  getEncryptCounter(kid: number): bigint | undefined {
    return this.encryptCounter.get(kid);
  }

  getDecryptCounter(kid: number, canonicalSenderId: string): bigint | undefined {
    return this.decryptCounters.get(kid)?.get(canonicalizeIdentity(canonicalSenderId));
  }

  clearCounters(): void {
    this.encryptCounter.clear();
    this.decryptCounters.clear();
  }

  deleteParticipantCounters(canonicalSenderId: string): void {
    const canon = canonicalizeIdentity(canonicalSenderId);
    for (const perEpoch of this.decryptCounters.values()) {
      perEpoch.delete(canon);
    }
  }

  getCipherSuite(): SFrameCipherSuite {
    return this.cipherSuite;
  }

  isUsingWASM(): boolean {
    return this.useWASM;
  }
}

// ==================== FEATURE DETECTION & SHARED HELPERS ====================

export function isEncodedTransformSupported(): boolean {
  if (typeof window === 'undefined') return true;
  return 'RTCEncodedVideoFrame' in window
      && typeof TransformStream !== 'undefined'
      && typeof ReadableStream !== 'undefined';
}

export function hasCreateEncodedStreams(): boolean {
  if (typeof window === 'undefined') return true;
  return typeof RTCRtpSender !== 'undefined'
      && typeof (RTCRtpSender.prototype as any)?.createEncodedStreams === 'function'
      && typeof (RTCRtpReceiver.prototype as any)?.createEncodedStreams === 'function';
}

export function hasScriptTransform(): boolean {
  if (typeof window === 'undefined') return false;
  return 'RTCRtpScriptTransform' in window;
}

let globalSFrame: SFrameTransform | null = null;
let globalCounterMutex: AsyncMutex = new AsyncMutex();

export function getGlobalSFrame(): SFrameTransform | null {
  return globalSFrame;
}

export function setGlobalSFrame(instance: SFrameTransform | null): void {
  globalSFrame = instance;
}

export function getGlobalCounterMutex(): AsyncMutex {
  return globalCounterMutex;
}

export async function installSFrameOnSenderShared(
  sender: any,
  globalSFrameInstance: SFrameTransform,
  mutex: AsyncMutex
): Promise<void> {
  if ((sender as any)._sframeTransformer) return;
  if (typeof sender.createEncodedStreams === 'function') {
    try {
      const { readable, writable } = sender.createEncodedStreams();
      const transformer = globalSFrameInstance.createSenderTransformerWithGlobalCounter(mutex);
      readable.pipeThrough(transformer).pipeTo(writable);
      (sender as any)._sframeTransformer = globalSFrameInstance;
    } catch (e) {
      console.warn('[SFrame] Failed to create or pipe encoded sender streams:', e);
    }
  }
}

export async function installSFrameOnReceiverShared(
  receiver: any,
  globalSFrameInstance: SFrameTransform,
  canonicalParticipantId: string
): Promise<void> {
  if ((receiver as any)._sframeTransformer) return;
  if (typeof receiver.createEncodedStreams === 'function') {
    try {
      const { readable, writable } = receiver.createEncodedStreams();
      const transformer = globalSFrameInstance.createReceiverTransformer(canonicalParticipantId);
      readable.pipeThrough(transformer).pipeTo(writable);
      (receiver as any)._sframeTransformer = globalSFrameInstance;
    } catch (e) {
      console.warn('[SFrame] Failed to create or pipe encoded receiver streams:', e);
    }
  }
}

export async function installSFrameOnSender(
  sender: any,
  keyManager: KeyManager,
  getKID: () => number,
  trackKind: 'audio' | 'video' | 'screen',
  trackId: string,
  epochSalt: Uint8Array
): Promise<void> {
  if (!globalSFrame) {
    globalSFrame = new SFrameTransform({
      keyManager,
      cipherSuite: 'AES_GCM',
      getCurrentKID: getKID,
      epochSalt,
    });
  }
  await installSFrameOnSenderShared(sender, globalSFrame, globalCounterMutex);
}

export async function installSFrameOnReceiver(
  receiver: any,
  keyManager: KeyManager,
  getKID: () => number,
  canonicalParticipantId: string,
  trackKind: 'audio' | 'video',
  trackId: string,
  epochSalt: Uint8Array
): Promise<void> {
  if (!globalSFrame) {
    globalSFrame = new SFrameTransform({
      keyManager,
      cipherSuite: 'AES_GCM',
      getCurrentKID: getKID,
      epochSalt,
    });
  }
  await installSFrameOnReceiverShared(receiver, globalSFrame, canonicalParticipantId);
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
  const framePtr = sframeModule.malloc(frameData.length);
  const keyPtr = sframeModule.malloc(key.length);
  const outPtr = sframeModule.malloc(frameData.length + 32); // header + tag
  
  const memory = new Uint8Array(sframeModule.memory.buffer);
  memory.set(new Uint8Array(frameData), framePtr);
  memory.set(key, keyPtr);
  
  const result = sframeModule.sframe_encrypt(framePtr, frameData.length, keyPtr, key.length, kid, counter, outPtr);
  
  if (result < 0) {
    throw new Error('WASM encryption failed: ' + result);
  }
  
  const output = new Uint8Array(memory.buffer, outPtr, result);
  const outputCopy = output.slice();
  
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
  if (framePool.length < 10) {
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