import { useEffect, Suspense, lazy } from 'react';
import { useDeviceStore } from '../../devices/deviceStore';
import { DeviceManager } from '../../devices/deviceManager';
import { DeviceSettingsTab } from '../../devices/types';
import { MicLevelMeter } from './MicLevelMeter';
import { VideoPreviewTile } from './VideoPreviewTile';

const NetworkDiagnosticsView = lazy(() => import('./NetworkDiagnosticsView').then(m => ({ default: m.NetworkDiagnosticsView })));

interface DeviceSettingsModalProps {
  onSwitchDevice?: (kind: MediaDeviceKind, deviceId: string) => Promise<void> | void;
}

export function DeviceSettingsModal({ onSwitchDevice }: DeviceSettingsModalProps) {
  const isSettingsOpen = useDeviceStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useDeviceStore((s) => s.setSettingsOpen);
  const activeTab = useDeviceStore((s) => s.activeTab);
  const setActiveTab = useDeviceStore((s) => s.setActiveTab);

  const audioInputs = useDeviceStore((s) => s.audioInputs);
  const audioOutputs = useDeviceStore((s) => s.audioOutputs);
  const videoInputs = useDeviceStore((s) => s.videoInputs);

  const selectedAudioInputId = useDeviceStore((s) => s.selectedAudioInputId);
  const selectedAudioOutputId = useDeviceStore((s) => s.selectedAudioOutputId);
  const selectedVideoInputId = useDeviceStore((s) => s.selectedVideoInputId);

  const isSpeakerTesting = useDeviceStore((s) => s.isSpeakerTesting);
  const sinkIdSupported = useDeviceStore((s) => s.sinkIdSupported);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setSettingsOpen]);

  // Enumerate devices on open and manage mic meter lifecycle
  useEffect(() => {
    const mgr = DeviceManager.getInstance();

    if (isSettingsOpen) {
      mgr.enumerateAndSyncDevices();
      mgr.startDeviceChangeListener();

      if (activeTab === 'audio') {
        mgr.startMicMeter(selectedAudioInputId);
      } else {
        mgr.stopMicMeter();
      }
    } else {
      mgr.stopDeviceChangeListener();
      mgr.stopMicMeter();
    }

    return () => {
      mgr.stopMicMeter();
    };
  }, [isSettingsOpen, activeTab, selectedAudioInputId]);

  if (!isSettingsOpen) return null;

  const handleAudioInputChange = async (deviceId: string) => {
    if (onSwitchDevice) {
      await onSwitchDevice('audioinput', deviceId);
    } else {
      await DeviceManager.getInstance().switchActiveDevice(null, 'audioinput', deviceId);
    }
    DeviceManager.getInstance().startMicMeter(deviceId);
  };

  const handleAudioOutputChange = async (deviceId: string) => {
    if (onSwitchDevice) {
      await onSwitchDevice('audiooutput', deviceId);
    } else {
      await DeviceManager.getInstance().switchActiveDevice(null, 'audiooutput', deviceId);
    }
  };

  const handleVideoInputChange = async (deviceId: string) => {
    if (onSwitchDevice) {
      await onSwitchDevice('videoinput', deviceId);
    } else {
      await DeviceManager.getInstance().switchActiveDevice(null, 'videoinput', deviceId);
    }
  };

  const handleTestSpeaker = () => {
    DeviceManager.getInstance().playSpeakerTestChime(selectedAudioOutputId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Device & Audio Settings"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 150ms ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--bg-elevated, #14141e)',
          border: '1px solid var(--border, #222233)',
          borderRadius: '16px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border, #222233)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>⚙️</span>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Device & Hardware Settings</h3>
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-muted, #888899)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Selector */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border, #222233)',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          {(['audio', 'video', 'diagnostics'] as DeviceSettingsTab[]).map((tab) => {
            const isActive = activeTab === tab;
            const labels = {
              audio: '🎙️ Audio',
              video: '📹 Video',
              diagnostics: '📊 Diagnostics',
            };
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--accent, #00d4aa)' : '2px solid transparent',
                  color: isActive ? 'var(--accent, #00d4aa)' : 'var(--fg-muted, #888899)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'audio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Microphone Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label
                  htmlFor="mic-select"
                  style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg, #eaeaea)' }}
                >
                  Microphone Input
                </label>
                <select
                  id="mic-select"
                  value={selectedAudioInputId}
                  onChange={(e) => handleAudioInputChange(e.target.value)}
                  style={selectStyle}
                >
                  {audioInputs.length === 0 ? (
                    <option value="">No microphones found</option>
                  ) : (
                    audioInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))
                  )}
                </select>

                <MicLevelMeter />
              </div>

              {/* Speaker Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label
                    htmlFor="speaker-select"
                    style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg, #eaeaea)' }}
                  >
                    Speaker Output
                  </label>
                  {!sinkIdSupported && (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        backgroundColor: 'rgba(255, 165, 2, 0.15)',
                        color: 'var(--warning, #ffa502)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      System managed (Safari/iOS)
                    </span>
                  )}
                </div>

                <select
                  id="speaker-select"
                  value={selectedAudioOutputId}
                  disabled={!sinkIdSupported || audioOutputs.length === 0}
                  onChange={(e) => handleAudioOutputChange(e.target.value)}
                  style={{
                    ...selectStyle,
                    opacity: !sinkIdSupported ? 0.6 : 1,
                  }}
                >
                  {audioOutputs.length === 0 ? (
                    <option value="">Default system speaker</option>
                  ) : (
                    audioOutputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))
                  )}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                  <button
                    onClick={handleTestSpeaker}
                    disabled={isSpeakerTesting}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.85rem',
                      padding: '8px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{isSpeakerTesting ? '🔊 Playing…' : '🔔 Test Speaker'}</span>
                  </button>
                  {isSpeakerTesting && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent, #00d4aa)' }}>
                      Playing chime sound…
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'video' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label
                  htmlFor="camera-select"
                  style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg, #eaeaea)' }}
                >
                  Camera Input
                </label>
                <select
                  id="camera-select"
                  value={selectedVideoInputId}
                  onChange={(e) => handleVideoInputChange(e.target.value)}
                  style={selectStyle}
                >
                  {videoInputs.length === 0 ? (
                    <option value="">No cameras found</option>
                  ) : (
                    videoInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <VideoPreviewTile />
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <Suspense fallback={null}>
              <NetworkDiagnosticsView />
            </Suspense>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border, #222233)',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={() => setSettingsOpen(false)}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '6px 16px' }}
          >
            Done
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--border, #222233)',
  borderRadius: '8px',
  color: 'var(--fg, #eaeaea)',
  fontSize: '0.9rem',
  cursor: 'pointer',
  outline: 'none',
};
