import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { HostControlManager } from '../host/hostControlManager';
import { createRoom } from '../auth/token';
import { parseMeetingInput, formatMeetingUrl, formatMeetingPath, formatInvitationText } from '../utils/roomUrl';
import { InviteModal } from '../components/InviteModal';
import '../styles/pages-theme.css';

// ─── Meeting Ready Card ───────────────────────────────────────────────────────

interface MeetingReadyCardProps {
  roomId: string;
  keyParam: string;
  hostName: string;
  onStart: () => void;
}

function MeetingReadyCard({ roomId, keyParam, hostName, onStart }: MeetingReadyCardProps) {
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);

  const meetingUrl = formatMeetingUrl(roomId, keyParam);

  const copyLink = async () => {
    await navigator.clipboard.writeText(meetingUrl);
    setCopied('link');
    setTimeout(() => setCopied(null), 2000);
  };

  const copyInvitation = async () => {
    const text = formatInvitationText(roomId, keyParam, { hostName });
    await navigator.clipboard.writeText(text);
    setCopied('text');
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div
      className="container"
      style={{
        maxWidth: '460px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
      role="region"
      aria-label="Meeting ready"
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            background: 'rgba(100, 220, 120, 0.15)',
            border: '2px solid rgba(100, 220, 120, 0.4)',
            marginBottom: '0.75rem',
          }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#64dc78" strokeWidth="2.5" width="1.5rem" height="1.5rem">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Meeting ready</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>
          Share the link with participants before starting.
        </p>
      </div>

      {/* Meeting link display */}
      <div
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: '8px',
          padding: '0.625rem 0.875rem',
          fontSize: '0.8125rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-muted)',
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
        aria-label="Meeting link"
      >
        {meetingUrl}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={copyLink}
          aria-live="polite"
        >
          {copied === 'link' ? '✓ Link copied!' : '🔗 Copy link'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={copyInvitation}
          aria-live="polite"
        >
          {copied === 'text' ? '✓ Invitation copied!' : '✉ Copy invitation'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => setShowInvite(true)}
        >
          📱 Show QR code
        </button>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: '0.25rem' }}
        onClick={onStart}
        autoFocus
      >
        Start Meeting →
      </button>

      {showInvite && (
        <InviteModal
          isOpen={showInvite}
          roomId={roomId}
          keyParam={keyParam}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ─── LandingPage ─────────────────────────────────────────────────────────────

type Intent = 'choose' | 'create' | 'join';

interface LandingPageProps {
  initialIntent?: Intent;
}

export function LandingPage({ initialIntent = 'choose' }: LandingPageProps = {}) {
  const navigate = useNavigate();
  const setRoom = useAppStore((s) => s.setRoom);

  // Shared state
  const [intent, setIntent] = useState<Intent>(initialIntent);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Join-specific state
  const [meetingInput, setMeetingInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // "Meeting ready" interstitial state (after create)
  const [readyRoomId, setReadyRoomId] = useState<string | null>(null);
  const [readyKeyParam, setReadyKeyParam] = useState<string>('');

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

  const validateName = (v: string): string | null => {
    const t = v.trim();
    if (t.length === 0) return 'Display name is required.';
    if (t.length > 64) return 'Display name must be 64 characters or fewer.';
    return null;
  };

  // ── Create flow ──────────────────────────────────────────────────────────

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const nameErr = validateName(name);
    if (nameErr) { setError(nameErr); return; }

    setLoading(true);
    const finalRoomId = generateRoomId();
    const keyParam = generateKeyParam();

    try {
      const res = await createRoom(name.trim(), finalRoomId);
      setRoom(res.roomId, res.participantId, res.token, keyParam);
      if (res.livekitToken && res.sfuUrl) {
        useAppStore.getState().setCredentials(res.livekitToken, res.sfuUrl);
      }
      HostControlManager.getInstance().setSessionContext({
        roomId: res.roomId,
        localParticipantId: res.participantId,
        hostToken: res.hostToken,
        hostKey: res.hostKey,
      });
      usePresenceStore.getState().setAuthoritativeHost(res.participantId);
      useHostControlStore.getState().setIsWaitingInLobby(false);
      useAppStore.getState().setLocalParticipant({
        id: res.participantId,
        name: name.trim(),
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
      });

      // Show "Meeting Ready" interstitial before entering the room
      setReadyRoomId(res.roomId);
      setReadyKeyParam(keyParam);
    } catch (err) {
      console.error('Room creation failed:', err);
      setError(err instanceof Error ? err.message : 'Could not create meeting. Signaling service unavailable.');
      setLoading(false);
    }
  };

  const handleStartMeeting = () => {
    if (!readyRoomId || !readyKeyParam) {
      setError('Meeting encryption key is unavailable.');
      return;
    }
    console.log(`[ROOM CREATE] roomId=${readyRoomId} keyPresent=true`);
    navigate(formatMeetingPath(readyRoomId, readyKeyParam), { replace: true });
  };

  // ── Join flow ────────────────────────────────────────────────────────────

  const handleJoin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const nameErr = validateName(name);
    if (nameErr) { setError(nameErr); return; }

    // Parse the meeting link / room ID input
    const parsed = parseMeetingInput(meetingInput);
    if (!parsed.isValid) {
      setError(parsed.error || 'Invalid meeting link or ID.');
      return;
    }

    setLoading(true);
    try {
      // Pre-flight: check room status before committing to token fetch
      const statusRes = await fetch(`/room/status?roomId=${encodeURIComponent(parsed.roomId)}`);
      if (statusRes.ok) {
        const status = await statusRes.json() as { exists: boolean; joinable: boolean; locked: boolean };
        if (!status.exists) {
          setError('Meeting not found. Check the link or ID and try again.');
          setLoading(false);
          return;
        }
        if (status.locked) {
          setError('This meeting has been locked by the host.');
          setLoading(false);
          return;
        }
      }
      // If /room/status is unavailable (network issue or older backend), proceed optimistically.
    } catch {
      // Status check failed — proceed optimistically; PreJoinPage will enforce.
    }

    // Navigate to PreJoinPage; pass extracted key in state for deep-link joins with known key
    const keyParam = parsed.keyParam || '';
    const hash = keyParam ? `#k=${keyParam}` : '';
    useAppStore.getState().setLocalParticipant({
      id: '',
      name: name.trim(),
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isLocal: true,
      isSpeaking: false,
    });
    navigate(`/r/${parsed.roomId}${hash}`, { replace: false });
  };

  // ── "Meeting Ready" interstitial ─────────────────────────────────────────

  if (readyRoomId) {
    return (
      <main className="landing latch-entry" id="main" role="main">
        <MeetingReadyCard
          roomId={readyRoomId}
          keyParam={readyKeyParam}
          hostName={name.trim()}
          onStart={handleStartMeeting}
        />
      </main>
    );
  }

  // ── Intent selection screen ──────────────────────────────────────────────

  if (intent === 'choose') {
    return (
      <div className="latch-home">
        
        <header className="latch-home__header">
          <span className="latch-home__wordmark">LATCH</span>
          <span className="latch-home__edition">A SPACE TO CONNECT</span>
          <button className="btn btn-secondary" type="button" onClick={() => setIntent('join')}>Join Meeting ↗</button>
        </header>
        <main id="main" className="latch-home__main">
          <section className="latch-home__hero" aria-labelledby="home-title">
            <div className="latch-home__copy">
              <p className="latch-home__eyebrow">Human by nature. Private by design.</p>
              <h1 id="home-title">Good company.<br /><span>Less noise.</span></h1>
              <p className="latch-home__lede">A little room for real conversation. Create a meeting, share your invitation, and make yourself at home.</p>
              <div className="latch-home__actions">
                <button type="button" className="btn btn-primary" onClick={() => setIntent('create')}>+ New Meeting <span aria-hidden="true">↗</span></button>
                <button type="button" className="btn btn-secondary" onClick={() => setIntent('join')}>Join Meeting</button>
              </div>
              <p className="latch-home__hint">Your camera. Your microphone. Your choice.</p>
            </div>
            <div className="latch-home__art" aria-hidden="true">
              <img src="/brand/linework-flow.png" alt="" />
              <span className="latch-home__art-label">ROOM FOR<br />CONNECTION.</span>
              <span className="latch-home__art-index">01 / COME AS YOU ARE</span>
            </div>
          </section>
          <section className="latch-home__principles" aria-label="Meeting experience">
            <div><span>01 / ON YOUR TERMS</span><h2>Ease into it.</h2><p>Check your camera and sound before you enter. Keep either off whenever you like.</p></div>
            <div><span>02 / BY INVITATION</span><h2>Bring your people.</h2><p>Share a private invitation. Hosts manage who comes into the room.</p></div>
            <div><span>03 / IN THE MOMENT</span><h2>Be here, together.</h2><p>Video, voice, and screen sharing, with encryption status visible during your meeting.</p></div>
          </section>
        </main>
        <footer className="latch-home__footer"><span>LATCH / SPACE FOR THE HUMAN SIDE</span><span>Human by nature. Private by design.</span></footer>
      </div>
    );
  }
  // ── Create form ──────────────────────────────────────────────────────────

  if (intent === 'create') {
    return (
      <main className="landing latch-entry" id="main" role="main">
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: 'flex-start', marginBottom: '1rem', fontSize: '0.875rem', padding: '0.375rem 0.875rem' }}
          onClick={() => { setIntent('choose'); setError(null); }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>New meeting</h1>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          A unique end-to-end encrypted room will be created for you.
        </p>

        <form onSubmit={handleCreate} className="container" style={{ maxWidth: '400px', width: '100%' }}>
          <div className="input-group">
            <label htmlFor="name-create" className="input-label">
              Your Name
            </label>
            <input
              id="name-create"
              type="text"
              className="input-field"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 64))}
              maxLength={64}
              autoComplete="name"
              disabled={loading}
              autoFocus
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
            {loading ? 'Creating…' : 'Create Meeting'}
          </button>
        </form>
      </main>
    );
  }

  // ── Join form ────────────────────────────────────────────────────────────

  return (
    <main className="landing latch-entry" id="main" role="main">
      <button
        type="button"
        className="btn btn-secondary"
        style={{ alignSelf: 'flex-start', marginBottom: '1rem', fontSize: '0.875rem', padding: '0.375rem 0.875rem' }}
        onClick={() => { setIntent('choose'); setError(null); }}
      >
        ← Back
      </button>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Join meeting</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Paste a meeting link, or enter the meeting ID.
      </p>

      <form onSubmit={handleJoin} className="container" style={{ maxWidth: '400px', width: '100%' }}>
        {/* Primary: meeting link input */}
        <div className="input-group">
          <label htmlFor="meetingLink" className="input-label">
            Meeting Link
          </label>
          <input
            id="meetingLink"
            type="text"
            className="input-field"
            placeholder="Paste meeting link or ID…"
            value={meetingInput}
            onChange={(e) => setMeetingInput(e.target.value)}
            disabled={loading}
            autoFocus
            autoComplete="url"
            aria-describedby="meetingLink-help"
          />
          <span id="meetingLink-help" className="sr-only">
            Paste a full meeting URL (e.g. https://…/r/room-id#k=…) or just the room ID.
          </span>
        </div>

        {/* Your Name */}
        <div className="input-group" style={{ marginTop: '1rem' }}>
          <label htmlFor="name-join" className="input-label">
            Your Name
          </label>
          <input
            id="name-join"
            type="text"
            className="input-field"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 64))}
            maxLength={64}
            autoComplete="name"
            disabled={loading}
          />
        </div>

        {/* Advanced: direct Room ID toggle */}
        <details
          style={{ marginTop: '0.875rem' }}
          onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: '0.8125rem',
              color: 'var(--fg-muted)',
              userSelect: 'none',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              style={{
                width: '1rem',
                height: '1rem',
                transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            Advanced options
          </summary>
          <div style={{ marginTop: '0.75rem' }}>
            <label htmlFor="roomIdDirect" className="input-label" style={{ fontSize: '0.8125rem' }}>
              Room ID (direct entry)
            </label>
            <input
              id="roomIdDirect"
              type="text"
              className="input-field"
              placeholder="abc-xyz-room-id"
              value={meetingInput}
              onChange={(e) => setMeetingInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={64}
              disabled={loading}
              aria-describedby="roomIdDirect-help"
            />
            <span id="roomIdDirect-help" style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', display: 'block', marginTop: '0.25rem' }}>
              Only lowercase letters, numbers, and hyphens.
            </span>
          </div>
        </details>

        {error && (
          <div role="alert" style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: '8px', color: '#ff4757', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: '1.5rem', width: '100%' }}
          disabled={loading || !meetingInput.trim()}
        >
          {loading ? 'Checking…' : 'Continue →'}
        </button>
      </form>
    </main>
  );
}
