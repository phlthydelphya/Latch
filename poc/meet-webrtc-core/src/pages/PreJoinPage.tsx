import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { useAppStore } from '../store/appStore';
import { fetchToken } from '../auth/token';

function generateKeyParam(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function PreJoinPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { participantId, jwt, keyParam, setRoom, setLocalParticipant, setError } = useAppStore();
  const { devices, getUserMedia, error: deviceError, loading: deviceLoading } = useMediaDevices();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [joining, setJoining] = useState(false);

  // Deep-link entry: initialize session state from the URL when absent.
  // A joiner opens /r/:roomId#k=... directly, bypassing the landing page.
  useEffect(() => {
    if (!roomId) {
      navigate('/', { replace: true });
      return;
    }
    if (participantId && jwt) return;

    let cancelled = false;
    (async () => {
      const hashKey = window.location.hash.slice(1).replace(/^k=/, '');
      const generatedKey = hashKey || generateKeyParam();
      try {
        // Backend issues the signed JWT (services/meet-signal POST /token)
        const { token, participantId: pid } = await fetchToken(roomId, 'Guest');
        if (!cancelled) setRoom(roomId, pid, token, generatedKey);
      } catch (err) {
        console.error('Token issuance failed:', err);
        if (!cancelled) setError('Could not join meeting. Signaling service unavailable.');
      }
    })();

    return () => { cancelled = true; };
  }, [roomId, participantId, jwt, setRoom, setError, navigate]);

  // Initialize media preview
  useEffect(() => {
    if (!roomId || !participantId || !jwt) return;

    async function startPreview() {
      try {
        const stream = await getUserMedia({
          video: videoEnabled ? { deviceId: selectedVideoDevice || undefined } : false,
          audio: audioEnabled ? { deviceId: selectedAudioDevice || undefined } : false,
        });
        setPreviewStream(stream);
      } catch (err) {
        console.error('Preview failed:', err);
        setError('Camera/microphone access denied. Please grant permissions and refresh.');
      }
    }

    startPreview();

    return () => {
      previewStream?.getTracks().forEach((t) => t.stop());
    };
  }, [videoEnabled, audioEnabled, selectedVideoDevice, selectedAudioDevice, roomId, participantId, jwt, getUserMedia, navigate, setError]);

  // Attach the preview stream once the <video> element has rendered.
  // (setPreviewStream above re-renders after this effect body runs, so the
  // ref is still null at that point and srcObject must be set post-render.)
  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  // Update preview when devices change
  useEffect(() => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
    }
  }, [devices]);

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);

    try {
      // Create local participant object
      const localParticipant = {
        id: participantId!,
        name: 'You',
        audioEnabled,
        videoEnabled,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
        stream: previewStream || undefined,
      };

      setLocalParticipant(localParticipant);
      
      // Navigate to meeting with key param in hash
      navigate(`/r/${roomId}/join#k=${keyParam}`, { replace: true });
    } catch (err) {
      console.error('Join failed:', err);
      setError('Failed to join meeting. Please try again.');
      setJoining(false);
    }
  };

  const videoDevices = devices.filter((d) => d.kind === 'videoinput');
  const audioDevices = devices.filter((d) => d.kind === 'audioinput');

  return (
    <main className="preview-container" id="main" role="main">
      <div className="shield-badge" role="status" aria-label="End-to-end encryption active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>E2EE · SFrame</span>
      </div>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Preview & Join</h1>
      <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
        Room: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>{roomId}</code>
      </p>

      <div className="preview-video" aria-label="Camera preview">
        {previewStream ? (
          <video ref={videoRef} autoPlay playsInline muted />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
            {deviceLoading ? 'Loading camera…' : 'No camera available'}
          </div>
        )}
      </div>

      <div className="preview-controls">
        <fieldset className="preview-controls__row">
          <legend className="input-label">Camera</legend>
          <button
            className={`media-toggle ${videoEnabled ? 'active' : 'muted'}`}
            onClick={() => setVideoEnabled((v) => !v)}
            aria-pressed={videoEnabled}
            aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
            disabled={videoDevices.length === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </button>
          
          {videoDevices.length > 1 && (
            <select
              className="input-field"
              style={{ maxWidth: '200px' }}
              value={selectedVideoDevice}
              onChange={(e) => setSelectedVideoDevice(e.target.value)}
              aria-label="Select camera"
            >
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${videoDevices.indexOf(d) + 1}`}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset className="preview-controls__row">
          <legend className="input-label">Microphone</legend>
          <button
            className={`media-toggle ${audioEnabled ? 'active' : 'muted'}`}
            onClick={() => setAudioEnabled((v) => !v)}
            aria-pressed={audioEnabled}
            aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            disabled={audioDevices.length === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
          
          {audioDevices.length > 1 && (
            <select
              className="input-field"
              style={{ maxWidth: '200px' }}
              value={selectedAudioDevice}
              onChange={(e) => setSelectedAudioDevice(e.target.value)}
              aria-label="Select microphone"
            >
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${audioDevices.indexOf(d) + 1}`}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      </div>

      {deviceError && (
        <div role="alert" style={{ padding: '0.75rem', background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: '8px', color: '#ff4757', fontSize: '0.875rem', textAlign: 'center' }}>
          {deviceError}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleJoin}
        disabled={joining}
      >
        {joining ? 'Joining…' : 'Join Meeting'}
      </button>

      <button
        className="btn btn-secondary"
        style={{ width: '100%' }}
        onClick={() => navigate('/', { replace: true })}
      >
        Cancel
      </button>
    </main>
  );
}