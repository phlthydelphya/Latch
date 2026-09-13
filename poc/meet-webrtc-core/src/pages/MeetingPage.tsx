import { useEffect, Suspense, lazy } from 'react';
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
import { ReactionsBar } from '../components/collaboration/ReactionsBar';
import { ReactionsOverlay } from '../components/collaboration/ReactionsOverlay';
import { HostAnnouncementBanner } from '../components/collaboration/HostAnnouncementBanner';
import { WaitingRoomBanner } from '../components/host/WaitingRoomBanner';
import { RoomLockBadge } from '../components/host/RoomLockBadge';
import { useHostControlStore } from '../host/hostControlStore';
import { usePresenceStore } from '../presence/presenceStore';

const DeviceSettingsModal = lazy(() => import('../components/devices/DeviceSettingsModal').then(m => ({ default: m.DeviceSettingsModal })));
const HostControlsModal = lazy(() => import('../components/host/HostControlsModal').then(m => ({ default: m.HostControlsModal })));
const ChatDrawer = lazy(() => import('../components/collaboration/ChatDrawer').then(m => ({ default: m.ChatDrawer })));

export function MeetingPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { keyParam, setError, clearRoom } = useAppStore();
  
  // Initiative 4.4: iOS Safari & PWA audio interruption and background/foreground handler
  useIosLifecycle();
  
  const {
    localStream,
    remoteStreams,
    cameraStreams,
    screenStreams,
    screenStream,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    leave: webrtcLeave,
    publishHandRaise,
    publishSpotlight,
    publishChatMessage,
    publishReaction,
    publishAnnouncement,
    lowerParticipantHand,
    switchDevice,
  } = useWebRTC();

  const localParticipant = useAppStore((s) => s.localParticipant);
  const isConnected = useAppStore((s) => s.isConnected);
  const error = useAppStore((s) => s.error);
  const isKicked = useHostControlStore((s) => s.isKicked);
  const isWaitingInLobby = useHostControlStore((s) => s.isWaitingInLobby);
  const admittedParticipants = useHostControlStore((s) => s.admittedParticipants);
  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const isLocalHost = hostId !== null && hostId === localParticipantId;

  // Extract key from hash (for E2EE key derivation)
  useEffect(() => {
    const hashKey = window.location.hash.slice(1).replace('k=', '');
    if (hashKey && hashKey !== keyParam) {
      console.log('[Meeting] Key param present in hash, differs from store');
    }
  }, [keyParam]);

  useEffect(() => {
    if (isLocalHost) {
      useHostControlStore.getState().setIsWaitingInLobby(false);
    }
  }, [isLocalHost]);

  const handleLeave = async () => {
    await webrtcLeave();
    clearRoom();
    window.location.href = '/';
  };

  if (isKicked) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--bg, #070807)',
          color: 'var(--fg, #f3f5ec)',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🚪</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '8px' }}>
          Removed from Meeting
        </h2>
        <p style={{ color: 'var(--fg-muted, #8b9182)', maxWidth: '400px', marginBottom: '24px' }}>
          You have been removed from this meeting by the host.
        </p>
        <button
          onClick={() => {
            useHostControlStore.getState().setKicked(false);
            window.location.href = '/';
          }}
          className="btn btn-primary"
          style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}
        >
          Return to Home
        </button>
      </div>
    );
  }

  const isAdmitted =
    (localParticipantId && admittedParticipants.has(localParticipantId)) ||
    admittedParticipants.has('*');

  if (isWaitingInLobby && !isLocalHost && !isAdmitted) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--bg, #070807)',
          color: 'var(--fg, #f3f5ec)',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '3.5rem', marginBottom: '20px' }}>⏳</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '8px' }}>
          Waiting for the host to let you in
        </h2>
        <p style={{ color: 'var(--fg-muted, #8b9182)', maxWidth: '440px', marginBottom: '24px', lineHeight: 1.5 }}>
          The host has enabled a waiting room for this meeting. You will join the call automatically once admitted.
        </p>
        <div style={{ padding: '8px 16px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid var(--border, #20231c)', marginBottom: '24px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted, #8b9182)' }}>Meeting ID: </span>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{roomId}</span>
        </div>
        <button
          onClick={handleLeave}
          className="btn btn-secondary"
          style={{ padding: '10px 24px', borderRadius: '8px', cursor: 'pointer' }}
        >
          Leave Meeting
        </button>
      </div>
    );
  }

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RoomLockBadge />
          <LayoutControls onClearSpotlight={() => publishSpotlight(null)} />
        </div>
      </header>

      {error && (
        <div role="alert" style={{ padding: '0.75rem', background: 'rgba(255,71,87,0.1)', borderBottom: '1px solid #ff4757', color: '#ff4757', fontSize: '0.875rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <WaitingRoomBanner />
        <VideoGrid
          localStream={localStream}
          cameraStreams={cameraStreams}
          screenStreams={screenStreams}
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

      <HostAnnouncementBanner />
      <ReactionsOverlay />
      <ControlBar
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleHand={publishHandRaise}
        onToggleScreenShare={async (sharing) => {
          if (sharing) {
            await startScreenShare();
          } else {
            await stopScreenShare();
          }
        }}
        onLeave={handleLeave}
      />
      <ReactionsBar onSendReaction={publishReaction} />
      <RosterDrawer onLowerHand={lowerParticipantHand} />
      <Suspense fallback={null}>
        <ChatDrawer onSendMessage={publishChatMessage} />
        <DeviceSettingsModal onSwitchDevice={switchDevice} />
        <HostControlsModal />
      </Suspense>
      <ToastContainer />
    </div>
  );
}
