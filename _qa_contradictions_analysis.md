# Architecture Reconciliation Pass: QA Contradictions Analysis

## Contradiction 1: Browser Matrix Version Scope (Criterion 1)

**CURRENT_DOC:** docs/M0-P0.md — Criterion 1 (Cross-browser compatibility)  
**CURRENT_STATEMENT:** Chrome 127+, Edge 127+, Firefox 128+, Safari 17.4+ (macOS + iOS PWA). All 4 browsers must pass core flows (join/publish/subscribe/mute/leave/ICE restart). No silent SFrame downgrade.  
**AUTHORITATIVE_STATEMENT:** docs/ROADMAP.md §5 (Scale tiers) mentions Chrome 108+, Firefox 115+, Safari 17+ for M1/M2/M3 post-P0; docs/media-layer-roadmap.md §6 test matrix: Chrome 108+, Firefox 115+, Safari 17+, Edge 108+; tests/test-vectors.ts defines BROWSER_TEST_MATRIX with 5 browsers (possibly including older versions).  
**DECISION:** M0-P0's version requirements (127+/128+/17.4+) are the P0 gate authority — they are more restrictive and ensure product-quality browsing. Roadmap references apply after GO. No edit to M0-P0, but add scope note in architecture-brief.md that roadmap browser baselines apply post-P0.  
**REQUIRED_EDIT:** Add footnote to architecture-brief.md §10: "P0 requires Chrome 127+/Edge 127+/Firefox 128+/Safari 17.4+. Post-P0 (M1+) baselines: Chrome 108+/Firefox 115+/Safari 17+ per ROADMAP.md §5."  
**ADR_REFERENCE:** ADR-004 (LiveKit vs mediasoup decision), architecture-brief.md §10, ROADMAP.md §5

## Contradiction 2: Load Harness Scale Expectations (Criterion 2)

**CURRENT_DOC:** docs/M0-P0.md — Criterion 2 (20 participants load)  
**CURRENT_STATEMENT:** 20 concurrent participants × 10min stable; p50 ≤150ms p95 ≤300ms; CPU<70% on 1 vCPU/2GB; packet loss<1%; 20 distinct participantIds.  
**AUTHORITATIVE_STATEMENT:** docs/ROADMAP.md Phase 1 (M1) mentions "20p load" but Phase 2 (M2) describes "100p load"; Phase 3 (M3) describes "1000p webinar"; BACKEND_ROADMAP.md M6 references "load tests (10k concurrent)"; docs/media-layer-roadmap.md has tiers: ≤20 (1 SFU), 20-100 (cascaded mesh), 1000 (webinar fanout).  
**DECISION:** M0-P0's 20p is the P0 gate; 100/1000p are explicitly post-P0 phases. The load-test.ts harness is designed and validated for 20p. Document that 100/1000 references are for post-GO only; do not conflate P0 harness with larger-scale testing.  
**REQUIRED_EDIT:** Add to QA_Audit_Report §3.3: "Load-test harness configured for 20p P0 gate. 100p/1000p scales are post-M0-P0-GO; separate harnesses required (see BACKEND_ROADMAP.md M6)."  
**ADR_REFERENCE:** ROADMAP.md §4 milestones, BACKEND_ROADMAP.md M6, media-layer-roadmap.md §6

## Contradiction 3: TURN Infrastructure Scale (Criterion 8)

**CURRENT_DOC:** docs/M0-P0.md — Criterion 8 (TURN fallback functioning)  
**CURRENT_STATEMENT:** Single coturn in Docker Compose, HMAC 24h TTL, ports 3478 UDP/TCP + 443 TCP/TLS. P0 single-Compose deployment for ≤50 rooms.  
**AUTHORITATIVE_STATEMENT:** docs/media-layer-roadmap.md §4: "coturn cluster behind Anycast/GeoDNS. 3 regions minimum. Each node: ~5000 concurrent relays." docs/ROADMAP.md: "Self-hosted coturn cluster Anycast turns:3478/443." BACKEND_ROADMAP.md M5: "coturn HMAC secret, MinIO bucket policies" — implies scaled deployment.  
**DECISION:** M0-P0 single coturn in Compose is correct for P0 validation. Cluster/Anycast is post-P0 infrastructure. Do not mix P0 single-node test with post-P0 cluster expectations in the same test artifact. Document the scope separation.  
**REQUIRED_EDIT:** Add to architecture-brief.md §6 (Consistent Hashing): "P0: single coturn in Compose for ≤50 rooms. Post-P0: Anycast/GeoDNS cluster per media-layer-roadmap.md §4. K8s DaemonSet in prod (not Compose)."  
**ADR_REFERENCE:** ADR-005, architecture-brief.md §6, media-layer-roadmap.md §4

## Contradiction 4: Artifact Paths and Directory Structure (Testability)

**CURRENT_DOC:** QA_Audit_Report §2 (Missing Artifacts Audit) + docs/gates/architecture-exit-checklist.md §2-4  
**CURRENT_STATEMENT:** Artifacts explicitly listed as MISSING: `qa/reports/browser-matrix.html`, `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json`, `qa/reports/lighthouse/*.json`, `qa/reports/wireshark-livekit-sframe.pcapng`, `docs/qa/m0-p0-test-plan.md`. `docs/qa/` directory exists but is EMPTY.  
**AUTHORITATIVE_STATEMENT:** docs/M0-P0.md §10 (Exit Report Template): `docs/M0-P0-exit-report.md` must contain RAG per criterion with artifact links. docs/gates/architecture-exit-checklist.md §31: Architecture brief requires `docs/qa/m0-p0-test-plan.md` reviewed by @qa. media-p0-proof.md §12 Artifact Index lists: `qa/reports/browser-matrix.html`, `qa/reports/key-rotation-latency.json`, `qa/reports/reconnect-latency.json`, `qa/reports/lighthouse/*.json`, `qa/artifacts/sframe-ciphertext.pcapng`, `docs/sframe-test-vectors.json`.  
**DECISION:** The artifact paths and directory structure are critical for GO/NO-GO but are misaligned between documents. The `docs/qa/` directory must contain the test plan; `qa/reports/` must contain the 5 report artifacts. The REQUIRED_EDIT is to create these directories/files or update all references to match the actual structure. Prioritize producing artifacts per the test harness commands.  
**REQUIRED_EDIT:** 
1. Create `docs/qa/m0-p0-test-plan.md` with test plan per M0-P0 §7 governance
2. Ensure `qa/reports/` directory exists and artifacts are produced per test harness commands
3. Align architecture-exit-checklist.md artifact paths with actual `qa/reports/` structure (not `docs/qa/` for report outputs)
4. Update media-p0-proof.md Artifact Index to match actual output paths
**ADR_REFERENCE:** architecture-exit-checklist.md §2-4, §31, media-p0-proof.md §12, M0-P0.md §10

## Contradiction 5: Frozen Roadmap References vs P0 Scope

**CURRENT_DOC:** docs/ROADMAP.md (entire document, marked FROZEN 2026-08-31), BACKEND_ROADMAP.md (M1-M8 milestones), docs/media-layer-roadmap.md (scaling targets up to 1000p)  
**CURRENT_STATEMENT:** ROADMAP.md describes 26-week plan with M1 "Core Group 20p Alpha", M2 "Depth 100p Beta", M3 "Webinar GA 1000p". BACKEND_ROADMAP.md has M1-M8 milestones with dependencies. media-layer-roadmap.md has scalability targets up to 1000 webinar viewers. All are marked FROZEN per M0-P0 freeze, but still referenced by teams.  
**AUTHORITATIVE_STATEMENT:** docs/M0-P0.md §2: "Prior 26-week roadmap FROZEN until 10 criteria + 5 gates pass GO/NO-GO." M0-P0 4-week timebox supersedes all prior roadmap. Only allowed work: infrastructure and code directly required to pass the 10 criteria. Any P2P↔SFU handoff, webinar 100-1000/HLS, anon capability links, recording, etc. are OUT OF SCOPE until GO.  
**DECISION:** Frozen roadmap references must not influence P0 criterion thresholds or test expectations. The 20p load, 4-browser matrix, and other P0 thresholds are independent of the 26-week plan. Any team referencing M1/M2/M3 thresholds for P0 gate decisions must pivot to M0-P0 criteria. Document this separation in weekly standup and PM RAG.  
**REQUIRED_EDIT:** Add to QA_Audit_Report §1 (RAG Per Criterion) header: "All thresholds verified against M0-P0.md §3 only. Frozen roadmap (ROADMAP.md, BACKEND_ROADMAP.md, media-layer-roadmap.md) references are for post-GO phases only. See M0-P0 §4 Out-of-Scope."  
**ADR_REFERENCE:** M0-P0.md §2/4, ROADMAP.md §109 (M0-P0 supersedes), BACKEND_ROADMAP.md cover page (FROZEN notice)