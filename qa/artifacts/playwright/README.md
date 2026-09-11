# Playwright Artifacts — Manifest

Browser E2E test traces, screenshots, and reports from `@playwright/test` runs. Organized by test ID and browser.

## Manifest

| File | Test ID | Browser | Date | Git SHA | Status | Notes |
|------|---------|---------|------|---------|--------|-------|
| *none yet* | — | — | — | — | — | — |

## Planned Artifacts (per `docs/reports/media-proof-sprint.md`)

| Test ID | Scenario | Target Files | Browsers |
|---------|----------|--------------|----------|
| MP-05 | Reconnect storm (10 trials) | `MP-05-<date>-<sha>-<browser>.trace.zip`, `MP-05-<date>-<sha>-<browser>-failure.png` | Chrome, Firefox, WebKit |
| MP-07 | Safari 17.4 OffscreenCanvas + VideoFrame | `MP-07-<date>-<sha>-webkit.trace.zip` | WebKit (Safari 17.4+) |
| MP-08 | Firefox ICE/TURN race | `MP-08-<date>-<sha>-firefox.trace.zip` | Firefox 129+ |

## File Types

| Extension | Description |
|-----------|-------------|
| `.trace.zip` | Playwright trace (open with `npx playwright show-trace`) |
| `.png` | Failure screenshot (auto-captured on test failure) |
| `.json` | Test result JSON (from `--reporter=json`) |

## Verification

```bash
# Open a trace
npx playwright show-trace MP-05-20260911-1534631-chrome.trace.zip

# Run specific test with trace
npx playwright test tests/e2e/reconnect.spec.ts --trace on --project=chromium
```

## Cross-Reference

- Reconnect latency histogram: `qa/reports/reconnect-latency.json`
- Browser matrix report: `qa/reports/browser-matrix.html` / `browser-matrix-playwright.html`
- Firefox ICE/TURN investigation: `docs/investigations/firefox-ice-turn.md`
- Sprint plan: `docs/reports/media-proof-sprint.md`