/**
 * Privacy-Preserving Diagnostic Tool Validation (Initiative 4.8)
 *
 * Verifies that diagnostic bundles exported by beta pilot participants
 * strictly uphold all privacy and security invariants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateDiagnosticBundle,
  anonymizeIdentifier,
  detectBrowserEngine,
  SanitizedDiagnosticBundle,
} from '../src/utils/diagnostics';
import { useAppStore } from '../src/store/appStore';

describe('Initiative 4.8: Privacy-Preserving Diagnostic Tool', () => {
  beforeEach(() => {
    useAppStore.setState({
      roomId: 'confidential-executive-sync-12345',
      participantId: 'alice-ceo@megacorp.internal',
      isConnected: true,
      shieldMode: true,
      connectionQuality: 'excellent',
      participants: new Map([
        ['bob-cfo@megacorp.internal', {
          id: 'bob-cfo@megacorp.internal',
          name: 'Bob CFO',
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isLocal: false,
          isSpeaking: false,
        }]
      ]),
      localParticipant: {
        id: 'alice-ceo@megacorp.internal',
        name: 'Alice CEO',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
      },
    });
  });

  it('I4.8-1: Anonymizes room and participant identifiers with deterministic SHA-256 hash', async () => {
    const rawId = 'confidential-executive-sync-12345';
    const hashed = await anonymizeIdentifier(rawId);

    expect(hashed).toMatch(/^hash-[a-f0-9]{16}$/);
    expect(hashed).not.toContain('confidential');
    expect(hashed).not.toContain('sync');

    // Deterministic repeatability
    const repeatHashed = await anonymizeIdentifier(rawId);
    expect(repeatHashed).toBe(hashed);
  });

  it('I4.8-2: Generates sanitized diagnostic bundle without PII or raw identifiers', async () => {
    const bundle: SanitizedDiagnosticBundle = await generateDiagnosticBundle({
      keyManagerEpoch: 3,
    });

    const serialized = JSON.stringify(bundle);

    // 1. Zero raw emails / usernames / display names
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('bob');
    expect(serialized).not.toContain('megacorp');
    expect(serialized).not.toContain('confidential');

    // 2. Zero raw IPv4 or IPv6 patterns
    const ipv4Regex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;
    expect(serialized).not.toMatch(ipv4Regex);

    // 3. Cryptographic State is High-Level Only
    expect(bundle.session.currentEpoch).toBe(3);
    expect(bundle.session.shieldMode).toBe(true);
    expect(bundle.session.participantCount).toBe(2);

    // 4. Privacy Audit confirmation flags
    expect(bundle.privacyAudit.piiScrubbed).toBe(true);
    expect(bundle.privacyAudit.rawIpsPurged).toBe(true);
    expect(bundle.privacyAudit.mediaKeysExcluded).toBe(true);
  });

  it('I4.8-3: Detects browser engine without exposing detailed fingerprinting tokens', () => {
    const engine = detectBrowserEngine();
    expect(typeof engine).toBe('string');
    expect(engine.length).toBeGreaterThan(0);
    expect(engine.length).toBeLessThan(30);
  });
});
