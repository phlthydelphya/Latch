import { firefox } from 'playwright';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';

function createRoom(): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name: 'FirefoxHost' });
    const req = http.request('http://127.0.0.1:8080/room/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.roomId);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const roomId = await createRoom();
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: {
      'media.navigator.permission.disabled': true,
      'media.navigator.streams.fake': true,
      'media.peerconnection.ice.loopback': true,
      'media.peerconnection.ice.link_local': true,
      'media.peerconnection.ice.tcp': true
    }
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  const keyBytes = crypto.randomBytes(32);
  const keyHex = keyBytes.toString('hex');
  await page.goto(`http://127.0.0.1:5173/r/${roomId}#k=${keyHex}`);

  await page.waitForSelector('#displayName', { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.fill('#displayName', '');
  await page.type('#displayName', 'Firefox-Tester', { delay: 50 });

  await page.waitForSelector('button:has-text("Join Meeting")', { timeout: 10000 });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Join Meeting'));
    if (btn) {
      (btn as HTMLButtonElement).disabled = false;
      (btn as HTMLButtonElement).click();
    }
  });

  await page.waitForTimeout(15000);

  const data = await page.evaluate(async () => {
    let stats = null;
    let roomKeys = [];
    let engineKeys = [];
    try {
      const room = (window as any).__LIVEKIT_ROOM__;
      if (room) {
        roomKeys = Object.keys(room);
        if (room.engine) {
          engineKeys = Object.keys(room.engine);
          const pcManager = room.engine.pcManager;
          if (pcManager) {
            const pc = pcManager.publisher?.pc || pcManager.subscriber?.pc;
            if (pc) {
              const report = await pc.getStats();
              stats = {};
              report.forEach((v, k) => stats[k] = v);
              engineKeys = pc.getConfiguration().iceServers;
            }
          }
        }
      }
    } catch(e) { }
    return {
      roomKeys,
      engineKeys,
      stats
    };
  });
  
  console.log('Gathered ICE Data:', JSON.stringify(data, null, 2));

  fs.writeFileSync('firefox-ice-candidates.json', JSON.stringify(data, null, 2));
  console.log('Saved to firefox-ice-candidates.json');

  await browser.close();
}

main().catch(console.error);
