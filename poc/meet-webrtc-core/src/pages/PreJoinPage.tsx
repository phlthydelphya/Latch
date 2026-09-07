import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { useAppStore } from '../store/appStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { HostControlManager } from '../host/hostControlManager';
import { fetchToken } from '../auth/token';

function generateKeyParam(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function PreJoinPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { participantId, jwt, livekitToken, sfuUrl, keyParam, setRoom, setCredentials, setLocalParticipant, setError } = useAppStore();
  const existingName = useAppStore((s) => s.localParticipant?.name) || '';
  const { devices, getUserMedia, error: deviceError, loading: deviceLoading } = useMediaDevices();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [displayName, setDisplayName] = useState(existingName);
  const [nameTouched, setNameTouched] = useState(false);

  const trimmedName = displayName.trim();
  const nameError = trimmedName.length === 0
    ? 'Display name is required.'
    : trimmedName.length > 64
      ? 'Display name must be 64 characters or fewer.'
      : null;

  // Preflight room status result
  const [roomStatus, setRoomStatus] = useState<{
    checked: boolean;
    exists: boolean;
    locked: boolean;
  }>({ checked: false, exists: true, locked: false });

  // Deep-link entry: redirect to home if no roomId
  useEffect(() => {
    if (!roomId) {
      navigate('/', { replace: true });
    }
  }, [roomId, navigate]);

  // Preflight: check room existence and lock status before showing UI
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/room/status?roomId=${encodeURIComponent(roomId)}`);
        if (!cancelled && res.ok) {
          const data = await res.json() as { exists: boolean; joinable: boolean; locked: boolean };
          setRoomStatus({ checked: true, exists: data.exists, locked: data.locked });
        }
      } catch {
        // Network error — proceed optimistically (service may not support endpoint yet)
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  // Initialize media preview
  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    let activeStream: MediaStream | null = null;

    async function startPreview() {
      try {
        const stream = await getUserMedia({
          video: videoEnabled ? { deviceId: selectedVideoDevice || undefined } : false,
          audio: audioEnabled ? { deviceId: selectedAudioDevice || undefined } : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        setPreviewStream(stream);
        setCameraError(null);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error('Preview failed:', err);
          // If video allocation failed (e.g. Firefox "Failed to allocate videosource"), fallback to audio-only
          if (videoEnabled) {
            try {
              const audioOnlyStream = await getUserMedia({
                video: false,
                audio: audioEnabled ? { deviceId: selectedAudioDevice || undefined } : false,
              });
              if (!cancelled) {
                activeStream = audioOnlyStream;
                setPreviewStream(audioOnlyStream);
                setVideoEnabled(false);
                setCameraError('Camera is in use by another application or unavailable. Joined with microphone.');
                return;
              }
            } catch (audioErr) {
              console.warn('Audio fallback also failed:', audioErr);
            }
          }
          setCameraError('Camera/microphone access denied. Please grant permissions and refresh.');
        }
      }
    }

    startPreview();

    return () => {
      cancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoEnabled, audioEnabled, selectedVideoDevice, selectedAudioDevice, roomId, getUserMedia, setError]);

  // Attach the preview stream once the <video> element has rendered.
  // (setPreviewStream above re-renders after this effect body runs, so the
  // ref is still null at that point and srcObject must be set post-render.)
  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  const handleJoin = async () => {
    setNameTouched(true);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Display name is required.');
      return;
    }
    if (trimmed.length > 64) {
      setError('Display name must be 64 characters or fewer.');
      return;
    }
    if (joining) return;
    setJoining(true);

    try {
      let activeParticipantId = participantId;
      let activeKeyParam = keyParam;

      if (!activeParticipantId || !jwt) {
        const hashKey = window.location.hash.slice(1).replace(/^k=/, '');
        activeKeyParam = hashKey || generateKeyParam();
        const res = await fetchToken(roomId!, trimmed);
        activeParticipantId = res.participantId;
        setRoom(roomId!, res.participantId, res.token, activeKeyParam);
        if (res.livekitToken && res.sfuUrl) {
          setCredentials(res.livekitToken, res.sfuUrl);
        }
        HostControlManager.getInstance().setSessionContext({
          roomId: roomId!,
          localParticipantId: res.participantId,
          hostToken: res.hostToken,
          hostKey: res.hostKey,
        });
        if (res.role === 'host') {
          usePresenceStore.getState().setAuthoritativeHost(res.participantId);
          useHostControlStore.getState().setIsWaitingInLobby(false);
        } else {
          usePresenceStore.getState().setAuthoritativeHost(null);
          if (useHostControlStore.getState().isWaitingRoomEnabled) {
            useHostControlStore.getState().setIsWaitingInLobby(true);
          }
        }
      }

      // Create local participant object
      const localParticipant = {
        id: activeParticipantId!,
        name: trimmed,
        audioEnabled,
        videoEnabled,
        screenSharing: false,
        isLocal: true,
        isSpeaking: false,
        stream: previewStream || undefined,
      };

      setLocalParticipant(localParticipant);

      // Stop preview tracks so LiveKit can allocate the hardware cleanly
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }
      setError(null);
      
      // Navigate to meeting with key param in hash
      navigate(`/r/${roomId}/join#k=${activeKeyParam}`, { replace: true });
    } catch (err) {
      console.error('Join failed:', err);
      setError('Failed to join meeting. Please try again.');
      setJoining(false);
    }
  };

  const videoDevices = devices.filter((d) => d.kind === 'videoinput');
  const audioDevices = devices.filter((d) => d.kind === 'audioinput');

  // Preflight: room not found
  if (roomStatus.checked && !roomStatus.exists) {
    return (
      <main className="preview-container" id="main" role="main">
        <div role="alert" style={{ textAlign: 'center', maxWidth: '360px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔍</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Meeting not found</h2>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            The meeting link or ID <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>{roomId}</code> does not exist.
            Check the link and try again.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate('/', { replace: true })}
          >
            Back to Home
          </button>
        </div>
      </main>
    );
  }

  // Preflight: room locked by host
  if (roomStatus.checked && roomStatus.locked) {
    return (
      <main className="preview-container" id="main" role="main">
        <div role="alert" style={{ textAlign: 'center', maxWidth: '360px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔒</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Meeting is locked</h2>
          <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            The host has locked this meeting. No new participants can join at this time.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate('/', { replace: true })}
          >
            Back to Home
          </button>
        </div>
      </main>
    );
  }

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

      <div className="input-group" style={{ width: '100%', maxWidth: '360px', margin: '1rem auto 0 auto' }}>
        <label htmlFor="displayName" className="input-label">
          Your Name
        </label>
        <input
          id="displayName"
          type="text"
          className="input-field"
          placeholder="Enter your name"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setNameTouched(true);
          }}
          onBlur={() => setNameTouched(true)}
          maxLength={64}
          autoComplete="name"
          disabled={joining}
        />
        {nameTouched && nameError && (
          <div role="alert" style={{ marginTop: '0.25rem', color: '#ff4757', fontSize: '0.8rem' }}>
            {nameError}
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

      {(cameraError || deviceError) && (
        <div
          role="alert"
          style={{
            padding: '0.75rem',
            background: 'rgba(255,71,87,0.1)',
            border: '1px solid #ff4757',
            borderRadius: '8px',
            color: '#ff4757',
            fontSize: '0.875rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <span>{cameraError || deviceError}</span>
          {cameraError && !videoEnabled && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem' }}
              onClick={() => {
                setCameraError(null);
                setVideoEnabled(true);
              }}
            >
              Retry Camera
            </button>
          )}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: '0.5rem' }}
        onClick={handleJoin}
        disabled={joining || !displayName.trim() || displayName.trim().length > 64}
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