import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { fetchToken } from '../auth/token';

export function LandingPage() {
  const navigate = useNavigate();
  const setRoom = useAppStore((s) => s.setRoom);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateRoomId = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz234567';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };

  const generateKeyParam = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const finalRoomId = roomId.trim() || generateRoomId();
    const finalName = name.trim() || `User-${Math.random().toString(36).slice(2, 6)}`;
    const keyParam = generateKeyParam();

    try {
      // Backend issues the signed JWT (services/meet-signal POST /token)
      const res = await fetchToken(finalRoomId, finalName);
      setRoom(finalRoomId, res.participantId, res.token, keyParam);
      if (res.livekitToken && res.sfuUrl) {
        useAppStore.getState().setCredentials(res.livekitToken, res.sfuUrl);
      }
      navigate(`/r/${finalRoomId}`, { replace: true });
    } catch (err) {
      console.error('Token issuance failed:', err);
      setError(err instanceof Error ? err.message : 'Could not join meeting. Signaling service unavailable.');
      setLoading(false);
    }
  };

  return (
    <main className="landing" id="main" role="main">
      <div className="landing__logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5V12" />
          <path d="M21 17H5" />
          <path d="M12 17V7" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
      
      <h1 className="landing__title">meet-secure</h1>
      <p className="landing__subtitle">
        End-to-end encrypted video conferencing. No servers can see or hear your meetings.
      </p>

      <div className="landing__features" role="list" aria-label="Security features">
        <div className="feature-pill" role="listitem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          E2EE by default
        </div>
        <div className="feature-pill" role="listitem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          SFrame RFC 9605
        </div>
        <div className="feature-pill" role="listitem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          Key rotation ≤500ms
        </div>
        <div className="feature-pill" role="listitem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Reconnect ≤5s
        </div>
      </div>

      <form onSubmit={handleSubmit} className="container" style={{ maxWidth: '400px', width: '100%' }}>
        <div className="input-group">
          <label htmlFor="roomId" className="input-label">
            Meeting ID (optional)
          </label>
          <input
            id="roomId"
            type="text"
            className="input-field"
            placeholder="Leave empty for new meeting"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
            maxLength={32}
            aria-describedby="roomId-help"
            disabled={loading}
          />
          <span id="roomId-help" className="sr-only">
            Enter a meeting ID or leave empty to create a new one. Only lowercase letters and numbers allowed.
          </span>
        </div>

        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label htmlFor="name" className="input-label">
            Your Name
          </label>
          <input
            id="name"
            type="text"
            className="input-field"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            maxLength={32}
            autoComplete="name"
            disabled={loading}
          />
        </div>

        {error && (
          <div role="alert" style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: '8px', color: '#ff4757', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <button 
          type="submit" 
          className="btn btn-primary" 
          style={{ marginTop: '1.5rem', width: '100%' }}
          disabled={loading}
        >
          {loading ? 'Creating…' : 'Join Meeting'}
        </button>
      </form>

      <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: 'var(--fg-muted)', maxWidth: '500px' }}>
        By joining, you agree to ephemeral in-memory processing only. No recordings, no persistent logs, no telemetry.
      </p>
    </main>
  );
}