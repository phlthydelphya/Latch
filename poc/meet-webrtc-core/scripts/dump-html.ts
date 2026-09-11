import { firefox } from 'playwright';

async function main() {
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: {
      'media.navigator.permission.disabled': true,
      'media.navigator.streams.fake': true
    }
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  console.log(html);
  
  await browser.close();
}

main().catch(console.error);
