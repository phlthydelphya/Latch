/**
 * Key Manager - MLS-lite Sender-Key Ratchet
 * sender_key = HKDF(epoch_secret, "sframe", canonicalize(sender_id))
 * Key distribution via DataChannel HPKE + Welcome via signaling
 */

import type { CryptoKey } from '../types.js';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';
import { canonicalizeIdentity } from '../utils/identity.js';
import { AsyncMutex } from '../utils/mutex.js';

export { canonicalizeIdentity } from '../utils/identity.js';
export { AsyncMutex } from '../utils/mutex.js';

export interface KeyManagerConfig {
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
}

export interface EpochKeys {
  epochSecret: CryptoKey;
  epochSecretRaw: Uint8Array; // 32 bytes raw for HPKE commit encryption (CryptoKey not extractable)
  salt: Uint8Array; // 12 bytes salt derived via HKDF-SHA256 from epochSecret (RFC9605 §4.7)
  senderKeys: Map<string, CryptoKey>; // canonicalSenderId -> senderKey
  epoch: number;
  createdAt: number;
}

export interface SenderKeyPair {
  senderId: string;
  key: CryptoKey;
  kid: number;
  createdAt: number;
}

// RFC9180 HPKE ciphersuite: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM
// enc = 65 bytes (P-256 uncompressed ephemeral public key)
// seal() returns { enc: Uint8Array, ct: Uint8Array }
// open() takes enc + ct
const hpkeSuite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

/**
 * Derives 12-byte (96-bit) salt from epochSecret using HKDF-SHA256 with info="sframe-salt".
 * RFC9605 §4.7: salt is combined with counter via XOR to produce injective AES-GCM IVs.
 */
export async function deriveSalt(epochSecret: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('sframe-salt'),
    },
    epochSecret,
    96 // 96 bits = 12 bytes
  );
  return new Uint8Array(bits);
}

export class KeyManager {
  private config: KeyManagerConfig;
  private currentEpoch: EpochKeys | null = null;
  private previousEpochs: Map<number, EpochKeys> = new Map(); // For replay during reconnect
  private hpkeKeyPair: CryptoKeyPair | null = null;
  private participantKeys: Map<string, CryptoKey> = new Map(); // canonicalParticipantId -> HPKE public key
  private rotationTimer: number | null = null;
  private sweepTimer: any = null;
  private myCanonicalId: string = '';

  /** Single-flight mutex for serializing key rotations and preventing concurrency races */
  public readonly rotationMutex: AsyncMutex = new AsyncMutex();

  public static readonly PREVIOUS_EPOCH_TTL_MS = 30_000;
  public static readonly SWEEP_INTERVAL_MS = 10_000;
  public static readonly MAX_PREVIOUS_EPOCHS = 3;

  constructor(config: KeyManagerConfig) {
    this.config = config;
  }

  async deriveSalt(epochSecret: CryptoKey): Promise<Uint8Array> {
    return deriveSalt(epochSecret);
  }

  getCurrentSalt(): Uint8Array | null {
    return this.currentEpoch?.salt ? new Uint8Array(this.currentEpoch.salt) : null;
  }

  getSenderKeysSnapshot(): Map<string, CryptoKey> {
    if (!this.currentEpoch) return new Map();
    return new Map(this.currentEpoch.senderKeys);
  }

  getPreviousEpochs(): Map<number, EpochKeys> {
    return this.previousEpochs;
  }

  getMyCanonicalId(): string {
    return this.myCanonicalId;
  }

  /** Register a participant's HPKE public key for per-recipient encryption */
  setParticipantHPKEPublicKey(participantId: string, publicKey: CryptoKey): void {
    const canonicalId = canonicalizeIdentity(participantId);
    this.participantKeys.set(canonicalId, publicKey);
  }

  /** Get a participant's HPKE public key (for Welcome) */
  getParticipantHPKEPublicKey(participantId: string): CryptoKey | null {
    const canonicalId = canonicalizeIdentity(participantId);
    return this.participantKeys.get(canonicalId) || null;
  }

  /** Remove a participant's HPKE public key */
  removeParticipantHPKEPublicKey(participantId: string): void {
    const canonicalId = canonicalizeIdentity(participantId);
    this.participantKeys.delete(canonicalId);
  }

  async initialize(participantId: string): Promise<void> {
    this.myCanonicalId = canonicalizeIdentity(participantId);

    // Generate one HPKE keypair per participant (P-256 ECDH for RFC9180 DHKEM(P-256, HKDF-SHA256)).
    // Keypair is extractable for publishing public key.
    this.hpkeKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Generate initial epoch secret (key + raw 32 bytes)
    const { key: epochSecret, raw: epochRaw } = await this.generateEpochSecret();
    const salt = await deriveSalt(epochSecret);

    this.currentEpoch = {
      epochSecret,
      epochSecretRaw: epochRaw,
      salt,
      senderKeys: new Map(),
      epoch: 0,
      createdAt: Date.now(),
    };

    // Derive our own sender key using canonical ID
    const mySenderKey = await this.deriveSenderKey(epochSecret, this.myCanonicalId);
    this.currentEpoch.senderKeys.set(this.myCanonicalId, mySenderKey);

    // Start periodic rotation timer & previous epochs sweep timer
    this.startRotationTimer();
    this.startSweepTimer();
  }

  private async generateEpochSecret(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'HKDF' },
      false,
      ['deriveKey', 'deriveBits']
    );
    return { key, raw };
  }

  async deriveSenderKey(epochSecret: CryptoKey, senderId: string): Promise<CryptoKey> {
    // sender_key = HKDF(epoch_secret, "sframe", canonicalize(sender_id))
    const canonicalSender = canonicalizeIdentity(senderId);
    const info = new TextEncoder().encode(`sframe${canonicalSender}`);
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info,
      },
      epochSecret,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  getCurrentSenderKey(): CryptoKey | null {
    if (!this.currentEpoch) return null;
    if (this.myCanonicalId && this.currentEpoch.senderKeys.has(this.myCanonicalId)) {
      return this.currentEpoch.senderKeys.get(this.myCanonicalId) || null;
    }
    const keys = Array.from(this.currentEpoch.senderKeys.values());
    return keys[0] || null;
  }

  getSenderKey(senderId: string, kid: number): CryptoKey | null {
    const canonicalSender = canonicalizeIdentity(senderId);
    // Check current epoch
    if (this.currentEpoch && this.currentEpoch.epoch === kid) {
      return this.currentEpoch.senderKeys.get(canonicalSender) || null;
    }
    // Check previous epochs (for reconnect replay)
    const epoch = this.previousEpochs.get(kid);
    return epoch?.senderKeys.get(canonicalSender) || null;
  }

  async addParticipant(senderId: string, _participantId?: string): Promise<CryptoKey> {
    if (!this.currentEpoch) throw new Error('No current epoch');
    const canonicalSender = canonicalizeIdentity(senderId);
    const senderKey = await this.deriveSenderKey(this.currentEpoch.epochSecret, canonicalSender);
    this.currentEpoch.senderKeys.set(canonicalSender, senderKey);
    return senderKey;
  }

  async removeParticipant(senderId: string): Promise<void> {
    if (!this.currentEpoch) return;
    const canonicalSender = canonicalizeIdentity(senderId);
    const key = this.currentEpoch.senderKeys.get(canonicalSender);
    if (key) {
      this.zeroizeKey(key);
      this.currentEpoch.senderKeys.delete(canonicalSender);
    }
  }

  async rotateEpoch(
    trigger: 'join' | 'leave' | 'periodic' | 'manual',
    leavingParticipantId?: string
  ): Promise<{ commits: Map<string, Uint8Array>; newEpoch: number }> {
    if (!this.currentEpoch) throw new Error('No current epoch');

    const oldEpochKeys = this.currentEpoch;
    const oldEpoch = oldEpochKeys.epoch;
    const newEpoch = oldEpoch + 1;
    const canonicalLeavingId = leavingParticipantId ? canonicalizeIdentity(leavingParticipantId) : undefined;

    // Archive old epoch for replay during reconnect (enforces max 3)
    this.archivePreviousEpoch(oldEpoch, oldEpochKeys);

    // Generate new epoch secret and derive salt
    const { key: newEpochSecret, raw: newEpochRaw } = await this.generateEpochSecret();
    const newSalt = await deriveSalt(newEpochSecret);

    // Re-derive senderKeys for self and all remaining participants before createCommit
    const newSenderKeys = new Map<string, CryptoKey>();
    if (this.myCanonicalId) {
      const mySenderKey = await this.deriveSenderKey(newEpochSecret, this.myCanonicalId);
      newSenderKeys.set(this.myCanonicalId, mySenderKey);
    }

    const peerIds = new Set<string>();
    for (const id of this.participantKeys.keys()) {
      peerIds.add(id);
    }
    for (const id of oldEpochKeys.senderKeys.keys()) {
      peerIds.add(id);
    }
    if (this.myCanonicalId) {
      peerIds.delete(this.myCanonicalId);
    }
    if (canonicalLeavingId) {
      peerIds.delete(canonicalLeavingId);
      this.participantKeys.delete(canonicalLeavingId);
    }

    for (const pid of peerIds) {
      const peerKey = await this.deriveSenderKey(newEpochSecret, pid);
      newSenderKeys.set(pid, peerKey);
    }

    this.currentEpoch = {
      epochSecret: newEpochSecret,
      epochSecretRaw: newEpochRaw,
      salt: newSalt,
      senderKeys: newSenderKeys,
      epoch: newEpoch,
      createdAt: Date.now(),
    };

    // Commit payload encrypted per-recipient via HPKE (excluding leaving participant)
    const commits = await this.createCommit(newEpochRaw, oldEpoch, canonicalLeavingId);

    return { commits, newEpoch };
  }

  private archivePreviousEpoch(epoch: number, epochKeys: EpochKeys): void {
    this.previousEpochs.set(epoch, epochKeys);
    while (this.previousEpochs.size > KeyManager.MAX_PREVIOUS_EPOCHS) {
      const oldestEpoch = Math.min(...this.previousEpochs.keys());
      const oldestData = this.previousEpochs.get(oldestEpoch);
      if (oldestData) {
        this.evictPreviousEpoch(oldestEpoch, oldestData);
      } else {
        this.previousEpochs.delete(oldestEpoch);
      }
    }
  }

  sweepPreviousEpochs(): void {
    const now = Date.now();
    for (const [epochNum, epochData] of Array.from(this.previousEpochs.entries())) {
      if (now - epochData.createdAt > KeyManager.PREVIOUS_EPOCH_TTL_MS) {
        this.evictPreviousEpoch(epochNum, epochData);
      }
    }
  }

  private evictPreviousEpoch(epochNum: number, epochData: EpochKeys): void {
    this.previousEpochs.delete(epochNum);
    this.zeroizeEpoch(epochData);
  }

  private zeroizeEpoch(epochData: EpochKeys): void {
    if (epochData.epochSecretRaw) {
      epochData.epochSecretRaw.fill(0);
    }
    if (epochData.salt) {
      epochData.salt.fill(0);
    }
    this.zeroizeKey(epochData.epochSecret);
    for (const [, key] of epochData.senderKeys) {
      this.zeroizeKey(key);
    }
    epochData.senderKeys.clear();
  }

  private startSweepTimer(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = setInterval(() => {
      this.sweepPreviousEpochs();
    }, KeyManager.SWEEP_INTERVAL_MS);
  }

  stopSweepTimer(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private async createCommit(newSecretRaw: Uint8Array, oldEpoch: number, leavingParticipantId?: string): Promise<Map<string, Uint8Array>> {
    const newSecretBytes = newSecretRaw;
    
    // Validate newSecret is 32 bytes (no truncation)
    if (newSecretBytes.byteLength !== 32) {
      throw new Error(`Epoch secret must be 32 bytes, got ${newSecretBytes.byteLength}`);
    }
    
    const leavingIdBytes = leavingParticipantId 
      ? new TextEncoder().encode(leavingParticipantId)
      : new Uint8Array(0);
    
    const epochBytes = new Uint8Array(4);
    new DataView(epochBytes.buffer).setUint32(0, oldEpoch, false);
    
    const payload = new Uint8Array(epochBytes.byteLength + leavingIdBytes.byteLength + newSecretBytes.byteLength);
    let offset = 0;
    payload.set(epochBytes, offset);
    offset += epochBytes.byteLength;
    payload.set(leavingIdBytes, offset);
    offset += leavingIdBytes.byteLength;
    payload.set(newSecretBytes, offset);
    
    // Encrypt per-recipient using RFC9180 HPKE — each recipient gets separate ciphertext
    const commits = new Map<string, Uint8Array>();
    for (const [participantId, publicKey] of this.participantKeys) {
      if (leavingParticipantId && participantId === leavingParticipantId) {
        continue;
      }
      const sender = await hpkeSuite.createSenderContext({
        recipientPublicKey: publicKey,
      });
      const enc = sender.enc;
      const ciphertext = await sender.seal(payload);
      const encBytes = new Uint8Array(enc);
      const ctBytes = new Uint8Array(ciphertext);
      const encrypted = new Uint8Array(encBytes.byteLength + ctBytes.byteLength);
      encrypted.set(encBytes, 0);
      encrypted.set(ctBytes, encBytes.byteLength);
      commits.set(participantId, encrypted);
    }
    
    return commits;
  }

  /** Process an HPKE-encrypted commit ciphertext from DataChannel. Decrypts via our private key. */
  async processCommit(ciphertext: Uint8Array): Promise<CryptoKey> {
    if (!this.hpkeKeyPair) throw new Error('No HPKE key pair');
    const plaintext = await this.hpkeDecrypt(ciphertext);
    if (plaintext.byteLength < 36) throw new Error('Commit payload too short');
    // F-04 defense-in-depth: max commit size = epoch(4) + leavingId(<=128) + secret(32) = 164
    if (plaintext.byteLength > 164) throw new Error(`Commit payload too large: ${plaintext.byteLength} > 164`);
    
    const oldEpochFromPayload = new DataView(plaintext.buffer, plaintext.byteOffset, 4).getUint32(0, false);
    const leavingIdLen = plaintext.byteLength - 36;
    let canonicalLeavingId: string | undefined;
    if (leavingIdLen > 128) throw new Error(`leavingId too large: ${leavingIdLen}`);
    if (leavingIdLen > 0) {
      const leavingIdBytes = plaintext.slice(4, plaintext.byteLength - 32);
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(leavingIdBytes);
        if (/[\x00-\x1F\x7F]/.test(decoded)) throw new Error('leavingId contains control chars');
        canonicalLeavingId = canonicalizeIdentity(decoded);
      } catch (e) {
        throw new Error(`Invalid leavingId UTF-8: ${(e as Error).message}`);
      }
    }
    
    const newSecretBytes = new Uint8Array(plaintext.slice(plaintext.byteLength - 32));
    const key = await crypto.subtle.importKey('raw', newSecretBytes as any, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);
    const newSalt = await deriveSalt(key);

    const newEpoch = (this.currentEpoch?.epoch ?? oldEpochFromPayload) + 1;

    if (this.currentEpoch) {
      this.archivePreviousEpoch(this.currentEpoch.epoch, this.currentEpoch);
    }

    if (canonicalLeavingId) {
      this.participantKeys.delete(canonicalLeavingId);
    }

    // Re-derive sender keys for self and all remaining peers
    const newSenderKeys = new Map<string, CryptoKey>();
    if (this.myCanonicalId) {
      newSenderKeys.set(this.myCanonicalId, await this.deriveSenderKey(key, this.myCanonicalId));
    }
    const remainingPeers = new Set<string>(this.participantKeys.keys());
    if (this.currentEpoch) {
      for (const id of this.currentEpoch.senderKeys.keys()) {
        remainingPeers.add(id);
      }
    }
    for (const pid of remainingPeers) {
      if (pid !== this.myCanonicalId && pid !== canonicalLeavingId) {
        newSenderKeys.set(pid, await this.deriveSenderKey(key, pid));
      }
    }

    this.currentEpoch = {
      epochSecret: key,
      epochSecretRaw: newSecretBytes,
      salt: newSalt,
      senderKeys: newSenderKeys,
      epoch: newEpoch,
      createdAt: Date.now(),
    };

    return key;
  }

  async processWelcome(welcome: Uint8Array, roomId?: string, expectedEpoch?: number): Promise<CryptoKey> {
    if (!this.hpkeKeyPair) throw new Error('No HPKE key pair');
    let aad: Uint8Array | undefined;
    if (roomId) {
      const roomIdDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roomId));
      aad = new Uint8Array(roomIdDigest).slice(0, 8);
    }
    const decrypted = await this.hpkeDecrypt(welcome, aad);

    let epochSecretBytes: Uint8Array;
    let newEpoch = (this.currentEpoch?.epoch ?? 0) + 1;

    if (roomId) {
      if (decrypted.byteLength < 44) {
        throw new Error(`Welcome payload too short with roomId binding: ${decrypted.byteLength}`);
      }
      const epochFromPayload = new DataView(decrypted.buffer, decrypted.byteOffset, 4).getUint32(0, false);
      if (expectedEpoch !== undefined && epochFromPayload !== expectedEpoch) {
        throw new Error(`Welcome epoch mismatch: expected ${expectedEpoch}, got ${epochFromPayload}`);
      }
      const payloadHash = decrypted.slice(4, 12);
      for (let i = 0; i < 8; i++) {
        if (payloadHash[i] !== aad![i]) {
          throw new Error('Welcome roomIdHash mismatch');
        }
      }
      epochSecretBytes = decrypted.slice(12, 44);
      newEpoch = epochFromPayload;
    } else {
      if (decrypted.byteLength !== 32) {
        throw new Error(`Welcome epoch secret must be 32 bytes, got ${decrypted.byteLength}`);
      }
      epochSecretBytes = decrypted;
    }

    const key = await crypto.subtle.importKey('raw', epochSecretBytes as any, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);
    const salt = await deriveSalt(key);

    if (this.currentEpoch) {
      this.archivePreviousEpoch(this.currentEpoch.epoch, this.currentEpoch);
    }

    const newSenderKeys = new Map<string, CryptoKey>();
    if (this.myCanonicalId) {
      newSenderKeys.set(this.myCanonicalId, await this.deriveSenderKey(key, this.myCanonicalId));
    }

    this.currentEpoch = {
      epochSecret: key,
      epochSecretRaw: new Uint8Array(epochSecretBytes),
      salt,
      senderKeys: newSenderKeys,
      epoch: newEpoch,
      createdAt: Date.now(),
    };

    return key;
  }

  /**
   * Decrypt HPKE ciphertext using our private key + sender ephemeral enc from ciphertext.
   * Ciphertext format: enc (65 bytes for P-256) || ct
   */
  async hpkeDecrypt(ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    if (!this.hpkeKeyPair) throw new Error('No HPKE key pair');
    if (ciphertext.byteLength < 65) throw new Error('Ciphertext too short for HPKE');
    // RFC9180 P-256 enc 65 + AES-GCM min ct 16 + overhead; practical min ~93 bytes (65+16+min payload)
    if (ciphertext.byteLength < 93) throw new Error(`Ciphertext too short: ${ciphertext.byteLength} < 93 (enc+tag minimum)`);
    
    // P-256 enc is 65 bytes (uncompressed point: 0x04 || X || Y)
    const enc = ciphertext.slice(0, 65);
    const ct = ciphertext.slice(65);
    
    // RFC9180: createRecipientContext with recipientKey (our private key) and enc
    const recipientContext = await hpkeSuite.createRecipientContext({
      recipientKey: this.hpkeKeyPair.privateKey,
      enc,
    });
    
    return new Uint8Array(await recipientContext.open(ct, aad));
  }

  /** Export our HPKE public key as base64(raw 65 bytes P-256 uncompressed) for signaling publish. */
  async exportHPKEPublicKey(): Promise<string> {
    if (!this.hpkeKeyPair) throw new Error('No HPKE key pair');
    const raw = await crypto.subtle.exportKey('raw', this.hpkeKeyPair.publicKey);
    const bytes = new Uint8Array(raw as ArrayBuffer);
    // Full 65 bytes for P-256 (0x04 || X || Y)
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  /** Import a peer HPKE public key from base64(raw) published via signaling join. */
  async importHPKEPublicKey(b64: string): Promise<CryptoKey> {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    // RFC9180 DHKEM(P-256, HKDF-SHA256) expects 65-byte uncompressed P-256 public key
    if (bytes.byteLength !== 65) {
      throw new Error(`Invalid HPKE public key length: ${bytes.byteLength}, expected 65 for P-256`);
    }
    if (bytes[0] !== 0x04) throw new Error('Invalid P-256 public key: expected 0x04 uncompressed prefix');
    return crypto.subtle.importKey('raw', bytes as any, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  }

  async createWelcome(
    epochSecret: CryptoKey,
    joinerHpkePublicKey: CryptoKey,
    roomId?: string,
    epoch?: number
  ): Promise<Uint8Array> {
    let epochSecretBytes: Uint8Array;
    if (this.currentEpoch?.epochSecret === epochSecret && this.currentEpoch.epochSecretRaw) {
      epochSecretBytes = this.currentEpoch.epochSecretRaw;
    } else {
      try {
        const raw = await crypto.subtle.exportKey('raw', epochSecret);
        epochSecretBytes = new Uint8Array(raw as ArrayBuffer);
      } catch {
        epochSecretBytes = this.currentEpoch?.epochSecretRaw || new Uint8Array(32);
      }
    }

    let payload = epochSecretBytes;
    let aad: Uint8Array | undefined;

    if (roomId) {
      // RFC9180 AAD binds roomIdHash (SHA-256 first 8 bytes)
      const roomIdDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roomId));
      const roomIdHash = new Uint8Array(roomIdDigest).slice(0, 8);
      aad = roomIdHash;

      const epochNum = epoch ?? (this.currentEpoch?.epoch ?? 0);
      const epochBytes = new Uint8Array(4);
      new DataView(epochBytes.buffer).setUint32(0, epochNum, false);

      payload = new Uint8Array(4 + 8 + 32);
      payload.set(epochBytes, 0);
      payload.set(roomIdHash, 4);
      payload.set(epochSecretBytes, 12);
    }

    const sender = await hpkeSuite.createSenderContext({
      recipientPublicKey: joinerHpkePublicKey,
    });
    const enc = sender.enc;
    const ct = await sender.seal(payload, aad);
    const encBytes = new Uint8Array(enc);
    const ctBytes = new Uint8Array(ct);
    const welcome = new Uint8Array(encBytes.byteLength + ctBytes.byteLength);
    welcome.set(encBytes, 0);
    welcome.set(ctBytes, encBytes.byteLength);
    return welcome;
  }

  async exportKey(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw as ArrayBuffer)));
  }

  async importKey(keyData: string): Promise<CryptoKey> {
    const raw = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw as any, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  zeroizeKey(key: CryptoKey): void {
    (key as any)._zeroized = true;
  }

  getCurrentEpoch(): number {
    return this.currentEpoch ? this.currentEpoch.epoch : -1;
  }

  getCurrentEpochSecret(): CryptoKey | null {
    return this.currentEpoch?.epochSecret || null;
  }

  getHPKEPublicKey(): CryptoKey | null {
    return this.hpkeKeyPair?.publicKey || null;
  }

  /** Direct accessor for the raw keypair (needed for testing non-recipient failures). */
  getHPKEKeyPair(): CryptoKeyPair | null {
    return this.hpkeKeyPair;
  }

  // ==================== PERIODIC ROTATION ====================

  private startRotationTimer(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer as any);
    }
    
    this.rotationTimer = setInterval(async () => {
      try {
        await this.rotationMutex.run(async () => {
          await this.rotateEpoch('periodic');
          console.log(`Periodic key rotation to epoch ${this.currentEpoch?.epoch}`);
        });
      } catch (error) {
        console.error('Periodic key rotation failed:', error);
      }
    }, this.config.keyRotationIntervalMs) as unknown as number;
  }

  stopRotationTimer(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer as any);
      this.rotationTimer = null;
    }
  }

  // ==================== CLEANUP ====================

  async destroy(): Promise<void> {
    this.stopRotationTimer();
    this.stopSweepTimer();
    
    if (this.currentEpoch) {
      this.zeroizeEpoch(this.currentEpoch);
      this.currentEpoch = null;
    }
    
    for (const [, epoch] of this.previousEpochs) {
      this.zeroizeEpoch(epoch);
    }
    this.previousEpochs.clear();
    
    this.participantKeys.clear();
    this.hpkeKeyPair = null;
  }
}
