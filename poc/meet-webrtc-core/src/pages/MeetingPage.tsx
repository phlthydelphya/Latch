import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { useIosLifecycle } from '../hooks/useIosLifecycle';
import { VideoGrid } from '../components/VideoGrid';
import { ControlBar } from '../components/ControlBar';
import { RosterDrawer } from '../components/RosterDrawer';
import { ToastContainer } from '../components/ToastContainer';
import { LayoutControls } from '../components/layout/LayoutControls';
import { useLayoutStore } from '../layout/layoutStore';
import { useAppStore } from '../store/appStore';

export function MeetingPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { keyParam, setError, clearRoom } = useAppStore();
  
  // Initiative 4.4: iOS Safari & PWA audio interruption and background/foreground handler
  useIosLifecycle();
  
  const {
    localStream,
    remoteStreams,
    screenStream,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    leave: webrtcLeave,
    publishHandRaise,
    publishSpotlight,
  } = useWebRTC();

  const localParticipant = useAppStore((s) => s.localParticipant);
  const isConnected = useAppStore((s) => s.isConnected);
  const error = useAppStore((s) => s.error);

  // Extract key from hash (for E2EE key derivation)
  useEffect(() => {
    const hashKey = window.location.hash.slice(1).replace('k=', '');
    if (hashKey && hashKey !== keyParam) {
      console.log('[Meeting] Key param from hash:', hashKey.slice(0, 8) + '…');
    }
  }, [keyParam]);

  const handleLeave = async () => {
    await webrtcLeave();
    clearRoom();
    window.location.href = '/';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      <header style={{ 
        padding: '0.75rem 1rem', 
        background: 'rgba(10, 10, 15, 0.95)', 
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" aria-hidden="true">
            <path d="M21 12V7H5V12" />
            <path d="M21 17H5" />
            <path d="M12 17V7" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600 }}>meet-secure</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              {roomId} · E2EE · SFrame
            </p>
          </div>
        </div>

        <LayoutControls onClearSpotlight={() => publishSpotlight(null)} />
      </header>

      {error && (
        <div role="alert" style={{ padding: '0.75rem', background: 'rgba(255,71,87,0.1)', borderBottom: '1px solid #ff4757', color: '#ff4757', fontSize: '0.875rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <VideoGrid
          localStream={localStream}
          remoteStreams={remoteStreams}
          screenStream={screenStream}
          localVideoEnabled={localParticipant?.videoEnabled ?? true}
          localAudioEnabled={localParticipant?.audioEnabled ?? true}
          screenSharing={localParticipant?.screenSharing ?? false}
          onPin={(id) => useLayoutStore.getState().pinParticipant(id)}
          onSpotlight={(id) => publishSpotlight(id || null)}
        />
        
        {!isConnected && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10, 10, 15, 0.95)',
            backdropFilter: 'blur(4px)',
            color: 'var(--fg-muted)',
            gap: '1rem',
            zIndex: 100,
          }}>
            <div className="loading-spinner" aria-hidden="true" />
            <span>Connecting to meeting…</span>
          </div>
        )}
      </main>

      <ControlBar onToggleHand={publishHandRaise} />
      <RosterDrawer />
      <ToastContainer />
    </div>
  );
}