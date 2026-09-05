// Token issuance client — exchanges a room join for a backend-signed JWT.
// meet-signal implements POST /token (see services/meet-signal/main.go).
// Returns both legacy mesh token and LiveKit token (dual-path Phase 1).

export interface TokenResponse {
  token: string;           // Legacy mesh token / LiveKit JWT (backward compat)
  livekitToken: string;    // Alias for token when LiveKit path is used (required for Phase 1)
  participantId: string;   // Required for Phase 1
  roomId: string;          // Required for Phase 1
  url?: string;            // Legacy field (backward compat)
  sfuUrl?: string;         // Alias for url when LiveKit path is used (required for Phase 1)
}

/**
 * Resolves the SFU WebSocket URL for browser consumption.
 * - If VITE_LIVEKIT_URL is set, use it directly (production)
 * - If sfuUrl contains "livekit" (docker-internal), translate to ws://127.0.0.1:7880 (dev)
 * - Otherwise return as-is
 */
export function resolveSfuUrl(sfuUrl: string | undefined): string {
  const envUrl = import.meta.env.VITE_LIVEKIT_URL;
  if (envUrl) {
    return envUrl;
  }
  if (!sfuUrl) {
    return 'ws://127.0.0.1:7880';
  }
  // Translate docker-internal wss://livekit/rtc -> ws://127.0.0.1:7880 for browser dev
  if (sfuUrl.includes('livekit')) {
    return 'ws://127.0.0.1:7880';
  }
  return sfuUrl;
}

export async function fetchToken(roomId: string, name: string): Promise<TokenResponse> {
  const res = await fetch('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, name }),
  });

  if (!res.ok) {
    throw new Error(`Failed to issue room token (${res.status})`);
  }

  const token = await res.json();
  // Sanitized debug log: token prefix only
  console.log('[Token] fetched', {
    roomId: token.roomId,
    participantId: token.participantId,
    livekitTokenPrefix: token.livekitToken?.slice(0, 20) + '...',
    sfuUrl: token.sfuUrl,
  });
  return token;
}