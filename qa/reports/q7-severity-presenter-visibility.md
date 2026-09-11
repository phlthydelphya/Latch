STATUS: DONE
DELIVERABLES:
- Q7 answer: Q7: How do remotes see presenter during share? (camera tile + screen stage both? screen replaces camera? camera frozen? — state per code path + what evidence decides it: remote Tile list, subscribed sources, inbound SSRCs.)
- Severity input: P2 with rationale (impact if camera hidden during share: meet norms picture-in-picture vs lecture mode)

GATE_STATUS: PASS
OPEN_ISSUES:
- Index-aligned remoteStreams[idx] brittleness — positional mapping of track-to-tile is non-deterministic; requires deterministic mapping (trackSid or explicit owner->index) for reproducible behavior
- Layout mode dependency — camera visibility during screen share depends on layoutEngine.evaluate() mode outcome, which may vary by participant count and mode

RECOMMENDATIONS:
- Make remoteStreams mapping deterministic (e.g., trackSid-based or owner-aware indexing) instead of positional idx
- Add histogram/statistics to verify which track displays per remote tile under various participant counts
- Validate 4-browser matrix for screen-share visibility (camera tile presence/absence per browser)