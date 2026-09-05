import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: './qa/reports/playwright', open: 'never' }],
    ['json', { outputFile: './qa/reports/playwright/results.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'media.peerconnection.ice.loopback': true,
            'media.peerconnection.ice.link_local': true,
            'media.peerconnection.ice.obfuscate_host_addresses': false,
            'media.peerconnection.ice.default_address_only': false,
            'media.peerconnection.ice.no_host': false,
            'media.peerconnection.ice.tcp': true,
          },
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'msedge',
      use: { 
        ...devices['Desktop Chrome'], 
        channel: 'msedge',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
          ],
        },
      },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120000,
  },
  expect: {
    toHaveScreenshot: { threshold: 0.2 },
  },
});