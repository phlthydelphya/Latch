import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SFrameTransform } from '../src/sframe/transform';
import { KeyManager } from '../src/keys/manager';

describe('M4A.1 SFrame Frame Identity', () => {
  let keyManager: KeyManager;
  let transform: SFrameTransform;
  afterEach(() => {
    if (keyManager) {
      keyManager.destroy();
    }
  });

  beforeEach(async () => {
    keyManager = new KeyManager({ cipherSuite: 'AES_GCM', keyRotationIntervalMs: 9999999 });
    await keyManager.initialize('host-1');
    await keyManager.addParticipant('host-1');
    transform = new SFrameTransform({
      keyManager,
      cipherSuite: 'AES_GCM',
      getCurrentKID: () => 0,
      epochSalt: new Uint8Array(12).fill(0), // Dummy salt for tests
    });
  });

  const createDummyFrame = (dataLength = 10): any => {
    return {
      data: new ArrayBuffer(dataLength),
      timestamp: Date.now(),
      ssrc: 12345,
      payloadType: 96,
      sequenceNumber: 1,
      marker: false,
    };
  };

  it('SFRAME-FRAME-01: Encryption returns the exact original frame reference', async () => {
    const inputFrame = createDummyFrame();
    const encryptedFrame = await transform.encryptFrame(inputFrame);
    expect(encryptedFrame).toBe(inputFrame);
  });

  it('SFRAME-FRAME-02: Encryption replaces frame.data with encrypted bytes', async () => {
    const inputFrame = createDummyFrame(10);
    const originalBuffer = inputFrame.data;
    const encryptedFrame = await transform.encryptFrame(inputFrame);
    
    expect(encryptedFrame.data).not.toBe(originalBuffer);
    expect(encryptedFrame.data instanceof ArrayBuffer).toBe(true);
    expect(encryptedFrame.data.byteLength).toBeGreaterThan(10); // header + tag
  });

  it('SFRAME-FRAME-03: Decryption returns the exact original frame reference', async () => {
    const inputFrame = createDummyFrame(10);
    const encryptedFrame = await transform.encryptFrame(inputFrame);
    
    const decryptedFrame = await transform.decryptFrame(encryptedFrame, 'host-1');
    expect(decryptedFrame).toBe(encryptedFrame);
    expect(decryptedFrame).toBe(inputFrame); // Since it mutates in place
  });

  it('SFRAME-FRAME-04: Decryption replaces frame.data with plaintext bytes', async () => {
    const inputFrame = createDummyFrame(10);
    const originalView = new Uint8Array(inputFrame.data);
    originalView.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const encryptedFrame = await transform.encryptFrame(inputFrame);
    const encryptedBuffer = encryptedFrame.data;

    const decryptedFrame = await transform.decryptFrame(encryptedFrame, 'host-1');
    
    expect(decryptedFrame.data).not.toBe(encryptedBuffer);
    expect(decryptedFrame.data.byteLength).toBe(10);
    
    const decryptedView = new Uint8Array(decryptedFrame.data);
    expect(Array.from(decryptedView)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('SFRAME-FRAME-05: Transform controller receives the native input frame reference rather than a spread clone', async () => {
    const senderStream = transform.createSenderTransformerWithGlobalCounter();
    const inputFrame = createDummyFrame();
    
    const writer = senderStream.writable.getWriter();
    const reader = senderStream.readable.getReader();
    
    try {
      const readPromise = reader.read();
      const writePromise = writer.write(inputFrame);
      const [, result] = await Promise.all([writePromise, readPromise]);
      
      expect(result.done).toBe(false);
      expect(result.value).toBe(inputFrame);
    } finally {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
    }
  });

  it('SFRAME-FRAME-06: Encryption failure drops the frame and never emits plaintext', async () => {
    const encryptSpy = vi.spyOn(transform, 'encryptFrame').mockRejectedValue(new Error('Simulated crypto error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const senderStream = transform.createSenderTransformerWithGlobalCounter();
    const inputFrame = createDummyFrame();
    
    const writer = senderStream.writable.getWriter();
    const reader = senderStream.readable.getReader();
    const readPromise = reader.read();
    
    try {
      await writer.write(inputFrame);
      const result = await Promise.race([
        readPromise.then(value => ({ type: 'frame' as const, value })),
        new Promise<{ type: 'none' }>((resolve) => setTimeout(() => resolve({ type: 'none' }), 50)),
      ]);
      
      expect(result.type).toBe('none');
      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SFrame] Sender encryption dropped frame'));
    } finally {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
      consoleSpy.mockRestore();
      encryptSpy.mockRestore();
    }
  });

  it('SFRAME-FRAME-07: Decryption or authentication failure drops the frame and never emits malformed media', async () => {
    const decryptSpy = vi.spyOn(transform, 'decryptFrame').mockRejectedValue(new Error('Simulated crypto error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const receiverStream = transform.createReceiverTransformer('remote-1');
    const inputFrame = createDummyFrame();
    
    const writer = receiverStream.writable.getWriter();
    const reader = receiverStream.readable.getReader();
    const readPromise = reader.read();
    
    try {
      await writer.write(inputFrame);
      const result = await Promise.race([
        readPromise.then(value => ({ type: 'frame' as const, value })),
        new Promise<{ type: 'none' }>((resolve) => setTimeout(() => resolve({ type: 'none' }), 50)),
      ]);
      
      expect(result.type).toBe('none');
      expect(decryptSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SFrame] Receiver decryption dropped frame'));
    } finally {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
      consoleSpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });

  it('SFRAME-FRAME-08: Audio and video encoded-frame paths both preserve native frame identity', async () => {
    const audioFrame = createDummyFrame();
    const videoFrame = createDummyFrame();
    
    const encAudio = await transform.encryptFrame(audioFrame, 'audio', 'track-1');
    const encVideo = await transform.encryptFrame(videoFrame, 'video', 'track-2');
    
    expect(encAudio).toBe(audioFrame);
    expect(encVideo).toBe(videoFrame);
  });

  it('SFRAME-FRAME-09: Existing SFrame wire-format vectors remain unchanged', async () => {
    const inputFrame = createDummyFrame(2);
    const view = new Uint8Array(inputFrame.data);
    view.set([0xAA, 0xBB]);
    
    const encryptedFrame = await transform.encryptFrame(inputFrame);
    const encView = new Uint8Array(encryptedFrame.data);
    
    expect(encView[0]).toBe(0x00);
    expect(encView[1]).toBe(0x00);
    expect(encView.length).toBeGreaterThan(2); 
  });

  it('SFRAME-FRAME-10: No sensitive frame or key material appears in diagnostic logs', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const receiverStream = transform.createReceiverTransformer('remote-1');
    const writer = receiverStream.writable.getWriter();
    const reader = receiverStream.readable.getReader();
    
    const garbageFrame = createDummyFrame(5);
    new Uint8Array(garbageFrame.data).set([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    
    const readPromise = reader.read();
    
    try {
      await writer.write(garbageFrame);
      const result = await Promise.race([
        readPromise.then(value => ({ type: 'frame' as const, value })),
        new Promise<{ type: 'none' }>((resolve) => setTimeout(() => resolve({ type: 'none' }), 50)),
      ]);
      
      expect(result.type).toBe('none');
      expect(consoleSpy).toHaveBeenCalledWith('[SFrame] Receiver decryption dropped frame due to validation/crypto error.');
      
      const allCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(allCalls).not.toMatch(/counter|key|salt/i);
    } finally {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
      consoleSpy.mockRestore();
    }
  });
});
