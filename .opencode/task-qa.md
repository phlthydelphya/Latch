# Task: M0-P0 Browser Matrix & Performance Validation

## Delegation
- **Primary:** @qa
- **Dependencies:** @webrtc (for load test coordination), @backend (for infra health)
- **Reviews required:** @qa self-validates, @reviewer challenges results

## Context
Infra UP, 11 services healthy. POC at `poc/meet-webrtc-core/`. Need 4-browser matrix validation per M0-P0 Criterion 1.

## Mission
Execute browser matrix tests and Lighthouse performance validation.

## Required Actions

### 1. Install Playwright Browsers (if not present)
```bash
cd C:/Users/joshu/meet-secure-core/poc/meet-webrtc-core
npx playwright install chromium firefox webkit msedge
```

### 2. Run 4-Browser Matrix (Criterion 1)
Target browsers:
- Chrome 127+
- Edge 127+
- Firefox 128+
- Safari 17.4 (macOS + iOS PWA) — use webkit for desktop simulation

```bash
npm run test:browser
# Or directly:
npx playwright test --project=chromium --project=firefox --project=webkit --project=msedge
```
Generate: `qa/reports/browser-matrix.html`

### 3. Lighthouse CI (Criterion 9)
```bash
npx lighthouse http://localhost:8080 --output=json --output-path=qa/reports/lighthouse/landing.json
npx lighthouse http://localhost:8080/pre-join --output=json --output-path=qa/reports/lighthouse/prejoin.json
npx lighthouse http://localhost:8080/r/test-room --output=json --output-path=qa/reports/lighthouse/grid.json
```
Target: ≥95 perf/accessibility/best-practices, TBT <200ms, CLS 0

### 4. 20p x 10min Stability Test (Criterion 2)
```bash
cd C:/Users/joshu/meet-secure-core/poc/meet-webrtc-core
npm run load -- --rooms 1 --participants 20 --duration 600
```
Measure: p50 ≤150ms, p95 ≤300ms latency, CPU<70%, loss<1%

### 5. Coordinate with @webrtc for Load Test Timing
- @webrtc will run tcpdump capture during load test
- Ensure load test runs long enough for capture (120s minimum)

## Deliverables
1. `qa/reports/browser-matrix.html` — 4-browser pass/fail
2. `qa/reports/lighthouse/*.json` — all ≥95 scores
3. Stability metrics: latency histograms, CPU, packet loss
4. Playwright test artifacts (screenshots, traces on failure)

## Gate Handoff
After completion, the PM will route deliverables to:
- @reviewer for adversarial challenge of browser matrix completeness
- @security for CSP and bundle integrity validation
- @privacy for telemetry and analytics audit