// Token issuance client — exchanges a room join for a backend-signed JWT.
// meet-signal implements POST /token (see services/meet-signal/main.go).
// Returns both legacy mesh token and LiveKit token (dual-path Phase 1).

export interface TokenResponse {
  token: string;           // Legacy mesh token / LiveKit JWT (backward compat)
  livekitToken: string;    // Alias for token when LiveKit path is used (required for Phase 1)
  participantId: string;   // Required for Phase 1
  roomId: string;          // Required for Phase 1
  role?: 'host' | 'participant'; // M4A: Server-assigned participant role
  hostToken?: string;      // M4A: Server-signed ES256 host claim (if role === 'host')
  hostKey?: string;        // M4A: Public key in hex for verifying host directives
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

export function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function createRoom(name: string, requestedRoomId?: string): Promise<TokenResponse> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Display name is required.');
  }

  const finalRoomId = requestedRoomId?.trim() || generateRoomId();

  let token: TokenResponse;
  try {
    const res = await fetch('/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: finalRoomId, name: trimmedName }),
    });

    if (res.ok) {
      token = await res.json();
    } else {
      console.warn(`[Token] /room/create returned status ${res.status}, falling back to /token`);
      token = await fetchToken(finalRoomId, trimmedName);
    }
  } catch (err) {
    console.warn('[Token] /room/create failed, falling back to /token', err);
    token = await fetchToken(finalRoomId, trimmedName);
  }

  console.log('[Token] room created with authoritative host', {
    roomId: token.roomId,
    participantId: token.participantId,
    role: token.role,
    hasHostToken: Boolean(token.hostToken),
  });
  return token;
}

export async function fetchToken(roomId: string, name: string): Promise<TokenResponse> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Display name is required.');
  }

  let res: Response;
  try {
    res = await fetch('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: roomId.trim(), name: trimmedName }),
    });
  } catch (netErr: any) {
    throw new Error(`Signaling service unreachable: ${netErr?.message || 'Network connection failed'}. Ensure meet-signal is running.`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.message || errJson?.error || '';
    } catch {
      // not JSON
    }
    const message = detail
      ? `Failed to issue room token (${res.status}): ${detail}`
      : `Failed to issue room token (${res.status}). Signaling service (meet-signal on port 8080) may be offline.`;
    throw new Error(message);
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