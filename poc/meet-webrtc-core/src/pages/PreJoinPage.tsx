import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { useAudioMeter } from '../hooks/useAudioMeter';
import { useAppStore } from '../store/appStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { HostControlManager } from '../host/hostControlManager';
import { fetchToken } from '../auth/token';
import { useDeviceStore } from '../devices/deviceStore';
import { describeDeviceError } from '../devices/deviceErrorCopy';
import '../styles/pages-theme.css';

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [selectedSpeakerDevice, setSelectedSpeakerDevice] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);
  const [speakerTested, setSpeakerTested] = useState(false);
  const [joining, setJoining] = useState(false);
  const [displayName, setDisplayName] = useState(existingName);
  const [nameTouched, setNameTouched] = useState(false);

  const previewStream = useMemo(() => {
    if (cameraStream && microphoneStream) {
      return new MediaStream([
        ...cameraStream.getVideoTracks(),
        ...microphoneStream.getAudioTracks(),
      ]);
    }
    return cameraStream ?? microphoneStream;
  }, [cameraStream, microphoneStream]);

  const { devices, getUserMedia, error: deviceError, loading: deviceLoading, refreshDevices, cameraAvailability, microphoneAvailability } = useMediaDevices(previewStream, cameraError, audioError, videoEnabled, audioEnabled);

  const audioLevel = useAudioMeter(previewStream, audioEnabled);

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

  // Camera and microphone have separate ownership so one control never acquires
  // or tears down the other device.
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const mediaGeneration = useRef({ video: 0, audio: 0 });
  const mediaAcquiring = useRef({ video: false, audio: false });

  // Initialize selected devices from enumerated devices if empty
  useEffect(() => {
    if (devices.length > 0) {
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      const audioDevices = devices.filter((d) => d.kind === 'audioinput');
      const speakerDevices = devices.filter((d) => d.kind === 'audiooutput');

      if (!selectedVideoDevice && videoDevices.length > 0) {
        setSelectedVideoDevice(videoDevices[0].deviceId);
      }
      if (!selectedAudioDevice && audioDevices.length > 0) {
        setSelectedAudioDevice(audioDevices[0].deviceId);
      }
      if (!selectedSpeakerDevice && speakerDevices.length > 0) {
        setSelectedSpeakerDevice(speakerDevices[0].deviceId);
      }
    }
  }, [devices, selectedVideoDevice, selectedAudioDevice, selectedSpeakerDevice]);

  const stopDevice = useCallback((kind: 'video' | 'audio') => {
    mediaGeneration.current[kind]++;
    const streamRef = kind === 'video' ? cameraStreamRef : microphoneStreamRef;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (kind === 'video') {
      setCameraStream(null);
      setVideoEnabled(false);
      setCameraBusy(false);
    } else {
      setMicrophoneStream(null);
      setAudioEnabled(false);
      setMicrophoneBusy(false);
    }
  }, []);

  const requestDevice = useCallback(async (kind: 'video' | 'audio', deviceId = '') => {
    if (mediaAcquiring.current[kind]) return;
    const generation = ++mediaGeneration.current[kind];
    mediaAcquiring.current[kind] = true;
    if (kind === 'video') setCameraBusy(true);
    else setMicrophoneBusy(true);
    const constraints = kind === 'video'
      ? { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false }
      : { video: false, audio: deviceId ? { deviceId: { exact: deviceId } } : true };

    try {
      const stream = await getUserMedia(constraints);
      if (generation !== mediaGeneration.current[kind]) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const streamRef = kind === 'video' ? cameraStreamRef : microphoneStreamRef;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      stream.getTracks().forEach((track) => track.addEventListener?.('ended', () => {
        if (streamRef.current === stream) stopDevice(kind);
      }, { once: true }));
      if (kind === 'video') {
        setCameraStream(stream);
        setVideoEnabled(true);
        setCameraError(null);
      } else {
        setMicrophoneStream(stream);
        setAudioEnabled(true);
        setAudioError(null);
      }
      setError(null);
      void refreshDevices();
    } catch (err) {
      if (generation !== mediaGeneration.current[kind]) return;
      const message = describeDeviceError(err, kind === 'video' ? 'camera' : 'microphone').message;
      if (kind === 'video') {
        setVideoEnabled(false);
        setCameraError(message);
      } else {
        setAudioEnabled(false);
        setAudioError(message);
      }
    } finally {
      mediaAcquiring.current[kind] = false;
      if (generation === mediaGeneration.current[kind]) {
        if (kind === 'video') setCameraBusy(false);
        else setMicrophoneBusy(false);
      }
    }
  }, [getUserMedia, refreshDevices, setError, stopDevice]);

  const toggleCamera = useCallback(() => {
    if (videoEnabled) stopDevice('video');
    else void requestDevice('video', selectedVideoDevice);
  }, [requestDevice, selectedVideoDevice, stopDevice, videoEnabled]);

  const toggleMicrophone = useCallback(() => {
    if (audioEnabled) stopDevice('audio');
    else void requestDevice('audio', selectedAudioDevice);
  }, [audioEnabled, requestDevice, selectedAudioDevice, stopDevice]);

  // Component cleanup
  useEffect(() => {
    return () => {
      mediaGeneration.current.video++;
      mediaGeneration.current.audio++;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      microphoneStreamRef.current = null;
    };
  }, []);

  // Attach the composed local stream once the <video> element has rendered.
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
      const storedRoomId = useAppStore.getState().roomId;
      const credentialsMatchRoute =
        Boolean(participantId) &&
        Boolean(jwt) &&
        storedRoomId === roomId;

      let activeParticipantId = credentialsMatchRoute ? participantId : null;
      let activeKeyParam = credentialsMatchRoute ? keyParam : null;

      console.log(`[PREJOIN] routeRoomMatchesStore=${credentialsMatchRoute} fragmentPresent=${Boolean(window.location.hash.slice(1).replace(/^k=/, ''))}`);

      if (!credentialsMatchRoute) {
        console.log('[JOIN REQUEST] credentialReuse=false');
        const hashKey = window.location.hash.slice(1).replace(/^k=/, '');
        if (!hashKey) {
          setError('Unable to join securely. This invitation is missing its encryption key. Ask the host for a new invitation.');
          setJoining(false);
          return;
        }
        activeKeyParam = hashKey;
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
      } else {
        console.log('[JOIN REQUEST] credentialReuse=true');
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

      // Persist device selection to DeviceStore so useWebRTC publishes the chosen devices
      if (selectedVideoDevice) {
        useDeviceStore.getState().selectVideoInput(selectedVideoDevice);
      }
      if (selectedAudioDevice) {
        useDeviceStore.getState().selectAudioInput(selectedAudioDevice);
      }
      if (selectedSpeakerDevice) {
        useDeviceStore.getState().selectAudioOutput(selectedSpeakerDevice);
      }

      // Stop preview tracks so LiveKit can allocate the hardware cleanly
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
        microphoneStreamRef.current = null;
        setCameraStream(null);
        setMicrophoneStream(null);
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
  const handleTestSound = async () => {
    try {
      setIsPlayingTestSound(true);
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 440Hz chime
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
      setSpeakerTested(true);
      setTimeout(() => {
        setIsPlayingTestSound(false);
        audioCtx.close().catch(() => {});
      }, 500);
    } catch {
      setIsPlayingTestSound(false);
    }
  };

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

  const initials = trimmedName
    ? trimmedName.split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase()
    : 'YOU';
  const activeError = cameraError || audioError || deviceError;

  return (
    <div className="preflight-page">
      <a className="skip-link" href="#main">Skip to device check</a>
      <header className="preflight-header">
        <button className="preflight-wordmark" type="button" onClick={() => navigate('/', { replace: true })}>LATCH</button>
        <div className="preflight-location" aria-hidden="true">
          <span className="preflight-mark" />
          <span>PREFLIGHT / DEVICE CHECK</span>
        </div>
        <button className="preflight-exit" type="button" onClick={() => navigate('/', { replace: true })}>Exit to home ↗</button>
      </header>

      <main id="main" className="preflight-main">
        <div className="preflight-heading">
          <div>
            <p className="preflight-eyebrow">A moment for you</p>
            <h1 aria-label="Before you step in.">Before you<br /><span>step in.</span></h1>
          </div>
          <p>Find your light. Check your sound.<br />Come as you are.</p>
        </div>

        <div className="preflight-grid">
          <section className="device-workspace" aria-labelledby="preview-title">
            <div className="preview-meta">
              <h2 id="preview-title">Your preview</h2>
              <span className="local-badge">LOCAL ONLY</span>
            </div>

            <div className="camera-preview" aria-label="Your local camera preview">
              {!videoEnabled && (
                <div className="preview-idle">
                  <img className="preview-botanical" src="/brand/linework-flow.png" alt="" aria-hidden="true" />
                  <div className="camera-message">
                    <span className="initials">{initials}</span>
                    <h3>Your camera is off.</h3>
                    <p>No one can see or hear this preview.</p>
                  </div>
                </div>
              )}
              {videoEnabled && cameraStream && (
                <>
                  <video ref={videoRef} autoPlay playsInline muted aria-label="Your local camera preview video" />
                  <div className="video-overlay"><span>{trimmedName || 'You'}</span><span>Visible only to you</span></div>
                </>
              )}
            </div>

            <div className="device-controls" aria-label="Local device controls">
              <button
                className={`device-button ${videoEnabled ? 'active' : 'muted'}`}
                type="button"
                onClick={toggleCamera}
                aria-pressed={videoEnabled}
                aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                disabled={joining || cameraBusy || cameraAvailability === 'unsupported'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="3" /><path d="m15 10 6-3v10l-6-3" /></svg>
                <span>{cameraBusy ? 'Waiting for permission…' : videoEnabled ? 'Turn camera off' : 'Enable camera'}</span>
              </button>
              <button
                className={`device-button ${audioEnabled ? 'active' : 'muted'}`}
                type="button"
                onClick={toggleMicrophone}
                aria-pressed={audioEnabled}
                aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                disabled={joining || microphoneBusy || microphoneAvailability === 'unsupported'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
                <span>{microphoneBusy ? 'Waiting for permission…' : audioEnabled ? 'Turn mic off' : 'Enable mic'}</span>
              </button>
              <button className="device-button speaker-button" type="button" onClick={handleTestSound} disabled={joining || isPlayingTestSound} aria-label="Test speaker sound">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3zm13-1q5 4 0 8m3-11q8 7 0 14" /></svg>
                <span>{isPlayingTestSound ? 'Playing…' : 'Test speakers'}</span>
              </button>
            </div>

            <div className={`device-feedback${activeError ? ' device-feedback--error' : ''}`} role={activeError ? 'alert' : 'status'} aria-live="polite">
              <p>{activeError || 'Camera and microphone stay off until you enable them.'}</p>
              {activeError && (
                <div className="device-feedback__actions">
                  {cameraError && !videoEnabled && <button type="button" onClick={() => { setCameraError(null); void requestDevice('video', selectedVideoDevice); }}>Retry camera</button>}
                  {audioError && !audioEnabled && <button type="button" onClick={() => { setAudioError(null); void requestDevice('audio', selectedAudioDevice); }}>Retry microphone</button>}
                </div>
              )}
            </div>

            <details className="device-settings" open>
              <summary>Device settings <span aria-hidden="true">＋</span></summary>
              <div className="settings-grid">
                <div>
                  <label htmlFor="camera-select">Camera</label>
                  <select id="camera-select" value={selectedVideoDevice} disabled={!videoEnabled || cameraBusy || joining} onChange={(event) => { const id = event.target.value; setSelectedVideoDevice(id); void requestDevice('video', id); }}>
                    <option value="">System default camera</option>
                    {videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="microphone-select">Microphone</label>
                  <select id="microphone-select" value={selectedAudioDevice} disabled={!audioEnabled || microphoneBusy || joining} onChange={(event) => { const id = event.target.value; setSelectedAudioDevice(id); void requestDevice('audio', id); }}>
                    <option value="">System default microphone</option>
                    {audioDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
                  </select>
                </div>
              </div>
              <div className="mic-meter-row">
                <span>Input level</span>
                <div className="preflight-meter" role="progressbar" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audioEnabled ? audioLevel : 0}>
                  <span style={{ width: `${audioEnabled ? audioLevel : 0}%` }} />
                </div>
                <span>{audioEnabled ? (audioLevel > 3 ? 'Receiving sound' : 'Try speaking') : 'Mic off'}</span>
              </div>
              <p className="setting-note">Device choices appear after permission is granted. Speaker tests use your system’s selected output.</p>
            </details>
          </section>

          <aside className="join-panel" aria-labelledby="join-title">
            <p className="preflight-eyebrow">Your space to connect</p>
            <h2 id="join-title">Settle in.</h2>
            <p className="join-lede">Choose how you show up.<br />You can keep your camera and mic off.</p>
            <div className="preflight-form">
              <label htmlFor="displayName">Your name</label>
              <input id="displayName" type="text" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setNameTouched(true); }} onBlur={() => setNameTouched(true)} maxLength={64} autoComplete="name" placeholder="What should we call you?" aria-describedby="name-note" disabled={joining} />
              <p className="setting-note" id="name-note">Used for this meeting only. Not saved.</p>
              {nameTouched && nameError && <p className="name-error" role="alert">{nameError}</p>}
              <div className="readiness-list" aria-label="Device readiness">
                <div><span>Camera</span><strong data-on={videoEnabled}>{cameraBusy ? 'Requesting…' : videoEnabled ? 'On · local' : 'Off'}</strong></div>
                <div><span>Microphone</span><strong data-on={audioEnabled}>{microphoneBusy ? 'Requesting…' : audioEnabled ? 'On · local' : 'Off'}</strong></div>
                <div><span>Speakers</span><strong data-on={speakerTested}>{speakerTested ? 'Tone played' : 'Not tested'}</strong></div>
              </div>
              <button className="btn btn-primary preflight-join" type="button" onClick={handleJoin} disabled={joining || cameraBusy || microphoneBusy || Boolean(nameError)}>{joining ? 'Joining…' : 'Join Meeting'} <span aria-hidden="true">↗</span></button>
              <button className="preflight-cancel" type="button" onClick={() => navigate('/', { replace: true })} disabled={joining}>Cancel</button>
            </div>
            <div className="security-note">
              <span className="notice-label">PRIVATE BY DESIGN</span>
              <p>This preview stays on your device. Your selected device settings carry into the encrypted meeting when you join.</p>
            </div>
            <div className="privacy-note"><h3>A boundary, not a barrier.</h3><p>Camera and microphone access begins only when you choose it. You can enter with either device off.</p></div>
          </aside>
        </div>

        <footer className="preflight-footer"><span>Human by nature. Private by design.</span><span>01 / GET COMFORTABLE</span></footer>
      </main>
    </div>
  );
}
