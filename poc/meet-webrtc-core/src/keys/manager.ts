/**
 * Key Manager - MLS-lite Sender-Key Ratchet
 * sender_key = HKDF(epoch_secret, "sframe", sender_id)
 * Key distribution via DataChannel HPKE + Welcome via signaling
 */

import type { CryptoKey, KeyRotationMessage } from '../types.js';

export interface KeyManagerConfig {
  cipherSuite: 'AES_GCM' | 'AES_CTR';
  keyRotationIntervalMs: number;
  hpkeConfig?: HPKEConfig;
}

export interface HPKEConfig {
  kem: 'DHKEM_X25519_HKDF_SHA256';
  kdf: 'HKDF_SHA256';
  aead: 'AES_GCM_128';
}

export interface EpochKeys {
  epochSecret: CryptoKey;
  senderKeys: Map<string, CryptoKey>; // senderId -> senderKey
  epoch: number;
  createdAt: number;
}

export interface SenderKeyPair {
  senderId: string;
  key: CryptoKey;
  kid: number;
  createdAt: number;
}

export class KeyManager {
  private config: KeyManagerConfig;
  private currentEpoch: EpochKeys | null = null;
  private previousEpochs: Map<number, EpochKeys> = new Map(); // For replay during reconnect
  private hpkeKeyPair: CryptoKeyPair | null = null;
  private participantKeys: Map<string, CryptoKey> = new Map(); // participantId -> HPKE public key
  private rotationTimer: number | null = null;

  constructor(config: KeyManagerConfig) {
    this.config = config;
  }

  async initialize(participantId: string): Promise<void> {
    // Generate HPKE key pair for this participant (best-effort: X25519 ECDH is
    // not available in every browser; MLS key distribution can be added later).
    try {
      this.hpkeKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'X25519' },
        true,
        ['deriveKey', 'deriveBits']
      );
    } catch (err) {
      console.warn('HPKE keypair generation unsupported; continuing without HPKE:', err);
      this.hpkeKeyPair = null;
    }

    // Generate initial epoch secret
    const epochSecret = await this.generateEpochSecret();
    this.currentEpoch = {
      epochSecret,
      senderKeys: new Map(),
      epoch: 0,
      createdAt: Date.now(),
    };

    // Derive our own sender key
    const mySenderKey = await this.deriveSenderKey(epochSecret, participantId);
    this.currentEpoch.senderKeys.set(participantId, mySenderKey);

    // Start periodic rotation timer
    this.startRotationTimer();
  }

  private async generateEpochSecret(): Promise<CryptoKey> {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    return crypto.subtle.importKey(
      'raw',
      randomBytes,
      { name: 'HKDF' },
      false,
      ['deriveKey', 'deriveBits']
    );
  }

  async deriveSenderKey(epochSecret: CryptoKey, senderId: string): Promise<CryptoKey> {
    // sender_key = HKDF(epoch_secret, "sframe", sender_id)
    const info = new TextEncoder().encode(`sframe${senderId}`);
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
    // Return our own sender key (first in map or specific)
    if (!this.currentEpoch) return null;
    const keys = Array.from(this.currentEpoch.senderKeys.values());
    return keys[0] || null;
  }

  getSenderKey(senderId: string, kid: number): CryptoKey | null {
    // Check current epoch
    if (this.currentEpoch && this.currentEpoch.epoch === kid) {
      return this.currentEpoch.senderKeys.get(senderId) || null;
    }
    // Check previous epochs (for reconnect replay)
    const epoch = this.previousEpochs.get(kid);
    return epoch?.senderKeys.get(senderId) || null;
  }

  async addParticipant(senderId: string, participantId: string): Promise<CryptoKey> {
    if (!this.currentEpoch) throw new Error('No current epoch');
    
    const senderKey = await this.deriveSenderKey(this.currentEpoch.epochSecret, senderId);
    this.currentEpoch.senderKeys.set(senderId, senderKey);
    return senderKey;
  }

  async removeParticipant(senderId: string): Promise<void> {
    if (!this.currentEpoch) return;
    
    const key = this.currentEpoch.senderKeys.get(senderId);
    if (key) {
      await this.zeroizeKey(key);
      this.currentEpoch.senderKeys.delete(senderId);
    }
  }

  async rotateEpoch(trigger: 'join' | 'leave' | 'periodic' | 'manual', leavingParticipantId?: string): Promise<{ commit: Uint8Array; newEpoch: number }> {
    if (!this.currentEpoch) throw new Error('No current epoch');

    const oldEpochSecret = this.currentEpoch.epochSecret;
    const oldEpoch = this.currentEpoch.epoch;
    const newEpoch = oldEpoch + 1;

    // Generate new epoch secret
    const newEpochSecret = await this.generateEpochSecret();

    // Archive old epoch
    this.previousEpochs.set(oldEpoch, this.currentEpoch);

    // Create new epoch
    this.currentEpoch = {
      epochSecret: newEpochSecret,
      senderKeys: new Map(),
      epoch: newEpoch,
      createdAt: Date.now(),
    };

    // Derive new sender keys for remaining participants
    for (const [senderId] of this.currentEpoch.senderKeys) {
      if (senderId !== leavingParticipantId) {
        const newKey = await this.deriveSenderKey(newEpochSecret, senderId);
        this.currentEpoch.senderKeys.set(senderId, newKey);
      }
    }

    // Create MLS-style Commit message
    const commit = await this.createCommit(oldEpochSecret, newEpochSecret, oldEpoch, leavingParticipantId);

    // Zeroize old epoch secret
    await this.zeroizeKey(oldEpochSecret);

    return { commit, newEpoch };
  }

  private async createCommit(oldSecret: CryptoKey, newSecret: CryptoKey, oldEpoch: number, leavingParticipantId?: string): Promise<Uint8Array> {
    // Simplified MLS Commit: epoch_secret || leaving_id || new_secret_hash
    const oldSecretBytes = await crypto.subtle.exportKey('raw', oldSecret);
    const newSecretBytes = await crypto.subtle.exportKey('raw', newSecret);
    
    const leavingIdBytes = leavingParticipantId 
      ? new TextEncoder().encode(leavingParticipantId)
      : new Uint8Array(0);
    
    const commit = new Uint8Array(oldSecretBytes.byteLength + leavingIdBytes.byteLength + newSecretBytes.byteLength + 4);
    let offset = 0;
    commit.set(new Uint8Array(oldSecretBytes), offset);
    offset += oldSecretBytes.byteLength;
    commit.set(leavingIdBytes, offset);
    offset += leavingIdBytes.byteLength;
    commit.set(new Uint8Array([oldEpoch >> 24, oldEpoch >> 16, oldEpoch >> 8, oldEpoch & 0xff]), offset);
    offset += 4;
    commit.set(new Uint8Array(newSecretBytes), offset);
    
    return commit;
  }

  async processCommit(oldEpochSecret: CryptoKey, commit: Uint8Array, senderId: string): Promise<CryptoKey> {
    // Parse commit and derive new epoch secret
    // Simplified: extract new secret from commit
    const newSecretBytes = commit.slice(commit.length - 32);
    return crypto.subtle.importKey('raw', newSecretBytes, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);
  }

  async processWelcome(welcome: Uint8Array): Promise<CryptoKey> {
    // Process MLS Welcome message (encrypted to our HPKE key)
    // Decrypt welcome using our HPKE private key
    if (!this.hpkeKeyPair) throw new Error('No HPKE key pair');
    
    // Simplified: welcome contains epoch_secret encrypted to our HPKE public key
    // In real MLS, this uses HPKE.Decrypt
    const epochSecretBytes = await this.hpkeDecrypt(welcome);
    return crypto.subtle.importKey('raw', epochSecretBytes, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);
  }

  private async hpkeDecrypt(ciphertext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    // Simplified HPKE decryption using ECDH + HKDF + AES-GCM
    // Real implementation would use @mls-ts/mls or hpke.js
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: await this.getSenderHPKEPublicKey() },
      this.hpkeKeyPair!.privateKey,
      256
    );
    
    const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
    const iv = ciphertext.slice(0, 12);
    const data = ciphertext.slice(12, -16);
    const tag = ciphertext.slice(-16);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      new Uint8Array([...data, ...tag])
    );
    
    return new Uint8Array(decrypted);
  }

  private async getSenderHPKEPublicKey(): Promise<CryptoKey> {
    // In real impl, fetch from signaling
    return this.hpkeKeyPair!.publicKey;
  }

  async createWelcome(epochSecret: CryptoKey, joinerHpkePublicKey: CryptoKey): Promise<Uint8Array> {
    // Encrypt epoch secret to joiner's HPKE public key
    const epochSecretBytes = await crypto.subtle.exportKey('raw', epochSecret);
    
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: joinerHpkePublicKey },
      this.hpkeKeyPair!.privateKey,
      256
    );
    
    const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      epochSecretBytes
    );
    
    const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.byteLength);
    
    return result;
  }

  async exportKey(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  async importKey(keyData: string): Promise<CryptoKey> {
    const raw = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async zeroizeKey(key: CryptoKey): Promise<void> {
    // CryptoKey doesn't expose raw material directly, but we can try to clear references
    // In practice, key zeroization happens when CryptoKey is garbage collected
    // For explicit zeroization, we'd need to use a custom key store
    // This is a best-effort marker
    (key as any)._zeroized = true;
  }

  getCurrentEpoch(): number {
    return this.currentEpoch?.epoch || -1;
  }

  getCurrentEpochSecret(): CryptoKey | null {
    return this.currentEpoch?.epochSecret || null;
  }

  getHPKEPublicKey(): CryptoKey | null {
    return this.hpkeKeyPair?.publicKey || null;
  }

  // ==================== PERIODIC ROTATION ====================

  private startRotationTimer(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    
    this.rotationTimer = window.setInterval(async () => {
      try {
        await this.rotateEpoch('periodic');
        console.log(`Periodic key rotation to epoch ${this.currentEpoch?.epoch}`);
      } catch (error) {
        console.error('Periodic key rotation failed:', error);
      }
    }, this.config.keyRotationIntervalMs);
  }

  stopRotationTimer(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  // ==================== CLEANUP ====================

  async destroy(): Promise<void> {
    this.stopRotationTimer();
    
    if (this.currentEpoch) {
      await this.zeroizeKey(this.currentEpoch.epochSecret);
      for (const [, key] of this.currentEpoch.senderKeys) {
        await this.zeroizeKey(key);
      }
      this.currentEpoch = null;
    }
    
    for (const [, epoch] of this.previousEpochs) {
      await this.zeroizeKey(epoch.epochSecret);
      for (const [, key] of epoch.senderKeys) {
        await this.zeroizeKey(key);
      }
    }
    this.previousEpochs.clear();
    
    this.participantKeys.clear();
    this.hpkeKeyPair = null;
  }
}

// ==================== HPKE HELPER (standalone) ====================

export class HPKE {
  static async generateKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'X25519' },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  static async encrypt(publicKey: CryptoKey, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const senderKeyPair = await this.generateKeyPair();
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      senderKeyPair.privateKey,
      256
    );
    
    const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      plaintext
    );
    
    // Encode: sender_public_key || iv || ciphertext
    const senderPubKeyBytes = await crypto.subtle.exportKey('raw', senderKeyPair.publicKey);
    const result = new Uint8Array(senderPubKeyBytes.byteLength + iv.byteLength + ciphertext.byteLength);
    let offset = 0;
    result.set(new Uint8Array(senderPubKeyBytes), offset);
    offset += senderPubKeyBytes.byteLength;
    result.set(iv, offset);
    offset += iv.byteLength;
    result.set(new Uint8Array(ciphertext), offset);
    
    return result;
  }

  static async decrypt(privateKey: CryptoKey, ciphertext: Uint8Array): Promise<Uint8Array> {
    // Parse: sender_public_key (32) || iv (12) || ciphertext
    const senderPubKeyBytes = ciphertext.slice(0, 32);
    const iv = ciphertext.slice(12, 24);
    const data = ciphertext.slice(24, -16);
    const tag = ciphertext.slice(-16);
    
    const senderPubKey = await crypto.subtle.importKey('raw', senderPubKeyBytes, { name: 'ECDH', namedCurve: 'X25519' }, false, []);
    
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: senderPubKey },
      privateKey,
      256
    );
    
    const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      new Uint8Array([...data, ...tag])
    );
    
    return new Uint8Array(decrypted);
  }
}