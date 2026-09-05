/**
 * Canonicalizes participant identities for maps, ratchets, and key derivations.
 * SFrame RFC9605 / MLS-lite requires consistent lowercase and whitespace-trimmed keys
 * to prevent lookalike and case-mismatch split states (e.g. "Alice" vs "alice").
 */
export function canonicalizeIdentity(id: string): string {
  if (!id) return '';
  return id.trim().toLowerCase();
}
