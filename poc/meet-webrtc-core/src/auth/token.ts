// Token issuance client — exchanges a room join for a backend-signed JWT.
// meet-signal implements POST /token (see services/meet-signal/main.go).
// Returns both legacy mesh token and LiveKit token (dual-path Phase 1).
//
// SEC-02B/SEC-02C: the private session capability, room instance, and one-use
// resume handle are private credentials. They are hydrated into the app store
// (never logged, never placed in URL/query) and are required for host resume
// and transfer. A rejected privileged request fails closed and is never
// downgraded to a guest session.

import { useAppStore } from '../store/appStore';

export interface TokenResponse {
  token: string;           // Legacy mesh token / LiveKit JWT (backward compat)
  livekitToken: string;    // Alias for token when LiveKit path is used (required for Phase 1)
  participantId: string;   // Required for Phase 1
  roomId: string;          // Required for Phase 1
  role?: 'host' | 'participant'; // M4A: Server-assigned participant role
  hostToken?: string;      // M4A/SEC-02C: Server-signed ES256 host-operation proof
  hostKey?: string;        // M4A: Public key in hex for verifying host directives
  sessionToken?: string;   // SEC-02B: Private session capability (identity proof)
  resumeHandle?: string;   // SEC-02C: One-use, generation-bound host resume handle
  roomInstanceId?: string; // SEC-02B: Room incarnation binding
  url?: string;            // Legacy field (backward compat)
  sfuUrl?: string;         // Alias for url when LiveKit path is used (required for Phase 1)
}

/**
 * Hydrates the private session-authority credentials returned by the backend
 * into the app store. Missing fields are written as null so a stale credential
 * from a previous bootstrap cannot survive.
 */
function hydrateSessionAuthority(token: TokenResponse): void {
  useAppStore.getState().setSessionAuthority({
    sessionToken: token.sessionToken ?? null,
    resumeHandle: token.resumeHandle ?? null,
    roomInstanceId: token.roomInstanceId ?? null,
    hostToken: token.hostToken ?? null,
    hostKey: token.hostKey ?? null,
  });
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
    return 'ws://127.0.0.1:5173';
  }
  // Translate docker-internal wss://livekit/rtc -> ws://127.0.0.1:5173 for browser dev
  if (sfuUrl.includes('livekit')) {
    return 'ws://127.0.0.1:5173';
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

  let res: Response;
  try {
    res = await fetch('/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: finalRoomId, name: trimmedName }),
    });
  } catch (err: any) {
    // Fail closed: no fallback to guest issuance when room creation is unreachable.
    throw new Error(`Signaling service unreachable: ${err?.message || 'Network connection failed'}. Ensure meet-signal is running.`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.message || errJson?.error || '';
    } catch {
      // not JSON
    }
    throw new Error(
      detail
        ? `Room creation failed (${res.status}): ${detail}`
        : `Room creation failed (${res.status}). Signaling service (meet-signal on port 8080) may be offline.`
    );
  }

  const token = (await res.json()) as TokenResponse;
  hydrateSessionAuthority(token);

  console.log('[Token] room created with authoritative host', {
    roomId: token.roomId,
    participantId: token.participantId,
    role: token.role,
    hasHostToken: Boolean(token.hostToken),
    hasSessionCapability: Boolean(token.sessionToken),
  });
  return token;
}

export async function fetchToken(roomId: string, name: string): Promise<TokenResponse> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Display name is required.');
  }

  const cleanRoomId = roomId.trim();
  const state = useAppStore.getState();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Prefix the request with the private session contract only when we already
  // hold credentials for this room. A credential-bearing request fails closed
  // and must never be silently downgraded to a guest session by the caller.
  const accessToken = state.jwt || state.livekitToken;
  const sameRoom = state.roomId === cleanRoomId;
  const hasResumeCredentials = sameRoom && Boolean(accessToken) && Boolean(state.sessionToken);
  if (hasResumeCredentials) {
    headers['Authorization'] = `Bearer ${accessToken}`;
    headers['X-Session-Capability'] = state.sessionToken as string;
    if (state.hostToken) {
      headers['X-Host-Proof'] = `Bearer ${state.hostToken}`;
    }
    if (state.resumeHandle) {
      headers['X-Resume-Handle'] = state.resumeHandle;
    }
  }

  let res: Response;
  try {
    res = await fetch('/token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ roomId: cleanRoomId, name: trimmedName }),
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
    // Fail closed: a rejected resume raises; it is never converted into a guest token.
    throw new Error(
      detail
        ? `Failed to issue room token (${res.status}): ${detail}`
        : `Failed to issue room token (${res.status}). Signaling service (meet-signal on port 8080) may be offline.`
    );
  }

  const token = (await res.json()) as TokenResponse;
  hydrateSessionAuthority(token);

  // Sanitized debug log: no raw credentials, capabilities, or handles.
  console.log('[Token] fetched', {
    roomId: token.roomId,
    participantId: token.participantId,
    role: token.role,
    tokenPresent: Boolean(token.livekitToken),
    sfuUrl: token.sfuUrl,
  });
  return token;
}
