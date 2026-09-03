// Token issuance client — exchanges a room join for a backend-signed JWT.
// meet-signal implements POST /token (see services/meet-signal/main.go).

export interface TokenResponse {
  token: string;
  participantId: string;
  roomId: string;
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

  return res.json();
}