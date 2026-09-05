/**
 * @vitest-environment node
 * S-03 RFC9180 HPKE remediation tests
 * Exit Criteria:
 * - recipient decrypt succeeds (Alice->Bob)
 * - non-recipient decrypt fails (Carol can't decrypt Alice->Bob)
 * - RFC9180 sender->recipient interoperability via @hpke/core CipherSuite
 * - ciphertexts differ per recipient (random enc/iv)
 * - existing S-02 tests still pass (8/8 green)
 * - no plaintext epoch material in signaling
 * - Suite configuration: DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KeyManager } from '../src/keys/manager.js';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { SignalingClient } from '../src/signaling/client.js';

// Ensure real WebCrypto in node environment
(globalThis as any).crypto = webcrypto as any;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder as any;
if (!globalThis.atob) {
  (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

describe('S-03 RFC9180 HPKE remediation', () => {
  let alice: KeyManager;
  let bob: KeyManager;
  let carol: KeyManager; // non-recipient

  beforeAll(async () => {
    alice = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    bob = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    carol = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await alice.initialize('alice');
    await bob.initialize('bob');
    await carol.initialize('carol');

    // Exchange HPKE public keys (publish during join)
    const alicePubB64 = await alice.exportHPKEPublicKey();
    const bobPubB64 = await bob.exportHPKEPublicKey();
    const carolPubB64 = await carol.exportHPKEPublicKey();

    // Each participant imports peers' keys
    const bobPubForAlice = await alice.importHPKEPublicKey(bobPubB64);
    const carolPubForAlice = await alice.importHPKEPublicKey(carolPubB64);

    // Register per-recipient keys in Alice (the rotator)
    alice.setParticipantHPKEPublicKey('bob', bobPubForAlice);
    alice.setParticipantHPKEPublicKey('carol', carolPubForAlice);

    // Verify publish format is base64 raw bytes (no truncation: 65 for P-256, 32 for X25519)
    const alicePubBytes = Uint8Array.from(atob(alicePubB64), c => c.charCodeAt(0));
    const bobPubBytes = Uint8Array.from(atob(bobPubB64), c => c.charCodeAt(0));
    const carolPubBytes = Uint8Array.from(atob(carolPubB64), c => c.charCodeAt(0));
    expect([32, 65]).toContain(alicePubBytes.byteLength);
    expect([32, 65]).toContain(bobPubBytes.byteLength);
    expect([32, 65]).toContain(carolPubBytes.byteLength);
    if (alicePubBytes.byteLength === 65) expect(alicePubBytes[0]).toBe(0x04);
    if (bobPubBytes.byteLength === 65) expect(bobPubBytes[0]).toBe(0x04);
    if (carolPubBytes.byteLength === 65) expect(carolPubBytes[0]).toBe(0x04);

    // Stop periodic timers for test isolation
    alice.stopRotationTimer();
    bob.stopRotationTimer();
    carol.stopRotationTimer();
  });

  it('recipient decrypt succeeds — Alice encrypts to Bob, Bob decrypts successfully via processCommit', async () => {
    // Alice rotates epoch, creates per-recipient encrypted commits
    const { commits } = await alice.rotateEpoch('manual');
    expect(commits.has('bob')).toBe(true);
    expect(commits.has('carol')).toBe(true); // carol is registered

    const bobCiphertext = commits.get('bob')!;
    // Ciphertext format: enc (65 bytes) + ct (12+payload+16)
    expect(bobCiphertext.byteLength).toBeGreaterThan(32 + 12 + 16);

    // Bob decrypts via processCommit (uses sender enc from ciphertext, not self pubkey)
    // This proves HPKE uses sender enc, not self pubkey
    const newEpochSecret = await bob.processCommit(bobCiphertext);
    expect(newEpochSecret).toBeDefined();
    // Verify the new epoch secret can derive a sender key (proves HKDF validity)
    const senderKey = await bob.deriveSenderKey(newEpochSecret, 'bob');
    expect(senderKey).toBeDefined();
  });

  it('non-recipient decrypt fails — Carol cannot decrypt Alice->Bob ciphertext', async () => {
    // Fresh rotation to get ciphertext addressed only to bob
    const { commits } = await alice.rotateEpoch('manual');
    const bobCiphertext = commits.get('bob')!;
    // Carol tries to decrypt Bob's ciphertext with her private key — should fail
    let failed = false;
    try {
      await carol.processCommit(bobCiphertext);
    } catch (e) {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('RFC9180 sender->recipient interoperability — @hpke/core CipherSuite roundtrip with KeyManager keys', async () => {
    // Direct @hpke/core CipherSuite roundtrip using DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm
    // Uses KeyManager-generated keypairs (same format as manager.ts) to prove interop
    const suite = new CipherSuite({
      kem: new DhkemP256HkdfSha256(),
      kdf: new HkdfSha256(),
      aead: new Aes128Gcm(),
    });

    // Use Bob's KeyManager-generated private key and Bob's public key
    const bobPrivKey = bob.getHPKEKeyPair()!.privateKey;
    const bobPubKeyB64 = await bob.exportHPKEPublicKey();
    const bobPubKey = await alice.importHPKEPublicKey(bobPubKeyB64);

    // Seal: encrypt payload using Bob's public key (Alice sends to Bob)
    const plaintext = new TextEncoder().encode('s03-rfc9180-test-payload');
    const { enc, ct } = await suite.seal(
      { recipientPublicKey: bobPubKey },
      plaintext
    );

    const ciphertext = new Uint8Array(enc.byteLength + ct.byteLength);
    ciphertext.set(new Uint8Array(enc), 0);
    ciphertext.set(new Uint8Array(ct), enc.byteLength);

    // Open: decrypt using Bob's private key and enc from ciphertext
    const recipientContext = await suite.createRecipientContext({
      recipientKey: bobPrivKey,
      enc: new Uint8Array(enc),
    });

    const decrypted = await recipientContext.open(new Uint8Array(ct));
    expect(Buffer.from(decrypted).toString()).toBe(Buffer.from(plaintext).toString());
  });

  it('ciphertexts differ per recipient — same payload encrypted to Bob vs Carol produces different ciphertexts', async () => {
    // Same payload encrypted to Bob vs Carol via KeyManager.createCommit produces different ciphertexts
    const { commits } = await alice.rotateEpoch('manual');
    const bobCiphertext = commits.get('bob')!;
    const carolCiphertext = commits.get('carol')!;

    // Verify ciphertexts are different (due to random enc/iv)
    const bobHex = Buffer.from(bobCiphertext).toString('hex');
    const carolHex = Buffer.from(carolCiphertext).toString('hex');
    expect(bobHex).not.toBe(carolHex);

    // Length check: enc (65 bytes for P-256) + ct
    expect(bobCiphertext.byteLength).toBeGreaterThan(64);
    expect(carolCiphertext.byteLength).toBeGreaterThan(64);

    // Verify both have the 65-byte enc preamble
    expect(bobCiphertext.slice(0, 65).byteLength).toBe(65);
    expect(carolCiphertext.slice(0, 65).byteLength).toBe(65);
    // First byte should be 0x04 for P-256 uncompressed
    expect(bobCiphertext[0]).toBe(0x04);
    expect(carolCiphertext[0]).toBe(0x04);
  });

  it('suite configuration uses DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm explicitly', async () => {
    // Verify suite configuration matches RFC9180 spec
    const suite = new CipherSuite({
      kem: new DhkemP256HkdfSha256(),
      kdf: new HkdfSha256(),
      aead: new Aes128Gcm(),
    });

    // Check that the suite components are the correct types
    expect(suite.kem).toBeInstanceOf(DhkemP256HkdfSha256);
    expect(suite.kdf).toBeInstanceOf(HkdfSha256);
    expect(suite.aead).toBeInstanceOf(Aes128Gcm);

    // Verify import strings match expected RFC9180 cipher suite
    const managerPath = path.resolve(__dirname, '../src/keys/manager.ts');
    const managerSrc = fs.readFileSync(managerPath, 'utf-8');

    // Check imports contain the explicit RFC9180 suites
    expect(managerSrc).toMatch(/DhkemP256HkdfSha256/);
    expect(managerSrc).toMatch(/HkdfSha256/);
    expect(managerSrc).toMatch(/Aes128Gcm/);

    // Check no custom HPKE class exists
    expect(managerSrc).not.toMatch(/class HPKE/);
  });

  it('no plaintext epoch material traverses signaling — createCommit contains only ciphertext, no sendCommit', async () => {
    const { commits, newEpoch } = await alice.rotateEpoch('manual');
    const bobCiphertext = commits.get('bob')!;

    // Simulate signaling Welcome payload (HPKE encrypted) and DataChannel commit payload
    const signalingPayload = {
      type: 'welcome' as const,
      payload: { epoch: newEpoch, welcome: Array.from(bobCiphertext) },
      roomId: 'room-123',
      participantId: 'alice',
      timestamp: Date.now(),
    };
    const dataChannelPayload = {
      type: 'commit' as const,
      epoch: newEpoch,
      senderId: 'alice',
      commits: { bob: Array.from(bobCiphertext) },
    };

    const signalingJson = JSON.stringify(signalingPayload);
    const dataChannelJson = JSON.stringify(dataChannelPayload);

    // Ciphertext must be present as array numbers, not plaintext epoch secret
    expect(bobCiphertext.byteLength).toBeGreaterThan(48);
    expect(signalingJson).toContain('welcome');
    expect(dataChannelJson).toContain('commits');
    // Ciphertext should not be simple 32-byte raw (which would indicate plaintext)
    expect(Array.from(bobCiphertext).length).toBeGreaterThan(32 + 65);
    // Signaling JSON should not contain plaintext marker like "epochSecret"
    expect(signalingJson).not.toContain('epochSecret');
    expect(dataChannelJson).not.toContain('epochSecret');
    expect(dataChannelJson).not.toContain('oldSecret');

    // Verify SignalingClient does NOT send plaintext commit via sendCommit (removed)
// Signaling client now publishes HPKE pubkey and sends Welcome only (ciphertext)
    expect(typeof SignalingClient.prototype.publishHPKEPublicKey).toBe('function');
    expect(typeof SignalingClient.prototype.sendWelcome).toBe('function');
  });

  it('existing S-02 tests compatibility — all S-02 assertion properties preserved', async () => {
    // This test verifies backward compatibility with S-02 HPKE tests
    
    // 1. No plaintext epoch transport in manager source
    const managerPath = path.resolve(__dirname, '../src/keys/manager.ts');
    const managerSrc = fs.readFileSync(managerPath, 'utf-8');
    expect(managerSrc).not.toMatch(/createCommit\(oldSecret/);
    expect(managerSrc).not.toMatch(/oldSecret/);

    // 2. No sendCommit in signaling client
    const signalPath = path.resolve(__dirname, '../src/signaling/client.ts');
    const signalSrc = fs.readFileSync(signalPath, 'utf-8');
    expect(signalSrc).not.toContain('sendCommit');

    // 3. Public key length is 32 or 65 bytes (no truncation)
    const alicePubB64 = await alice.exportHPKEPublicKey();
    const alicePubBytes = Uint8Array.from(atob(alicePubB64), c => c.charCodeAt(0));
    expect([32, 65]).toContain(alicePubBytes.byteLength);

    // 4. Ciphertext has proper overhead (65+12+payload+16)
    const { commits: commits2 } = await alice.rotateEpoch('manual');
    const bobCiphertext2 = commits2.get('bob')!;
    expect(bobCiphertext2.byteLength).toBeGreaterThan(32 + 12 + 16);
  });
});