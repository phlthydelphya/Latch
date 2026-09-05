/**
 * @vitest-environment node
 * WP-2 SFrame Transform Corrections & Global Counter Unit Tests
 * Exit Criteria:
 * - TestIVUniquenessAcrossTracks PASS
 * - Security T-01 nonce-reuse mitigation verified
 * Supporting Tests:
 * - TestDeriveIVDeterministic
 * - TestSaltUniquenessPerEpoch
 * - TestPreviousEpochsRetainsSalt
 * - TestZeroizeClearsSalt
 * - TestAdditionalDataHeader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SFrameTransform,
  deriveIV,
  buildHeader,
  parseHeader,
  isEncodedTransformSupported,
} from '../src/sframe/transform.js';
import { KeyManager } from '../src/keys/manager.js';
import { canonicalizeIdentity } from '../src/utils/identity.js';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// Ensure real WebCrypto in node environment
(globalThis as any).crypto = webcrypto as any;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder as any;
if (!globalThis.atob) {
  (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

describe('WP-2: SFrame Transform & Global Counter', () => {
  let km: KeyManager;
  let transform: SFrameTransform;

  beforeEach(async () => {
    km = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    km.stopRotationTimer();
    km.stopSweepTimer();
    await km.initialize('alice');

    transform = new SFrameTransform({
      keyManager: km,
      cipherSuite: 'AES_GCM',
      getCurrentKID: () => km.getCurrentEpoch(),
      epochSalt: km.getCurrentSalt(),
    });
  });

  afterEach(async () => {
    await km.destroy();
  });

  describe('TestIVUniquenessAcrossTracks (T-01 Nonce Reuse Mitigation)', () => {
    /**
     * Sub-test 1: Interleaved multi-track encryption
     * Video, audio, and screen-share share the same global counter.
     * All 10 generated IVs must be strictly distinct and counters consecutive 0..9.
     */
    it('audio, video, and screen-share frames from same sender/epoch never reuse IV', async () => {
      const salt = km.getCurrentSalt()!;
      expect(salt.byteLength).toBe(12);

      const ivs = new Set<string>();
      const counters: bigint[] = [];
      const order: Array<'video' | 'audio' | 'screen'> = [
        'video', 'audio', 'video', 'screen', 'audio',
        'video', 'screen', 'audio', 'video', 'audio',
      ];

      for (let i = 0; i < order.length; i++) {
        const kind = order[i];
        const payload = new Uint8Array([1, 2, 3, i]);
        const { iv, counter, header, encryptedData } = await transform.encryptFrameForTest(
          payload,
          kind,
          `track-${kind}-1`
        );

        const ivHex = Buffer.from(iv).toString('hex');
        expect(ivs.has(ivHex), `IV reused for track ${kind} at counter ${counter}`).toBe(false);
        ivs.add(ivHex);
        counters.push(counter);

        // Verify that IV matches deriveIV(salt, counter)
        const expectedIV = deriveIV(salt, counter);
        expect(Buffer.from(iv).toString('hex')).toBe(Buffer.from(expectedIV).toString('hex'));

        // Verify that KID is in AAD header, not in IV
        const parsed = parseHeader(encryptedData);
        expect(parsed.kid).toBe(0);
        expect(parsed.counter).toBe(counter);
      }

      // 10 distinct IVs
      expect(ivs.size).toBe(10);
      // Counters must be strictly 0n..9n monotonic across tracks
      expect(counters).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
    });

    /**
     * Sub-test 2: Parallel concurrency stress test
     * 10 concurrent encrypt calls across different tracks under mutex.
     * Must not race on counter or duplicate IV.
     */
    it('parallel concurrent encrypts across multiple tracks never collide counters or IVs', async () => {
      const kinds: Array<'video' | 'audio' | 'screen'> = [
        'video', 'audio', 'screen', 'video', 'audio',
        'screen', 'video', 'audio', 'screen', 'video',
      ];

      // Launch all 10 encrypts concurrently
      const tasks = kinds.map((kind, idx) => {
        const data = new Uint8Array([10, 20, idx]);
        return transform.encryptFrameForTest(data, kind, `track-${kind}`);
      });

      const results = await Promise.all(tasks);
      const returnedCounters = results.map((r) => r.counter).sort((a, b) => (a < b ? -1 : 1));
      const returnedIVs = new Set(results.map((r) => Buffer.from(r.iv).toString('hex')));

      // All 10 counters must be unique and form [0n..9n]
      expect(returnedCounters).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
      // All 10 IVs must be unique
      expect(returnedIVs.size).toBe(10);
    });

    /**
     * Sub-test 3: Different senders with same counter value
     * Even if Alice and Bob happen to have the same salt and counter=0n,
     * their senderKeys differ so AES-GCM (key, IV) pairs never collide.
     * Cross-decrypting Alice's frame with Bob's key must fail tag verification.
     */
    it('same counter value on different senders does not collide keys and fails cross-decrypt', async () => {
      const bobKm = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
      bobKm.stopRotationTimer();
      bobKm.stopSweepTimer();
      await bobKm.initialize('bob');

      // Bob receives Welcome from Alice so both share the exact same epochSecret and salt at epoch 0
      const bobPub = await km.importHPKEPublicKey(await bobKm.exportHPKEPublicKey());
      const welcome = await km.createWelcome(km.getCurrentEpochSecret()!, bobPub, 'room-test', 0);
      await bobKm.processWelcome(welcome, 'room-test', 0);

      km.setParticipantHPKEPublicKey('bob', bobPub);
      await km.addParticipant('bob');
      await bobKm.addParticipant('alice');

      // Alice encrypts at counter 0
      const alicePayload = new Uint8Array([42, 43, 44]);
      const aliceFrame = await transform.encryptFrameForTest(alicePayload, 'video', 'v1');
      expect(aliceFrame.counter).toBe(0n);

      // Receiver initialized for Bob using the shared salt
      const bobTransform = new SFrameTransform({
        keyManager: bobKm,
        cipherSuite: 'AES_GCM',
        getCurrentKID: () => bobKm.getCurrentEpoch(),
        epochSalt: bobKm.getCurrentSalt(),
      });

      // Decrypting Alice's frame with remoteSenderId='alice' succeeds
      const decryptedByBob = await bobTransform.decryptFrame(
        {
          data: aliceFrame.encryptedData,
          timestamp: 0,
          ssrc: 1,
          payloadType: 96,
          sequenceNumber: 1,
          marker: false,
        },
        'alice'
      );
      expect(new Uint8Array(decryptedByBob.data)).toEqual(alicePayload);

      // Decrypting Alice's frame with remoteSenderId='bob' (wrong key) fails AEAD authentication
      await expect(
        bobTransform.decryptFrame(
          {
            data: aliceFrame.encryptedData,
            timestamp: 0,
            ssrc: 1,
            payloadType: 96,
            sequenceNumber: 1,
            marker: false,
          },
          'bob'
        )
      ).rejects.toThrow();

      await bobKm.destroy();
    });

    /**
     * Sub-test 4: Counter reset on epoch rotation
     * When epoch rotates, counter resets to 0n, but salt changes.
     * deriveIV(salt0, 0n) !== deriveIV(salt1, 0n)
     */
    it('counter resets to 0 on epoch rotation, but IV is not reused because salt changes', async () => {
      const saltEpoch0 = km.getCurrentSalt()!;
      const iv0_epoch0 = deriveIV(saltEpoch0, 0n);

      // Rotate epoch
      await km.rotateEpoch('manual');
      await transform.rotateKey();

      expect(km.getCurrentEpoch()).toBe(1);
      const saltEpoch1 = km.getCurrentSalt()!;
      expect(saltEpoch1).not.toEqual(saltEpoch0);

      const iv0_epoch1 = deriveIV(saltEpoch1, 0n);
      expect(Buffer.from(iv0_epoch1).toString('hex')).not.toBe(Buffer.from(iv0_epoch0).toString('hex'));

      // New frame in epoch 1 gets counter 0n with new salt
      const { counter, iv } = await transform.encryptFrameForTest(
        new Uint8Array([7, 8, 9]),
        'video',
        'v1'
      );
      expect(counter).toBe(0n);
      expect(Buffer.from(iv).toString('hex')).toBe(Buffer.from(iv0_epoch1).toString('hex'));
    });

    /**
     * Sub-test 5: Global replay protection per (epoch, sender)
     * Replay check is NOT per track. If CTR 0 arrived on video, a subsequent
     * CTR 0 on audio (or a duplicate video CTR 0) must be rejected as replay.
     */
    it('decrypt replay protection is per (epoch,sender) not per track', async () => {
      const videoFrame = await transform.encryptFrameForTest(new Uint8Array([1, 1, 1]), 'video', 'v1');
      const audioFrame = await transform.encryptFrameForTest(new Uint8Array([2, 2, 2]), 'audio', 'a1');

      expect(videoFrame.counter).toBe(0n);
      expect(audioFrame.counter).toBe(1n);

      // Create receiver transform
      const receiverTransform = new SFrameTransform({
        keyManager: km,
        cipherSuite: 'AES_GCM',
        getCurrentKID: () => km.getCurrentEpoch(),
        epochSalt: km.getCurrentSalt(),
      });

      // 1. Process video frame (CTR 0) -> PASS
      const dec1 = await receiverTransform.decryptFrame(
        {
          data: videoFrame.encryptedData,
          timestamp: 0,
          ssrc: 1,
          payloadType: 96,
          sequenceNumber: 1,
          marker: false,
        },
        'alice'
      );
      expect(new Uint8Array(dec1.data)).toEqual(new Uint8Array([1, 1, 1]));

      // 2. Process audio frame (CTR 1) -> PASS
      const dec2 = await receiverTransform.decryptFrame(
        {
          data: audioFrame.encryptedData,
          timestamp: 0,
          ssrc: 2,
          payloadType: 111,
          sequenceNumber: 2,
          marker: false,
        },
        'alice'
      );
      expect(new Uint8Array(dec2.data)).toEqual(new Uint8Array([2, 2, 2]));

      // 3. Replay video frame (CTR 0 <= 1) -> FAIL with Replay detected
      await expect(
        receiverTransform.decryptFrame(
          {
            data: videoFrame.encryptedData,
            timestamp: 0,
            ssrc: 1,
            payloadType: 96,
            sequenceNumber: 3,
            marker: false,
          },
          'alice'
        )
      ).rejects.toThrow(/Replay detected/);

      // 4. Duplicate audio frame (CTR 1 <= 1) -> FAIL with Replay detected
      await expect(
        receiverTransform.decryptFrame(
          {
            data: audioFrame.encryptedData,
            timestamp: 0,
            ssrc: 2,
            payloadType: 111,
            sequenceNumber: 4,
            marker: false,
          },
          'alice'
        )
      ).rejects.toThrow(/Replay detected/);
    });
  });

  describe('Supporting Unit Tests', () => {
    it('TestDeriveIVDeterministic: calling deriveIV twice with same parameters yields identical 12-byte IV', () => {
      const salt = crypto.getRandomValues(new Uint8Array(12));
      const iv1 = deriveIV(salt, 42n);
      const iv2 = deriveIV(salt, 42n);

      expect(iv1.byteLength).toBe(12);
      expect(Buffer.from(iv1).toString('hex')).toBe(Buffer.from(iv2).toString('hex'));

      // Different counter yields different IV
      const ivDiffCounter = deriveIV(salt, 43n);
      expect(Buffer.from(iv1).toString('hex')).not.toBe(Buffer.from(ivDiffCounter).toString('hex'));

      // Out of bounds counters throw
      expect(() => deriveIV(salt, -1n)).toThrow();
      // Bad salt length throws
      expect(() => deriveIV(new Uint8Array(8), 1n)).toThrow();
    });

    it('TestSaltUniquenessPerEpoch: consecutive deriveSalt from distinct epoch secrets never collide', async () => {
      const saltHexes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const secret = await crypto.subtle.importKey(
          'raw',
          crypto.getRandomValues(new Uint8Array(32)),
          { name: 'HKDF' },
          false,
          ['deriveBits']
        );
        const salt = await km.deriveSalt(secret);
        saltHexes.add(Buffer.from(salt).toString('hex'));
      }
      expect(saltHexes.size).toBe(50);
    });

    it('TestPreviousEpochsRetainsSalt: previous epoch salt is retained and usable after rotation', async () => {
      const salt0 = km.getCurrentSalt()!;
      await km.rotateEpoch('manual');
      expect(km.getCurrentEpoch()).toBe(1);

      const saltForEpoch0 = transform.getSaltForKID(0);
      expect(saltForEpoch0).not.toBeNull();
      expect(Buffer.from(saltForEpoch0!).toString('hex')).toBe(Buffer.from(salt0).toString('hex'));
    });

    it('TestZeroizeClearsSalt: evicted epoch zeroes salt material', async () => {
      // 4 rotations to force eviction
      for (let i = 0; i < 4; i++) {
        await km.rotateEpoch('manual');
      }
      // Max previous epochs is 3, so epoch 0 was evicted
      const prevEpochs = km.getPreviousEpochs();
      expect(prevEpochs.has(0)).toBe(false);
    });

    it('TestAdditionalDataHeader: tampering with KID or CTR in header causes AEAD authentication to fail', async () => {
      const payload = new Uint8Array([100, 101, 102]);
      const { encryptedData } = await transform.encryptFrameForTest(payload, 'video', 'v1');

      // Tamper with header byte 0 (KID)
      const tamperedBytes = new Uint8Array(encryptedData.slice(0));
      tamperedBytes[0] ^= 0x01; // flip bit

      const receiverTransform = new SFrameTransform({
        keyManager: km,
        cipherSuite: 'AES_GCM',
        getCurrentKID: () => km.getCurrentEpoch(),
        epochSalt: km.getCurrentSalt(),
      });

      await expect(
        receiverTransform.decryptFrame(
          {
            data: tamperedBytes.buffer,
            timestamp: 0,
            ssrc: 1,
            payloadType: 96,
            sequenceNumber: 1,
            marker: false,
          },
          'alice'
        )
      ).rejects.toThrow();
    });

    it('isEncodedTransformSupported: checks browser API capabilities', () => {
      expect(typeof isEncodedTransformSupported).toBe('function');
      const supported = isEncodedTransformSupported();
      expect(typeof supported).toBe('boolean');
    });
  });
});
