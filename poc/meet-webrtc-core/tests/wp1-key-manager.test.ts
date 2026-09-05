/**
 * @vitest-environment node
 * WP-1 KeyManager corrections unit test suite
 * Exit Criteria:
 * - TestDeriveSaltUniqueness PASS
 * - TestCanonicalize PASS
 * Additional Step 1 Gates:
 * - TestRotateDerivesSelf PASS
 * - TestPreviousEpochsEviction PASS
 * - TestWelcomeAADMismatch PASS
 * - TestRotationMutex PASS
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyManager, deriveSalt, canonicalizeIdentity, AsyncMutex } from '../src/keys/manager.js';
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

describe('WP-1: KeyManager Corrections', () => {
  let km: KeyManager;

  beforeEach(async () => {
    km = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    km.stopRotationTimer();
    km.stopSweepTimer();
  });

  afterEach(async () => {
    await km.destroy();
  });

  /**
   * Exit Criteria 1: TestDeriveSaltUniqueness
   * - Salt length is 12 bytes (96 bits per RFC9605 §4.7)
   * - 100 distinct epoch secrets produce 100 unique salts
   * - deriveSalt is deterministic for the same epoch secret
   * - getCurrentSalt matches derived salt across rotations
   */
  it('TestDeriveSaltUniqueness: derives 12-byte salts with 100% uniqueness and determinism', async () => {
    const NUM_SECRETS = 100;
    const saltSet = new Set<string>();

    for (let i = 0; i < NUM_SECRETS; i++) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const key = await crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'HKDF' },
        false,
        ['deriveBits']
      );

      const salt = await deriveSalt(key);

      // Verify length is strictly 12 bytes (96 bits)
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.byteLength).toBe(12);

      const hex = Buffer.from(salt).toString('hex');
      expect(hex.length).toBe(24);
      saltSet.add(hex);

      // Determinism check: calling deriveSalt again with the same key produces the identical salt
      const saltRepeat = await deriveSalt(key);
      expect(Buffer.from(saltRepeat).toString('hex')).toBe(hex);
    }

    // All 100 generated salts must be unique
    expect(saltSet.size).toBe(NUM_SECRETS);

    // Verify KeyManager.prototype.deriveSalt and getCurrentSalt() consistency
    await km.initialize('alice');
    const currentSalt = km.getCurrentSalt();
    expect(currentSalt).not.toBeNull();
    expect(currentSalt?.byteLength).toBe(12);

    const secret = km.getCurrentEpochSecret();
    expect(secret).not.toBeNull();
    const derivedFromSecret = await km.deriveSalt(secret!);
    expect(Buffer.from(currentSalt!).toString('hex')).toBe(Buffer.from(derivedFromSecret).toString('hex'));

    // Rotate epoch and verify new salt is also 12 bytes and distinct from previous
    const oldSaltHex = Buffer.from(currentSalt!).toString('hex');
    await km.rotateEpoch('manual');
    const newSalt = km.getCurrentSalt();
    expect(newSalt).not.toBeNull();
    expect(newSalt?.byteLength).toBe(12);
    const newSaltHex = Buffer.from(newSalt!).toString('hex');
    expect(newSaltHex).not.toBe(oldSaltHex);
  });

  /**
   * Exit Criteria 2: TestCanonicalize
   * - Trims whitespace
   * - Converts uppercase and mixed case to lowercase
   * - Handles empty string
   * - Case collision prevention in participant HPKE keys and sender keys
   */
  it('TestCanonicalize: ensures lowercase, whitespace-trimmed canonical identities across lookups', async () => {
    // 1. Basic canonicalizeIdentity assertions
    expect(canonicalizeIdentity('  Alice  ')).toBe('alice');
    expect(canonicalizeIdentity('BOB')).toBe('bob');
    expect(canonicalizeIdentity('  UsEr_123_TeSt  ')).toBe('user_123_test');
    expect(canonicalizeIdentity('')).toBe('');
    expect(canonicalizeIdentity('   ')).toBe('');

    // 2. KeyManager initialization canonicalizes self ID
    await km.initialize('  Alice_In_Wonderland  ');
    expect(km.getMyCanonicalId()).toBe('alice_in_wonderland');

    // Self sender key is registered under canonical ID
    const myKey = km.getCurrentSenderKey();
    expect(myKey).not.toBeNull();
    const myKeyLookupUpper = km.getSenderKey('ALICE_IN_WONDERLAND', 0);
    const myKeyLookupSpaces = km.getSenderKey('  alice_in_wonderland  ', 0);
    expect(myKeyLookupUpper).toBe(myKey);
    expect(myKeyLookupSpaces).toBe(myKey);

    // 3. Participant HPKE public key lookups are case/space insensitive
    const peer = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await peer.initialize('bob');
    const peerPubB64 = await peer.exportHPKEPublicKey();
    const peerPub = await km.importHPKEPublicKey(peerPubB64);

    // Register with uppercase and whitespace
    km.setParticipantHPKEPublicKey('  Bob_The_Builder  ', peerPub);

    // Retrieve with lowercase and no whitespace
    const retrieved1 = km.getParticipantHPKEPublicKey('bob_the_builder');
    expect(retrieved1).toBe(peerPub);

    // Retrieve with mixed case
    const retrieved2 = km.getParticipantHPKEPublicKey('BOB_THE_BUILDER');
    expect(retrieved2).toBe(peerPub);

    // 4. Participant sender key derivation and lookups are case/space insensitive
    await km.addParticipant('  Carol_Danvers  ');
    const carolKey1 = km.getSenderKey('carol_danvers', 0);
    const carolKey2 = km.getSenderKey('CAROL_DANVERS', 0);
    const carolKey3 = km.getSenderKey('  cArOl_DaNvErS  ', 0);
    expect(carolKey1).not.toBeNull();
    expect(carolKey1).toBe(carolKey2);
    expect(carolKey1).toBe(carolKey3);

    // 5. Removing participant with mixed case succeeds
    km.removeParticipantHPKEPublicKey('  BOB_THE_BUILDER  ');
    expect(km.getParticipantHPKEPublicKey('bob_the_builder')).toBeNull();

    await peer.destroy();
  });

  /**
   * Additional Step 1 Gate: TestRotateDerivesSelf
   * - rotateEpoch re-derives sender keys for self and all remaining participants
   * - Leaving participant is excluded
   */
  it('TestRotateDerivesSelf: re-derives senderKey for self and peers on epoch rotation', async () => {
    await km.initialize('alice');

    // Add Bob and Charlie
    const bob = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await bob.initialize('bob');
    const bobPub = await km.importHPKEPublicKey(await bob.exportHPKEPublicKey());
    km.setParticipantHPKEPublicKey('bob', bobPub);
    await km.addParticipant('bob');

    const charlie = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await charlie.initialize('charlie');
    const charliePub = await km.importHPKEPublicKey(await charlie.exportHPKEPublicKey());
    km.setParticipantHPKEPublicKey('charlie', charliePub);
    await km.addParticipant('charlie');

    // Initial epoch 0 keys
    const aliceKeyEpoch0 = km.getCurrentSenderKey();
    const bobKeyEpoch0 = km.getSenderKey('bob', 0);
    const charlieKeyEpoch0 = km.getSenderKey('charlie', 0);
    expect(aliceKeyEpoch0).not.toBeNull();
    expect(bobKeyEpoch0).not.toBeNull();
    expect(charlieKeyEpoch0).not.toBeNull();

    // Rotate epoch with Charlie leaving
    const { commits, newEpoch } = await km.rotateEpoch('leave', 'charlie');
    expect(newEpoch).toBe(1);

    // Commits should contain Bob but not Charlie
    expect(commits.has('bob')).toBe(true);
    expect(commits.has('charlie')).toBe(false);

    // Epoch 1 keys: Alice and Bob have re-derived keys, Charlie is gone
    const aliceKeyEpoch1 = km.getCurrentSenderKey();
    const bobKeyEpoch1 = km.getSenderKey('bob', 1);
    const charlieKeyEpoch1 = km.getSenderKey('charlie', 1);

    expect(aliceKeyEpoch1).not.toBeNull();
    expect(bobKeyEpoch1).not.toBeNull();
    expect(charlieKeyEpoch1).toBeNull(); // Excluded from new epoch

    // Keys changed from epoch 0 to epoch 1
    expect(aliceKeyEpoch1).not.toBe(aliceKeyEpoch0);
    expect(bobKeyEpoch1).not.toBe(bobKeyEpoch0);

    // Old epoch 0 keys are still accessible in previousEpochs for replay grace period
    const aliceKeyOld = km.getSenderKey('alice', 0);
    const bobKeyOld = km.getSenderKey('bob', 0);
    expect(aliceKeyOld).toBe(aliceKeyEpoch0);
    expect(bobKeyOld).toBe(bobKeyEpoch0);

    await bob.destroy();
    await charlie.destroy();
  });

  /**
   * Additional Step 1 Gate: TestPreviousEpochsEviction
   * - Enforces max 3 previous epochs
   * - Zeroizes raw secrets and salts on eviction
   * - TTL sweep removes epochs older than 30s
   */
  it('TestPreviousEpochsEviction: caps previous epochs at 3 and zeroes secrets upon TTL eviction', async () => {
    await km.initialize('alice');

    // Perform 5 rotations: epochs 0, 1, 2, 3, 4, 5
    for (let i = 0; i < 5; i++) {
      await km.rotateEpoch('manual');
    }
    expect(km.getCurrentEpoch()).toBe(5);

    const prevEpochs = km.getPreviousEpochs();
    // Maximum previous epochs must not exceed 3
    expect(prevEpochs.size).toBeLessThanOrEqual(KeyManager.MAX_PREVIOUS_EPOCHS);
    expect(prevEpochs.size).toBe(3);

    // Retained epochs should be the most recent 3: epochs 2, 3, 4
    expect(prevEpochs.has(2)).toBe(true);
    expect(prevEpochs.has(3)).toBe(true);
    expect(prevEpochs.has(4)).toBe(true);
    expect(prevEpochs.has(0)).toBe(false); // Evicted
    expect(prevEpochs.has(1)).toBe(false); // Evicted

    // Test TTL eviction
    // Artificially age epoch 2 past the 30s TTL
    const epoch2Data = prevEpochs.get(2)!;
    epoch2Data.createdAt = Date.now() - (KeyManager.PREVIOUS_EPOCH_TTL_MS + 5000);

    const rawSecretRef = epoch2Data.epochSecretRaw;
    const saltRef = epoch2Data.salt;

    // Run sweep
    km.sweepPreviousEpochs();

    // Epoch 2 should now be evicted
    expect(prevEpochs.has(2)).toBe(false);
    expect(prevEpochs.size).toBe(2);

    // Verify zeroization of evicted material
    expect(rawSecretRef.every(b => b === 0)).toBe(true);
    expect(saltRef.every(b => b === 0)).toBe(true);
  });

  /**
   * Additional Step 1 Gate: TestWelcomeAADMismatch (T-02 security test)
   * - Welcome ciphertext binds roomIdHash in AAD
   * - Correct roomId decrypts successfully
   * - Mismatched roomId fails HPKE open
   * - Mismatched expectedEpoch fails verification
   */
  it('TestWelcomeAADMismatch: verifies roomId and epoch binding in Welcome prevents cross-room replays', async () => {
    await km.initialize('alice');

    const joiner = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await joiner.initialize('bob');
    const joinerPub = await km.importHPKEPublicKey(await joiner.exportHPKEPublicKey());

    const secret = km.getCurrentEpochSecret()!;
    const roomId = 'meeting-secret-room-alpha';
    const epoch = 0;

    // Create Welcome with roomId binding
    const welcome = await km.createWelcome(secret, joinerPub, roomId, epoch);

    // 1. Joiner processes Welcome with correct roomId and expectedEpoch -> PASS
    const derivedKey = await joiner.processWelcome(welcome, roomId, epoch);
    expect(derivedKey).toBeDefined();
    expect(joiner.getCurrentEpoch()).toBe(0);
    expect(joiner.getCurrentSalt()?.byteLength).toBe(12);

    // 2. Processing with mismatched roomId -> FAIL (HPKE open failure / AEAD tag mismatch)
    const joinerCrossRoom = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await joinerCrossRoom.initialize('bob-replay');
    // Joiner uses same private key to simulate cross-room replay attack
    (joinerCrossRoom as any).hpkeKeyPair = (joiner as any).hpkeKeyPair;

    await expect(
      joinerCrossRoom.processWelcome(welcome, 'different-room-beta', epoch)
    ).rejects.toThrow();

    // 3. Processing with mismatched epoch -> FAIL
    const joinerWrongEpoch = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 60000 });
    await joinerWrongEpoch.initialize('bob-wrong-epoch');
    (joinerWrongEpoch as any).hpkeKeyPair = (joiner as any).hpkeKeyPair;

    await expect(
      joinerWrongEpoch.processWelcome(welcome, roomId, 99)
    ).rejects.toThrow(/Welcome epoch mismatch/);

    await joiner.destroy();
    await joinerCrossRoom.destroy();
    await joinerWrongEpoch.destroy();
  });

  /**
   * Additional Step 1 Gate: TestRotationMutex
   * - Serializes concurrent async operations
   * - Prevents concurrency races and interleaving
   * - Releases on error
   */
  it('TestRotationMutex: enforces single-flight serialization on AsyncMutex', async () => {
    const mutex = new AsyncMutex();
    const executionOrder: number[] = [];
    let concurrentCount = 0;
    let maxConcurrency = 0;

    const runTask = async (id: number, delayMs: number) => {
      return mutex.run(async () => {
        concurrentCount++;
        maxConcurrency = Math.max(maxConcurrency, concurrentCount);
        await new Promise((r) => setTimeout(r, delayMs));
        executionOrder.push(id);
        concurrentCount--;
        return id;
      });
    };

    // Launch 5 tasks concurrently
    const promises = [
      runTask(1, 30),
      runTask(2, 20),
      runTask(3, 10),
      runTask(4, 5),
      runTask(5, 1),
    ];

    const results = await Promise.all(promises);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrency).toBe(1); // Never more than 1 running concurrently
    expect(mutex.isLocked()).toBe(false);

    // Verify mutex releases properly on error
    await expect(
      mutex.run(async () => {
        throw new Error('Task failure');
      })
    ).rejects.toThrow('Task failure');

    expect(mutex.isLocked()).toBe(false);

    // Next task runs normally after failure
    const afterResult = await mutex.run(async () => 'recovered');
    expect(afterResult).toBe('recovered');
  });
});
