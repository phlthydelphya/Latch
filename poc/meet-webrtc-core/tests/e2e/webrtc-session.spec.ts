// tests/e2e/webrtc-session.spec.ts
// E2E test to establish LIVE WebRTC session between 2 browsers with fake media
import { test, expect } from '@playwright/test';

test.describe.configure({ retries: 0, timeout: 300000 }); // 5 min timeout for sustained session

const ROOM_ID = 'testroom' + Date.now().toString(36);
const KEY_PARAM = 'testkey1234567890abcdef'; // 32 chars

// Configuration-driven base URL — no hardcoded 127.0.0.1
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.VITE_APP_URL ?? 'http://127.0.0.1:5173';

test('LIVE WebRTC session: 2 browsers join same room with fake media', async ({ browser }) => {
  // Browser 1 - Creator
  // Fake media is injected via addInitScript below, so no real camera/mic
  // permissions are needed (Firefox rejects the 'camera' permission name).
  const context1 = await browser.newContext();

  const page1 = await context1.newPage();
  
  // Enable fake media for page1
  await page1.addInitScript(() => {
    // Override getUserMedia to return fake stream
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      console.log('[Page1] getUserMedia called with:', constraints);
      
      // Create fake video track
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      
      // Draw animated pattern
      let frame = 0;
      const animate = () => {
        ctx.fillStyle = `hsl(${frame % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = 'white';
        ctx.font = '48px monospace';
        ctx.fillText(`FAKE VIDEO - Browser 1`, 100, 240);
        ctx.fillText(`Frame: ${frame}`, 100, 300);
        frame++;
        requestAnimationFrame(animate);
      };
      animate();
      
      const videoStream = canvas.captureStream(30); // 30 fps
      const videoTrack = videoStream.getVideoTracks()[0];
      
      // Create fake audio track (silence) without requiring a user gesture
      const audioCtx = new AudioContext();
      const dst = audioCtx.createMediaStreamDestination();
      const audioTrack = dst.stream.getAudioTracks()[0];
      
      const fakeStream = new MediaStream();
      if (constraints.video) fakeStream.addTrack(videoTrack);
      if (constraints.audio) fakeStream.addTrack(audioTrack);
      
      console.log('[Page1] Created fake stream with tracks:', fakeStream.getTracks().map(t => t.kind));
      return fakeStream;
    };
  });

  // Browser 2 - Joiner
  const context2 = await browser.newContext();

  const page2 = await context2.newPage();
  
  await page2.addInitScript(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      console.log('[Page2] getUserMedia called with:', constraints);
      
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      
      let frame = 0;
      const animate = () => {
        ctx.fillStyle = `hsl(${(frame + 180) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = 'white';
        ctx.font = '48px monospace';
        ctx.fillText(`FAKE VIDEO - Browser 2`, 100, 240);
        ctx.fillText(`Frame: ${frame}`, 100, 300);
        frame++;
        requestAnimationFrame(animate);
      };
      animate();
      
      const videoStream = canvas.captureStream(30);
      const videoTrack = videoStream.getVideoTracks()[0];
      
      // Create fake audio track (silence) without requiring a user gesture
      const audioCtx = new AudioContext();
      const dst = audioCtx.createMediaStreamDestination();
      const audioTrack = dst.stream.getAudioTracks()[0];
      
      const fakeStream = new MediaStream();
      if (constraints.video) fakeStream.addTrack(videoTrack);
      if (constraints.audio) fakeStream.addTrack(audioTrack);
      
      console.log('[Page2] Created fake stream with tracks:', fakeStream.getTracks().map(t => t.kind));
      return fakeStream;
    };
  });

  // Console logging for both pages
  page1.on('console', msg => console.log('[Page1 Console]', msg.text()));
  page1.on('pageerror', err => console.error('[Page1 Error]', err.message));
  page2.on('console', msg => console.log('[Page2 Console]', msg.text()));
  page2.on('pageerror', err => console.error('[Page2 Error]', err.message));

  try {
// ========== BROWSER 1: Create room and join ==========
  console.log('\n=== BROWSER 1: Creating room ===');
  await page1.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  
  // Fill landing page form
  await page1.fill('#roomId', ROOM_ID);
  await page1.fill('#name', 'Browser-1');
  await page1.click('button[type="submit"]');
  
  // Wait for navigation to pre-join (room ID gets sanitized to lowercase alphanumeric)
  const sanitizedRoomId = ROOM_ID.toLowerCase().replace(/[^a-z0-9]/g, '');
  await page1.waitForURL(`**/r/${sanitizedRoomId}*`, { timeout: 10000 });
  console.log('[Page1] Navigated to pre-join page, room:', sanitizedRoomId);
    
    // Wait for preview to load
    await page1.waitForSelector('video', { timeout: 10000 });
    console.log('[Page1] Preview video element found');
    
    // Click Join button
    await page1.click('button:has-text("Join Meeting")');
    console.log('[Page1] Clicked Join Meeting');
    
    // Wait for navigation to meeting page with key in hash
    await page1.waitForURL(`**/r/${sanitizedRoomId}*/join#k=*`, { timeout: 15000 });
    const url1 = page1.url();
    console.log('[Page1] Joined meeting at:', url1);
    
    // Extract key from URL for browser 2
    const keyMatch = url1.match(/#k=([^&]+)/);
    const actualKeyParam = keyMatch ? keyMatch[1] : KEY_PARAM;
    console.log('[Page1] Key param:', actualKeyParam.slice(0, 8) + '...');
    
    // Wait for connection indicator
    await page1.waitForSelector('[role="status"]', { timeout: 15000 });
    console.log('[Page1] Connected to meeting');

    // ========== BROWSER 2: Join same room ==========
    console.log('\n=== BROWSER 2: Joining room ===');
    await page2.goto(`${BASE_URL}/r/${sanitizedRoomId}#k=${actualKeyParam}`, { waitUntil: 'networkidle' });
    console.log('[Page2] Navigated to pre-join with key');
    
    // Fill name on landing/pre-join (if redirected to landing, fill and submit)
    try {
      await page2.fill('#name', 'Browser-2', { timeout: 5000 });
      await page2.click('button[type="submit"]');
      console.log('[Page2] Submitted name on landing');
    } catch {
      console.log('[Page2] Already on pre-join page');
    }
    
    // Wait for pre-join page (use sanitized room ID, allow hash)
    await page2.waitForURL(`**/r/${sanitizedRoomId}*`, { timeout: 10000 });
    console.log('[Page2] On pre-join page');
    
    // Wait for preview
    await page2.waitForSelector('video', { timeout: 10000 });
    console.log('[Page2] Preview video element found');
    
    // Click Join
    await page2.click('button:has-text("Join Meeting")');
    console.log('[Page2] Clicked Join Meeting');
    
    // Wait for meeting page
    await page2.waitForURL(`**/r/${sanitizedRoomId}*/join#k=*`, { timeout: 15000 });
    console.log('[Page2] Joined meeting at:', page2.url());
    
    // Wait for connection
    await page2.waitForSelector('[role="status"]', { timeout: 15000 });
    console.log('[Page2] Connected to meeting');

    // ========== VERIFY WEBRTC CONNECTION ==========
    console.log('\n=== VERIFYING WEBRTC CONNECTION ===');
    
    // Check peer connection states via page evaluation
    const pcState1 = await page1.evaluate(async () => {
      // Access the WebRTC manager through React context or global
      // We'll check via the app store or directly
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        const pc = mgr?.peerConnection;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            iceGatheringState: pc.iceGatheringState,
          };
        }
      }
      // Fallback: check via useAppStore
      const store = (window as any).__APP_STORE__;
      if (store) {
        return { storeConnected: store.getState().isConnected };
      }
      return { error: 'No manager found' };
    });
    console.log('[Page1] PeerConnection state:', pcState1);

    const pcState2 = await page2.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        const pc = mgr?.peerConnection;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            iceGatheringState: pc.iceGatheringState,
          };
        }
      }
      const store = (window as any).__APP_STORE__;
      if (store) {
        return { storeConnected: store.getState().isConnected };
      }
      return { error: 'No manager found' };
    });
    console.log('[Page2] PeerConnection state:', pcState2);

    // Get stats from both browsers
    const stats1 = await page1.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page1] Connection stats available:', !!stats1);

    const stats2 = await page2.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page2] Connection stats available:', !!stats2);

    // Check remote streams are received
    const remoteStreams1 = await page1.evaluate(() => {
      const store = (window as any).__APP_STORE__;
      if (store) {
        const state = store.getState();
        return {
          remoteCount: state.remoteStreams?.size || 0,
          participants: Array.from(state.participants?.values() || []).map(p => ({ id: p.id, name: p.name, audio: p.audioEnabled, video: p.videoEnabled }))
        };
      }
      return { error: 'No store' };
    });
    console.log('[Page1] Remote streams/participants:', remoteStreams1);

    const remoteStreams2 = await page2.evaluate(() => {
      const store = (window as any).__APP_STORE__;
      if (store) {
        const state = store.getState();
        return {
          remoteCount: state.remoteStreams?.size || 0,
          participants: Array.from(state.participants?.values() || []).map(p => ({ id: p.id, name: p.name, audio: p.audioEnabled, video: p.videoEnabled }))
        };
      }
      return { error: 'No store' };
    });
    console.log('[Page2] Remote streams/participants:', remoteStreams2);

    // Verify both see each other
    expect(remoteStreams1.participants.length).toBeGreaterThanOrEqual(1);
    expect(remoteStreams2.participants.length).toBeGreaterThanOrEqual(1);

    // ========== KEEP ALIVE FOR MEDIA CAPTURE ==========
    console.log('\n=== KEEPING BROWSERS ALIVE FOR MEDIA CAPTURE ===');
    console.log('Room ID:', ROOM_ID);
    console.log('Key Param:', actualKeyParam);
    console.log('Page1 URL:', page1.url());
    console.log('Page2 URL:', page2.url());
    console.log('Both browsers streaming... (will keep alive for 120 seconds for tshark capture)');
    
    // Keep alive for 2 minutes to allow tshark capture
    await page1.waitForTimeout(120000);
    
    // Final stats before closing
    const finalStats1 = await page1.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page1] Final stats:', JSON.stringify(finalStats1).slice(0, 500));

    const finalStats2 = await page2.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page2] Final stats:', JSON.stringify(finalStats2).slice(0, 500));

    // Verify connection states are still connected
    const finalPcState1 = await page1.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        const pc = mgr?.peerConnection;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
          };
        }
      }
      return { error: 'No manager' };
    });
    console.log('[Page1] Final PC state:', finalPcState1);

    const finalPcState2 = await page2.evaluate(async () => {
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        const pc = mgr?.peerConnection;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
          };
        }
      }
      return { error: 'No manager' };
    });
    console.log('[Page2] Final PC state:', finalPcState2);

    expect(finalPcState1.connectionState).toBe('connected');
    expect(finalPcState2.connectionState).toBe('connected');
    
    console.log('\n✅ LIVE WebRTC session established and sustained for media capture!');
    
  } finally {
    // Note: We intentionally do NOT close browsers here to keep media flowing
    // The test runner will close them after the test
    console.log('\n⚠️ Test ending - browsers will be closed by test runner');
    console.log('If you need browsers to stay open longer, run with --headed or increase timeout');
  }
});