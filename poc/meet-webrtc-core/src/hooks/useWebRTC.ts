import { useEffect, useRef, useCallback, useState } from 'react';
import { createWebRTCManager, createP0Config, DEFAULT_P0_CONFIG, type WebRTCManagerConfig } from '../index';
import { useAppStore } from '../store/appStore';

export function useWebRTC() {
  const { roomId, participantId, jwt, keyParam, setConnected, setReconnecting, setError, setShieldMode, addParticipant, removeParticipant } = useAppStore();
  const managerRef = useRef<Awaited<ReturnType<typeof createWebRTCManager>> | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<RTCStatsReport | null>(null);

  const initialize = useCallback(async () => {
    if (!roomId || !participantId || !jwt) return;

    try {
      // Build signaling URL: relative '/signal' goes through Vite proxy (ws:true) in dev, Caddy in prod
      // If VITE_SIGNALING_URL is absolute (e.g., wss://prod.example.com/signal), use it directly
      const signalingUrl = import.meta.env.VITE_SIGNALING_URL || '/signal';
      
      // Build TURN credentials URL: relative '/turn/credentials' goes through Vite proxy in dev, Caddy in prod
      // turn-auth expects POST /turn/credentials (per architecture-brief.md §3, ADR-005)
      // If VITE_TURN_URL is absolute, use it directly
      const turnCredentialsUrl = import.meta.env.VITE_TURN_URL || '/turn/credentials';

      const config: WebRTCManagerConfig = createP0Config({
        roomId,
        participantId,
        signalingUrl,
        turnCredentialsUrl,
        jwt,
        ...DEFAULT_P0_CONFIG,
      });

      const manager = await createWebRTCManager(config);
      managerRef.current = manager;

      // Register the manager for E2E test introspection (Playwright reads window.__WEBRTC_MANAGERS__)
      const managers: Map<string, unknown> = window.__WEBRTC_MANAGERS__ ?? new Map();
      managers.set(participantId, manager);
      window.__WEBRTC_MANAGERS__ = managers;

      // Event handlers
      manager.on('connected', () => {
        setConnected(true);
        setShieldMode(true);
      });

      manager.on('reconnecting', () => setReconnecting(true));
      manager.on('reconnected', () => setReconnecting(false));
      manager.on('reconnect-failed', (err) => setError(`Reconnection failed: ${err}`));

      manager.on('track', ({ track, streams }) => {
        const stream = streams[0];
        if (stream) {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(track.id, stream);
            return next;
          });
        }
      });

      manager.on('participant-joined', ({ participantId: pid }) => {
        // Track remote participants so the app store reflects the room roster
        addParticipant({
          id: pid,
          name: `Participant ${pid.slice(0, 6)}`,
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isLocal: false,
          isSpeaking: false,
        });
      });

      manager.on('participant-left', ({ participantId: pid }) => {
        removeParticipant(pid);
      });

      manager.on('key-rotated', ({ latency }) => {
        console.log(`[SFrame] Key rotated in ${latency.toFixed(1)}ms`);
      });

      manager.on('screen-share-started', ({ stream }) => {
        setScreenStream(stream);
      });

      manager.on('screen-share-stopped', () => {
        setScreenStream(null);
      });

      manager.on('error', (err) => setError(err.message));

      // Join the room (this will emit 'joined' event with local stream)
      await manager.join(roomId, { video: true, audio: true });
      
      // Local stream will be available via 'track' event or we can get it from manager
      // For now, we'll listen for the joined event
      manager.on('joined', ({ localStream: stream }) => {
        if (stream) setLocalStream(stream);
      });

      // Stats polling
      const statsInterval = setInterval(async () => {
        if (managerRef.current) {
          try {
            const s = await managerRef.current.getConnectionStats();
            setStats(s);
          } catch {}
        }
      }, 2000);

      return () => clearInterval(statsInterval);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize WebRTC');
    }
  }, [roomId, participantId, jwt, setConnected, setReconnecting, setError, setShieldMode, addParticipant, removeParticipant]);

  useEffect(() => {
    let cleanup: (() => void) | void;
    initialize().then((c) => { cleanup = c; });
    return () => {
      if (typeof cleanup === 'function') cleanup();
      if (managerRef.current) {
        if (participantId) window.__WEBRTC_MANAGERS__?.delete(participantId);
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, [initialize, participantId]);

  const toggleAudio = useCallback(async () => {
    if (managerRef.current) {
      const enabled = !localStream?.getAudioTracks()[0]?.enabled;
      await managerRef.current.setAudioEnabled(enabled);
    }
  }, [localStream]);

  const toggleVideo = useCallback(async () => {
    if (managerRef.current) {
      const enabled = !localStream?.getVideoTracks()[0]?.enabled;
      await managerRef.current.setVideoEnabled(enabled);
    }
  }, [localStream]);

  const startScreenShare = useCallback(async () => {
    if (managerRef.current) {
      try {
        await managerRef.current.startScreenShare();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Screen share failed');
      }
    }
  }, [setError]);

  const stopScreenShare = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.stopScreenShare();
    }
  }, []);

  const leave = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.leave();
      managerRef.current = null;
    }
  }, []);

  return {
    manager: managerRef.current,
    localStream,
    remoteStreams: Array.from(remoteStreams.values()),
    screenStream,
    stats,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    leave,
  };
}