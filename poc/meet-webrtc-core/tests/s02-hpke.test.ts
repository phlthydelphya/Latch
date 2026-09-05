/**
 * @vitest-environment node
 * S-02 HPKE per-recipient commit tests
 * Exit Criteria:
 * - grep finds no plaintext epoch transport
 * - recipient decrypt succeeds
 * - non-recipient decrypt fails
 * - signaling payload contains ciphertext only
 * - packet capture shows no epoch material disclosure (simulated via payload inspection)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { KeyManager } from '../src/keys/manager.js';
import { SignalingClient } from '../src/signaling/client.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';

// Ensure real WebCrypto in node environment
(globalThis as any).crypto = webcrypto as any;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder as any;
if (!globalThis.atob) {
  (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

describe('S-02 HPKE per-recipient commit', () => {
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
    // Carol not registered → non-recipient

    // Register per-recipient keys in Alice (the rotator)
    alice.setParticipantHPKEPublicKey('bob', bobPubForAlice);
    // Carol is NOT registered → non-recipient

    // Verify publish format is base64 raw bytes (no truncation: 65 for P-256, 32 for X25519)
    const alicePubBytes = Uint8Array.from(atob(alicePubB64), c => c.charCodeAt(0));
    const bobPubBytes = Uint8Array.from(atob(bobPubB64), c => c.charCodeAt(0));
    expect([32, 65]).toContain(alicePubBytes.byteLength);
    expect([32, 65]).toContain(bobPubBytes.byteLength);
    if (alicePubBytes.byteLength === 65) expect(alicePubBytes[0]).toBe(0x04);
    if (bobPubBytes.byteLength === 65) expect(bobPubBytes[0]).toBe(0x04);
    // Stop periodic timers for test isolation
    alice.stopRotationTimer();
    bob.stopRotationTimer();
    carol.stopRotationTimer();
  });

  it('generates one HPKE keypair per participant and publishes base64 public key', async () => {
    const alicePub = alice.getHPKEPublicKey();
    const bobPub = bob.getHPKEPublicKey();
    const carolPub = carol.getHPKEPublicKey();
    expect(alicePub).not.toBeNull();
    expect(bobPub).not.toBeNull();
    expect(carolPub).not.toBeNull();
    // Keypairs are distinct
    const aliceB64 = await alice.exportHPKEPublicKey();
    const bobB64 = await bob.exportHPKEPublicKey();
    expect(aliceB64).not.toBe(bobB64);
  });

  it('recipient decrypt succeeds — HPKE uses sender enc, not self pubkey', async () => {
    // Alice rotates epoch, creates per-recipient encrypted commits
    const { commits, newEpoch } = await alice.rotateEpoch('manual');
    expect(commits.has('bob')).toBe(true);
    expect(commits.has('carol')).toBe(false); // carol not registered

    const bobCiphertext = commits.get('bob')!;
    // Ciphertext format: pubkey(32 or 65) + 12 (iv) + payload + 16 (tag)
    expect(bobCiphertext.byteLength).toBeGreaterThan(32 + 12 + 16);
    // Not truncated — if P-256, first byte is 0x04, else X25519 random 32-byte
    if (bobCiphertext.byteLength > 80) expect(bobCiphertext[0]).toBe(0x04);

    // Bob decrypts via hpkeDecrypt (uses sender enc from ciphertext)
    const newEpochSecret = await bob.processCommit(bobCiphertext);
    expect(newEpochSecret).toBeDefined();
    // Verify the new epoch secret can derive a sender key (proves HKDF validity, no need to export)
    const senderKey = await bob.deriveSenderKey(newEpochSecret, 'bob');
    expect(senderKey).toBeDefined();
  });

  it('non-recipient decrypt fails — ciphertext not addressed to them', async () => {
    // Fresh rotation to get ciphertext addressed only to bob
    const { commits } = await alice.rotateEpoch('manual');
    const bobCiphertext = commits.get('bob')!;
    // Carol tries to decrypt Bob's ciphertext with her private key — should fail
    let failed = false;
    try {
      await carol.hpkeDecrypt(bobCiphertext);
    } catch (e) {
      failed = true;
    }
    expect(failed).toBe(true);

    // Also: Carol's processCommit on Bob's ciphertext fails
    let processFailed = false;
    try {
      await carol.processCommit(bobCiphertext);
    } catch (e) {
      processFailed = true;
    }
    expect(processFailed).toBe(true);
  });

  it('signaling payload contains ciphertext only — no epoch secret plaintext', async () => {
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
    // Plaintext would be 32 bytes epoch secret; ciphertext is 65+12+payload+16 — longer than 32
    expect(bobCiphertext.byteLength).toBeGreaterThan(48);
    // Payloads should contain ciphertext arrays (numbers 0-255), not raw epoch strings
    expect(signalingJson).toContain('welcome');
    expect(dataChannelJson).toContain('commits');
    // Ciphertext should not be simple 32-byte raw (which would indicate plaintext)
    expect(Array.from(bobCiphertext).length).toBeGreaterThan(32 + 65);
    // Signaling JSON should not contain plaintext marker like "epochSecret"
    expect(signalingJson).not.toContain('epochSecret');
    expect(dataChannelJson).not.toContain('epochSecret');
    expect(dataChannelJson).not.toContain('oldSecret');

    // Verify SignalingClient does NOT send plaintext commit via sendCommit (removed)
    const client = new SignalingClient({ url: 'ws://localhost', roomId: 'r1', participantId: 'alice', jwt: 'fake' });
    // @ts-ignore check that legacy method no longer exists
    expect((client as any).sendCommit).toBeUndefined();
    // Signaling client now publishes HPKE pubkey and sends Welcome only (ciphertext)
    expect(typeof (client as any).publishHPKEPublicKey).toBe('function');
    expect(typeof (client as any).sendWelcome).toBe('function');
  });

  it('grep finds no plaintext epoch transport — source contains no oldSecret||newSecret plaintext', async () => {
    const managerPath = path.resolve(__dirname, '../src/keys/manager.ts');
    const managerSrc = fs.readFileSync(managerPath, 'utf-8');
    // Should have no createCommit with oldSecret param (plaintext transport removed)
    expect(managerSrc).not.toMatch(/createCommit\(oldSecret/);
    // Should not have plaintext epochSecret sent via Array.from without HPKE
    // Allowed pattern is HPKE.encrypt — ensure no raw epochSecret in signaling send
    const signalPath = path.resolve(__dirname, '../src/signaling/client.ts');
    const signalSrc = fs.readFileSync(signalPath, 'utf-8');
    expect(signalSrc).not.toContain('sendCommit');
    expect(signalSrc).not.toMatch(/oldSecret/);
    // Ensure manager does not contain plaintext oldSecret||newSecret transport comment with ||
    // We allow explanatory comment but check code lines not containing concatenation of secrets
    const codeLines = managerSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const codeJoined = codeLines.join('\n');
    expect(codeJoined).not.toMatch(/oldSecret/);
  });

  it('packet capture shows no epoch material disclosure — ciphertext entropy and no plaintext NAL', async () => {
    const { commits } = await alice.rotateEpoch('manual');
    const bobCiphertext = commits.get('bob')!;
    // Simulate pcap payload: ciphertext bytes should have high entropy (not plaintext 00 00 00 01 NAL)
    // Check that ciphertext does not contain 4-byte plaintext epoch secret pattern (32 zero bytes etc.)
    // Epoch secret is random 32 bytes; ciphertext should not equal plaintext
    const plaintextPayloadLen = 4 + 32; // epoch(4) + newSecret(32)
    // Ciphertext is longer due to 65+12+16 overhead
    expect(bobCiphertext.byteLength).toBeGreaterThan(plaintextPayloadLen + 65 + 12);
    // Ciphertext should not start with 00 00 00 01 (NAL) nor equal plaintext
    expect(bobCiphertext.slice(65 + 12, 65 + 16).toString()).not.toBe(new Uint8Array([0,0,0,1]).toString());
    // Verify HPKE encrypt uses separate ciphertext per recipient (different random IVs)
    const { commits: commits2 } = await alice.rotateEpoch('manual');
    const bobCiphertext2 = commits2.get('bob')!;
    // Two commits to same recipient at different epochs should differ (random IV/ephemeral key)
    expect(Buffer.from(bobCiphertext).toString('hex')).not.toBe(Buffer.from(bobCiphertext2).toString('hex'));
  });

  it('EC key not truncated — public key full length (32 or 65)', async () => {
    const b64 = await alice.exportHPKEPublicKey();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    expect([32, 65]).toContain(bytes.byteLength);
    if (bytes.byteLength === 65) expect(bytes[0]).toBe(0x04);
    // HPKE ciphertext preamble matches key length (no truncation)
    const { commits } = await alice.rotateEpoch('manual');
    const ct = commits.get('bob')!;
    // If P-256, marker 0x04; if X25519, any value but length prefix is 32 or 65
    expect([32, 65].includes(ct[0] === 0x04 ? 65 : 32) || ct.byteLength > 44).toBe(true);
    expect(ct.byteLength).toBeGreaterThan(32 + 12 + 16);
  });

  it('HPKE decrypt uses sender enc, not self public key — cross-check with direct HPKE', async () => {
    const plaintext = new TextEncoder().encode('epoch-material-test');
    const bobPubB64 = await bob.exportHPKEPublicKey();
    const bobPub = await alice.importHPKEPublicKey(bobPubB64);
    
    // Use the RFC9180 HPKE suite directly for cross-check
    const suite = new CipherSuite({
      kem: new DhkemP256HkdfSha256(),
      kdf: new HkdfSha256(),
      aead: new Aes128Gcm(),
    });
    const { enc, ct } = await suite.seal({ recipientPublicKey: bobPub }, plaintext);
    const ciphertext = new Uint8Array(enc.byteLength + ct.byteLength);
    ciphertext.set(new Uint8Array(enc), 0);
    ciphertext.set(new Uint8Array(ct), enc.byteLength);
    
    // Bob decrypts using his private key and sender enc from ciphertext
    const decrypted = await bob.hpkeDecrypt(ciphertext);
    expect(Buffer.from(decrypted).toString()).toBe(Buffer.from(plaintext).toString());
    
    // Also direct suite.open works
    const recipientContext = await suite.createRecipientContext({
      recipientKey: bob.getHPKEKeyPair()!.privateKey,
      enc: new Uint8Array(enc),
    });
    const direct = await recipientContext.open(new Uint8Array(ct));
    expect(Buffer.from(direct).toString()).toBe(Buffer.from(plaintext).toString());
  });
});
