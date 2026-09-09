import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { useAudioMeter } from '../hooks/useAudioMeter';
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioTestRef = useRef<HTMLAudioElement | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [selectedSpeakerDevice, setSelectedSpeakerDevice] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [permissionsRequested, setPermissionsRequested] = useState(false);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);
  const [joining, setJoining] = useState(false);
  const [displayName, setDisplayName] = useState(existingName);
  const [nameTouched, setNameTouched] = useState(false);

  const { devices, getUserMedia, error: deviceError, loading: deviceLoading, supportsSinkId, refreshDevices, cameraAvailability, microphoneAvailability } = useMediaDevices(previewStream, cameraError, audioError, videoEnabled, audioEnabled);

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

  // Track acquisition generations and active streams
  const previewGeneration = useRef(0);
  const activeStreamRef = useRef<MediaStream | null>(null);

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

  // Request permissions EXACTLY ONCE on mount
  useEffect(() => {
    if (!permissionsRequested) {
      setPermissionsRequested(true);
      refreshDevices(true);
    }
  }, [permissionsRequested, refreshDevices]);

  // The actual acquisition function with generation ownership
  const requestPreview = useCallback(async (
    videoReq: boolean | { deviceId: { exact: string } },
    audioReq: boolean | { deviceId: { exact: string } }
  ) => {
    const generation = ++previewGeneration.current;

    // Fast-path for turning both off cleanly
    if (!videoReq && !audioReq) {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
        activeStreamRef.current = null;
      }
      setPreviewStream(null);
      return;
    }

    try {
      const stream = await getUserMedia({ video: videoReq, audio: audioReq });

      // Generation Commit Gate
      if (generation !== previewGeneration.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Stop older streams before committing
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
      }

      activeStreamRef.current = stream;
      setPreviewStream(stream);
      if (videoReq) setCameraError(null);
      if (audioReq) setAudioError(null);
      setError(null);
    } catch (err) {
      if (generation !== previewGeneration.current) return;

      console.warn('[PreJoin] Full media stream request failed:', err);

      // Audio-only fallback path
      if (videoReq && audioReq) {
        try {
          const audioOnlyStream = await getUserMedia({ video: false, audio: audioReq });
          if (generation !== previewGeneration.current) {
            audioOnlyStream.getTracks().forEach((t) => t.stop());
            return;
          }

          if (activeStreamRef.current) {
            activeStreamRef.current.getTracks().forEach(t => t.stop());
          }
          activeStreamRef.current = audioOnlyStream;
          setPreviewStream(audioOnlyStream);
          setVideoEnabled(false);
          setCameraError('Camera is in use by another application or unavailable. Joined with microphone.');
          return;
        } catch (audioErr) {
          console.warn('[PreJoin] Audio fallback also failed:', audioErr);
        }
      }

      // Video-only fallback path
      if (!videoReq && audioReq) {
        try {
          const videoOnlyStream = await getUserMedia({ video: videoReq, audio: false });
          if (generation !== previewGeneration.current) {
            videoOnlyStream.getTracks().forEach((t) => t.stop());
            return;
          }

          if (activeStreamRef.current) {
            activeStreamRef.current.getTracks().forEach(t => t.stop());
          }
          activeStreamRef.current = videoOnlyStream;
          setPreviewStream(videoOnlyStream);
          setAudioEnabled(false);
          setAudioError('Microphone is unavailable or permission denied. Joined without audio.');
          return;
        } catch (videoErr) {
          console.warn('[PreJoin] Video fallback also failed:', videoErr);
        }
      }

      if (generation !== previewGeneration.current) return;

      // Final failure commits
      if (videoReq && audioReq) {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setCameraError('Camera and microphone are in use or unavailable. Joined in listen-only mode.');
      } else if (!videoReq && audioReq) {
        setAudioEnabled(false);
        setAudioError('Microphone is unavailable or permission denied. Joined in listen-only mode.');
      } else if (videoReq && !audioReq) {
        setVideoEnabled(false);
        setCameraError('Camera is unavailable or permission denied.');
      } else {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setCameraError('Camera and microphone access denied. You can still join in listen-only mode.');
      }
    }
  }, [getUserMedia, setError]);

  // Unified dependency observer for triggering acquisition
  useEffect(() => {
    if (!roomId) return;
    if (deviceLoading) return; // Wait for initial population to finish

    // Determine current active stream state
    const currentVideoId = activeStreamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const currentAudioId = activeStreamRef.current?.getAudioTracks()[0]?.getSettings().deviceId;

    const requestedVideo = videoEnabled ? (selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : true) : false;
    const requestedAudio = audioEnabled ? (selectedAudioDevice ? { deviceId: { exact: selectedAudioDevice } } : true) : false;

    let needsUpdate = false;

    if (videoEnabled) {
      // If we don't have video, we need it.
      if (!activeStreamRef.current?.getVideoTracks().length) {
        needsUpdate = true;
      } else if (selectedVideoDevice && currentVideoId !== selectedVideoDevice) {
        // If we have video, but the ID differs from our explicit selection
        // Exception: If currentVideoId is undefined/provisional, and selectedVideoDevice is populated,
        // it means we got default initially, but now we know the ID.
        // Wait, if we requested true initially, we might already have the right device.
        // But if the IDs are strictly different, we request again.
        // If the browser didn't return deviceId in getSettings() yet (rare), this causes 1 retry.
        needsUpdate = true;
      }
    } else {
      if (activeStreamRef.current?.getVideoTracks().length) needsUpdate = true;
    }

    if (audioEnabled) {
      if (!activeStreamRef.current?.getAudioTracks().length) {
        needsUpdate = true;
      } else if (selectedAudioDevice && currentAudioId !== selectedAudioDevice) {
        needsUpdate = true;
      }
    } else {
      if (activeStreamRef.current?.getAudioTracks().length) needsUpdate = true;
    }

    if (needsUpdate || !activeStreamRef.current) {
      requestPreview(requestedVideo, requestedAudio);
    }
  }, [roomId, deviceLoading, videoEnabled, audioEnabled, selectedVideoDevice, selectedAudioDevice, requestPreview]);

  // Component cleanup
  useEffect(() => {
    return () => {
      // Increment generation on unmount to prevent late commits
      previewGeneration.current++;
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
    };
  }, []);

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
  const speakerDevices = devices.filter((d) => d.kind === 'audiooutput');

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
            disabled={cameraAvailability === 'denied' || cameraAvailability === 'unsupported' || cameraAvailability === 'error'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </button>

          {cameraAvailability === 'available' ? (
            <select
              className="input-field device-select"
              style={{ maxWidth: '220px' }}
              value={selectedVideoDevice}
              onChange={(e) => setSelectedVideoDevice(e.target.value)}
              aria-label="Select camera"
            >
              {videoDevices.length > 0 ? (
                videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${videoDevices.indexOf(d) + 1}`}
                  </option>
                ))
              ) : (
                <option value="">Default camera</option>
              )}
            </select>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>No camera detected</span>
          )}
        </fieldset>

        <fieldset className="preview-controls__row">
          <legend className="input-label">Microphone</legend>
          <button
            className={`media-toggle ${audioEnabled ? 'active' : 'muted'}`}
            onClick={() => setAudioEnabled((a) => !a)}
            aria-pressed={audioEnabled}
            aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            disabled={microphoneAvailability === 'denied' || microphoneAvailability === 'unsupported' || microphoneAvailability === 'error'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>

          {microphoneAvailability === 'available' ? (
            <select
              className="input-field device-select"
              style={{ maxWidth: '220px' }}
              value={selectedAudioDevice}
              onChange={(e) => setSelectedAudioDevice(e.target.value)}
              aria-label="Select microphone"
            >
              {audioDevices.length > 0 ? (
                audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${audioDevices.indexOf(d) + 1}`}
                  </option>
                ))
              ) : (
                <option value="">Default microphone</option>
              )}
            </select>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>No microphone detected</span>
          )}
        </fieldset>

        {/* Live Audio Activity Meter */}
        <div className="audio-meter-container" aria-label="Microphone activity">
          <div className="audio-meter-label">
            <span>Mic Activity</span>
            <span>{audioEnabled ? `${audioLevel}%` : 'Muted'}</span>
          </div>
          <div
            className="audio-meter-bar"
            role="progressbar"
            aria-valuenow={audioEnabled ? audioLevel : 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Microphone input level"
          >
            <div
              className="audio-meter-fill"
              style={{ width: `${audioEnabled ? audioLevel : 0}%` }}
            />
          </div>
        </div>

        {/* Speaker / Audio Output Selection (when supported) */}
        {supportsSinkId && speakerDevices.length > 0 && (
          <fieldset className="preview-controls__row">
            <legend className="input-label">Speaker / Output</legend>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
              onClick={handleTestSound}
              disabled={isPlayingTestSound}
              aria-label="Test speaker sound"
            >
              {isPlayingTestSound ? 'Playing…' : '🔊 Test Sound'}
            </button>
            <select
              className="input-field device-select"
              style={{ maxWidth: '220px' }}
              value={selectedSpeakerDevice}
              onChange={(e) => setSelectedSpeakerDevice(e.target.value)}
              aria-label="Select speaker"
            >
              {speakerDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Speaker ${speakerDevices.indexOf(d) + 1}`}
                </option>
              ))}
            </select>
          </fieldset>
        )}
      </div>

      {(cameraError || audioError || deviceError) && (
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
            width: '100%',
            maxWidth: '360px',
            margin: '0 auto',
          }}
        >
          <span>{cameraError || audioError || deviceError}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
            {audioError && !audioEnabled && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem' }}
                onClick={() => {
                  setAudioError(null);
                  setAudioEnabled(true);
                }}
              >
                Retry Microphone
              </button>
            )}
          </div>
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