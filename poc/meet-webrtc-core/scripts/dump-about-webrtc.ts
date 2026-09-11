import { chromium, firefox } from 'playwright';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Launching Firefox...');
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to local Vite app...');
  // Ensure Vite is running before this, or we can use the playwright config that starts webServer.
  // Actually, we can just hit the meet-signal / livekit directly or the frontend.
  // We need to use the actual app so that the WebRTC connection is attempted.
  // Let's assume Vite dev server is on 127.0.0.1:5173
  try {
    await page.goto('http://127.0.0.1:5173/r/new', { waitUntil: 'networkidle' });
  } catch (err) {
    console.error('Failed to reach local app. Is Vite running? Run npm run dev in poc/meet-webrtc-core');
    await browser.close();
    return;
  }

  // Wait for some time to allow ICE candidate gathering and connection attempts.
  console.log('Waiting 10 seconds for ICE gathering...');
  await page.waitForTimeout(10000);

  console.log('Opening about:webrtc...');
  const webrtcPage = await context.newPage();
  await webrtcPage.goto('about:webrtc');

  console.log('Extracting about:webrtc data...');
  // In Firefox about:webrtc, there is a "Save Page" button or similar, or we can just get the HTML.
  // There is a hidden div or we can just grab the entire innerText/innerHTML.
  // Or we can click "Save Page" and catch the download.
  const [ download ] = await Promise.all([
    webrtcPage.waitForEvent('download'),
    webrtcPage.click('button#save-page, button[id*="save"]') // Usually id is save-page
  ]).catch(async () => {
     console.log('Download button not found or failed, dumping HTML...');
     const html = await webrtcPage.content();
     fs.writeFileSync('about-webrtc.html', html);
     return [null];
  });

  if (download) {
    const downloadPath = await download.path();
    fs.copyFileSync(downloadPath, 'about-webrtc.html');
    console.log('Saved about:webrtc report to about-webrtc.html');
  }

  await browser.close();
}

main().catch(console.error);
