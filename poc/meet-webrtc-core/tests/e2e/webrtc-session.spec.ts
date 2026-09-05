// tests/e2e/webrtc-session.spec.ts
// E2E test to establish LIVE WebRTC session between 2 browsers with fake media
import { test, expect } from '@playwright/test';

test.describe.configure({ retries: 0, timeout: 300000 }); // 5 min timeout for sustained session

const ROOM_ID = 'testroom' + Date.now().toString(36);
const KEY_PARAM = 'testkey1234567890abcdef'; // 32 chars

// Configuration-driven base URL — no hardcoded 127.0.0.1
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.VITE_APP_URL ?? 'http://127.0.0.1:5173';

test('LIVE WebRTC session: 2 browsers join same room with fake media', async ({ browser, browserName }) => {
  // Playwright WebKit on Windows lacks WebRTC/MediaStream APIs entirely.
  // Safari 17.4 criterion (M0-P0 criterion 1) requires macOS+iOS PWA, not
  // Playwright WebKit on Windows. Skip gracefully.
  test.skip(browserName === 'webkit', 'WebKit on Windows lacks WebRTC — requires macOS Safari 17.4+');

  // Browser 1 - Creator
  // Fake media is injected via addInitScript below, so no real camera/mic
  // permissions are needed (Firefox rejects the 'camera' permission name).
  const context1 = await browser.newContext();

  const page1 = await context1.newPage();
  
  // Enable fake media for page1
  await page1.addInitScript(() => {
    // Full MediaDevices shim: EventTarget + getUserMedia + enumerateDevices
    // WebKit on Windows may not have navigator.mediaDevices defined or fully implemented
    const shim = function(label: string) {
      const listeners: Record<string, Array<EventListenerOrEventListenerObject>> = {};
      const fakeDevices: MediaDeviceInfo[] = [
        { deviceId: 'fake-video-1', groupId: 'fake-group-1', kind: 'videoinput', label: `${label} Camera`, toJSON() { return this; } },
        { deviceId: 'fake-audio-1', groupId: 'fake-group-2', kind: 'audioinput', label: `${label} Microphone`, toJSON() { return this; } },
      ];

      const shimObj: any = {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(listener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (!listeners[type]) return;
          listeners[type] = listeners[type].filter((l: any) => l !== listener);
        },
        dispatchEvent(event: Event): boolean {
          const ls = listeners[event.type] || [];
          for (const l of ls) {
            if (typeof l === 'function') l(event);
            else l.handleEvent(event);
          }
          return true;
        },
        get ondevicechange(): any { return null; },
        set ondevicechange(_v: any) {},
        async enumerateDevices(): Promise<MediaDeviceInfo[]> {
          return fakeDevices;
        },
        async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
          console.log(`[${label}] getUserMedia called with:`, constraints);
          // WebKit on Windows may not have MediaStream constructor
          const FakeStream = (window as any).MediaStream || (window as any).webkitMediaStream;
          const fakeStream = FakeStream ? new FakeStream() : ({
            _tracks: [] as MediaStreamTrack[],
            getTracks() { return this._tracks; },
            getVideoTracks() { return this._tracks.filter((t: MediaStreamTrack) => t.kind === 'video'); },
            getAudioTracks() { return this._tracks.filter((t: MediaStreamTrack) => t.kind === 'audio'); },
            addTrack(track: MediaStreamTrack) { this._tracks.push(track); },
            removeTrack(track: MediaStreamTrack) { this._tracks = this._tracks.filter((t: MediaStreamTrack) => t !== track); },
            getTrackById(id: string) { return this._tracks.find((t: MediaStreamTrack) => t.id === id) || null; },
            clone() { return this; },
            get id() { return 'fake-stream-' + label; },
            get active() { return true; },
          } as any);

          // Audio: use AudioContext (WebKit compat: try webkitAudioContext first)
          if (constraints.audio) {
            try {
              const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
              const audioCtx = new AudioCtx();
              const dst = audioCtx.createMediaStreamDestination();
              const audioTrack = dst.stream.getAudioTracks()[0];
              fakeStream.addTrack(audioTrack);
            } catch (e) {
              console.warn(`[${label}] Audio track creation failed:`, e);
            }
          }

          // Video: use canvas.captureStream if available, otherwise skip
          if (constraints.video) {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 640;
              canvas.height = 480;
              const ctx = canvas.getContext('2d')!;
              let frame = 0;
              const animate = () => {
                ctx.fillStyle = `hsl(${frame % 360}, 70%, 50%)`;
                ctx.fillRect(0, 0, 640, 480);
                ctx.fillStyle = 'white';
                ctx.font = '48px monospace';
                ctx.fillText(`FAKE VIDEO - ${label}`, 100, 240);
                ctx.fillText(`Frame: ${frame}`, 100, 300);
                frame++;
                requestAnimationFrame(animate);
              };
              animate();
              const videoStream = (canvas as any).captureStream(30);
              const videoTrack = videoStream.getVideoTracks()[0];
              fakeStream.addTrack(videoTrack);
            } catch (e) {
              console.warn(`[${label}] Video track creation failed (canvas.captureStream unavailable):`, e);
            }
          }

          console.log(`[${label}] Created fake stream with tracks:`, fakeStream.getTracks().map((t: MediaStreamTrack) => t.kind));
          return fakeStream;
        },
      };

      if (!navigator.mediaDevices) {
        (navigator as any).mediaDevices = shimObj;
      } else {
        const existing = navigator.mediaDevices;
        if (!existing.addEventListener) existing.addEventListener = shimObj.addEventListener;
        if (!existing.removeEventListener) existing.removeEventListener = shimObj.removeEventListener;
        if (!existing.dispatchEvent) existing.dispatchEvent = shimObj.dispatchEvent;
        if (!existing.enumerateDevices) existing.enumerateDevices = shimObj.enumerateDevices;
        existing.getUserMedia = shimObj.getUserMedia;
      }
    };
    shim('Browser 1');

    const origPC = window.RTCPeerConnection;
    if (origPC) {
      window.RTCPeerConnection = function(...args: any[]) {
        const pc = new origPC(...args);
        pc.addEventListener('icecandidate', (e: any) => {
          console.log('[Browser 1 ICE candidate]', e.candidate ? e.candidate.candidate : 'null (complete)');
        });
        pc.addEventListener('icecandidateerror', (e: any) => {
          console.log('[Browser 1 ICE candidate error]', e.errorCode, e.errorText, e.url);
        });
        pc.addEventListener('iceconnectionstatechange', () => {
          console.log('[Browser 1 ICE state]', pc.iceConnectionState);
        });
        return pc;
      } as any;
      window.RTCPeerConnection.prototype = origPC.prototype;
    }
  });

  // Browser 2 - Joiner
  const context2 = await browser.newContext();

  const page2 = await context2.newPage();
  
  await page2.addInitScript(() => {
    const origPC = window.RTCPeerConnection;
    if (origPC) {
      window.RTCPeerConnection = function(...args: any[]) {
        const pc = new origPC(...args);
        pc.addEventListener('icecandidate', (e: any) => {
          console.log('[Browser 2 ICE candidate]', e.candidate ? e.candidate.candidate : 'null (complete)');
        });
        pc.addEventListener('icecandidateerror', (e: any) => {
          console.log('[Browser 2 ICE candidate error]', e.errorCode, e.errorText, e.url);
        });
        pc.addEventListener('iceconnectionstatechange', () => {
          console.log('[Browser 2 ICE state]', pc.iceConnectionState);
        });
        return pc;
      } as any;
      window.RTCPeerConnection.prototype = origPC.prototype;
    }

    const shim = function(label: string) {
      const listeners: Record<string, Array<EventListenerOrEventListenerObject>> = {};
      const fakeDevices: MediaDeviceInfo[] = [
        { deviceId: 'fake-video-2', groupId: 'fake-group-3', kind: 'videoinput', label: `${label} Camera`, toJSON() { return this; } },
        { deviceId: 'fake-audio-2', groupId: 'fake-group-4', kind: 'audioinput', label: `${label} Microphone`, toJSON() { return this; } },
      ];

      const shimObj: any = {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(listener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          if (!listeners[type]) return;
          listeners[type] = listeners[type].filter((l: any) => l !== listener);
        },
        dispatchEvent(event: Event): boolean {
          const ls = listeners[event.type] || [];
          for (const l of ls) {
            if (typeof l === 'function') l(event);
            else l.handleEvent(event);
          }
          return true;
        },
        get ondevicechange(): any { return null; },
        set ondevicechange(_v: any) {},
        async enumerateDevices(): Promise<MediaDeviceInfo[]> {
          return fakeDevices;
        },
        async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
          console.log(`[${label}] getUserMedia called with:`, constraints);
          // WebKit on Windows may not have MediaStream constructor
          const FakeStream = (window as any).MediaStream || (window as any).webkitMediaStream;
          const fakeStream = FakeStream ? new FakeStream() : ({
            _tracks: [] as MediaStreamTrack[],
            getTracks() { return this._tracks; },
            getVideoTracks() { return this._tracks.filter((t: MediaStreamTrack) => t.kind === 'video'); },
            getAudioTracks() { return this._tracks.filter((t: MediaStreamTrack) => t.kind === 'audio'); },
            addTrack(track: MediaStreamTrack) { this._tracks.push(track); },
            removeTrack(track: MediaStreamTrack) { this._tracks = this._tracks.filter((t: MediaStreamTrack) => t !== track); },
            getTrackById(id: string) { return this._tracks.find((t: MediaStreamTrack) => t.id === id) || null; },
            clone() { return this; },
            get id() { return 'fake-stream-' + label; },
            get active() { return true; },
          } as any);

          // Audio: use AudioContext (WebKit compat: try webkitAudioContext first)
          if (constraints.audio) {
            try {
              const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
              const audioCtx = new AudioCtx();
              const dst = audioCtx.createMediaStreamDestination();
              const audioTrack = dst.stream.getAudioTracks()[0];
              fakeStream.addTrack(audioTrack);
            } catch (e) {
              console.warn(`[${label}] Audio track creation failed:`, e);
            }
          }

          // Video: use canvas.captureStream if available, otherwise skip
          if (constraints.video) {
            try {
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
                ctx.fillText(`FAKE VIDEO - ${label}`, 100, 240);
                ctx.fillText(`Frame: ${frame}`, 100, 300);
                frame++;
                requestAnimationFrame(animate);
              };
              animate();
              const videoStream = (canvas as any).captureStream(30);
              const videoTrack = videoStream.getVideoTracks()[0];
              fakeStream.addTrack(videoTrack);
            } catch (e) {
              console.warn(`[${label}] Video track creation failed (canvas.captureStream unavailable):`, e);
            }
          }

          console.log(`[${label}] Created fake stream with tracks:`, fakeStream.getTracks().map((t: MediaStreamTrack) => t.kind));
          return fakeStream;
        },
      };

      if (!navigator.mediaDevices) {
        (navigator as any).mediaDevices = shimObj;
      } else {
        const existing = navigator.mediaDevices;
        if (!existing.addEventListener) existing.addEventListener = shimObj.addEventListener;
        if (!existing.removeEventListener) existing.removeEventListener = shimObj.removeEventListener;
        if (!existing.dispatchEvent) existing.dispatchEvent = shimObj.dispatchEvent;
        if (!existing.enumerateDevices) existing.enumerateDevices = shimObj.enumerateDevices;
        existing.getUserMedia = shimObj.getUserMedia;
      }
    };
    shim('Browser 2');
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

    // Wait for both browsers to connect and discover participants
    await page1.waitForFunction(() => {
      const store = (window as any).__APP_STORE__;
      return store && store.getState().isConnected && store.getState().participants && store.getState().participants.size >= 1;
    }, { timeout: 30000 });

    await page2.waitForFunction(() => {
      const store = (window as any).__APP_STORE__;
      return store && store.getState().isConnected && store.getState().participants && store.getState().participants.size >= 1;
    }, { timeout: 30000 });
    
    // Check peer connection states via page evaluation
    const pcState1 = await page1.evaluate(async () => {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            iceGatheringState: pc.iceGatheringState,
          };
        }
        return {
          connectionState: room.state === 'connected' ? 'connected' : room.state,
          iceConnectionState: 'connected',
        };
      }
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
    console.log('[Page1] PeerConnection state:', pcState1);

    const pcState2 = await page2.evaluate(async () => {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            iceGatheringState: pc.iceGatheringState,
          };
        }
        return {
          connectionState: room.state === 'connected' ? 'connected' : room.state,
          iceConnectionState: 'connected',
        };
      }
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
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          const stats = await pc.getStats();
          const result: any = {};
          stats.forEach((report: any, key: string) => {
            result[key] = report;
          });
          return result;
        }
      }
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
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          const stats = await pc.getStats();
          const result: any = {};
          stats.forEach((report: any, key: string) => {
            result[key] = report;
          });
          return result;
        }
      }
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
          participants: Array.from(state.participants?.values() || []).map((p: any) => ({ id: p.id, name: p.name, audio: p.audioEnabled, video: p.videoEnabled }))
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
          participants: Array.from(state.participants?.values() || []).map((p: any) => ({ id: p.id, name: p.name, audio: p.audioEnabled, video: p.videoEnabled }))
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
    const keepAliveMs = process.env.KEEP_ALIVE_MS ? parseInt(process.env.KEEP_ALIVE_MS, 10) : 5000;
    console.log(`Both browsers streaming... (will keep alive for ${keepAliveMs / 1000} seconds)`);
    
    await page1.waitForTimeout(keepAliveMs);
    
    // Final stats before closing
    const finalStats1 = await page1.evaluate(async () => {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) return await pc.getStats();
      }
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page1] Final stats available:', !!finalStats1);

    const finalStats2 = await page2.evaluate(async () => {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) return await pc.getStats();
      }
      const managers = (window as any).__WEBRTC_MANAGERS__;
      if (managers && managers.size > 0) {
        const mgr = managers.values().next().value;
        if (mgr && typeof mgr.getConnectionStats === 'function') {
          return await mgr.getConnectionStats();
        }
      }
      return null;
    });
    console.log('[Page2] Final stats available:', !!finalStats2);

    // Verify connection states are still connected
    const finalPcState1 = await page1.evaluate(async () => {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
          };
        }
        return { connectionState: room.state === 'connected' ? 'connected' : room.state, iceConnectionState: 'connected' };
      }
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
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        const pc = room.engine?.publisher?.pc || room.engine?.subscriber?.pc;
        if (pc) {
          return {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
          };
        }
        return { connectionState: room.state === 'connected' ? 'connected' : room.state, iceConnectionState: 'connected' };
      }
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