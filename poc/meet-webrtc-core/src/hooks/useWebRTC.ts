import { useEffect, useRef, useCallback, useState } from 'react';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import { fetchToken, resolveSfuUrl } from '../auth/token';
import { useAppStore } from '../store/appStore';

export function useWebRTC() {
  const { roomId, participantId, jwt, livekitToken, sfuUrl, keyParam, setConnected, setReconnecting, setError, setShieldMode, addParticipant, removeParticipant, setLocalParticipant } = useAppStore();
  const roomRef = useRef<Room | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<RTCStatsReport | null>(null);

  const initialize = useCallback(async () => {
    if (!roomId) return;

    try {
      // Fetch token if not already in store (authoritative source for sfuUrl + livekitToken)
      let token = livekitToken;
      let resolvedSfuUrl = sfuUrl ? resolveSfuUrl(sfuUrl) : '';

      if (!token || !resolvedSfuUrl) {
        const name = `user-${participantId?.slice(0, 6) || 'anon'}`;
        const fetched = await fetchToken(roomId, name);
        token = fetched.livekitToken;
        resolvedSfuUrl = resolveSfuUrl(fetched.sfuUrl);
      }

      if (!token || !resolvedSfuUrl) {
        throw new Error('Missing livekitToken or sfuUrl after token fetch');
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // Expose room for Playwright/test verification
      (window as any).__LIVEKIT_ROOM__ = room;

      // Event handlers
      room.on(RoomEvent.Connected, () => {
        console.log('[LiveKit] room.name', room.name, 'state', room.state, 'localParticipant', room.localParticipant?.identity);
        setConnected(true);
        setShieldMode(true);
        
        // Set local participant in store
        if (room.localParticipant) {
          setLocalParticipant({
            id: room.localParticipant.identity,
            name: `You (${room.localParticipant.identity.slice(0, 6)})`,
            audioEnabled: room.localParticipant.isMicrophoneEnabled,
            videoEnabled: room.localParticipant.isCameraEnabled,
            screenSharing: room.localParticipant.isScreenShareEnabled,
            isLocal: true,
            isSpeaking: false,
          });
        }
      });

      room.on(RoomEvent.Disconnected, (reason) => {
        setConnected(false);
        setShieldMode(false);
        if (reason) {
          setError(`Disconnected: ${reason}`);
        }
      });

      room.on(RoomEvent.Reconnecting, () => setReconnecting(true));
      room.on(RoomEvent.Reconnected, () => setReconnecting(false));

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        addParticipant({
          id: participant.identity,
          name: `Participant ${participant.identity.slice(0, 6)}`,
          audioEnabled: participant.isMicrophoneEnabled,
          videoEnabled: participant.isCameraEnabled,
          screenSharing: participant.isScreenShareEnabled,
          isLocal: false,
          isSpeaking: false,
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        removeParticipant(participant.identity);
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        const stream = new MediaStream();
        // Track.mediaStreamTrack is the underlying MediaStreamTrack (LiveKit wraps native tracks)
        const mst = (track as any).mediaStreamTrack as MediaStreamTrack | undefined;
        if (mst) {
          stream.addTrack(mst);
        }
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(publication.trackSid, stream);
          return next;
        });
      });

      room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(publication.trackSid);
          return next;
        });
      });

      room.on(RoomEvent.LocalTrackPublished, (_publication, participant) => {
        // Local track published - we can get the stream from the participant
        if (participant === room.localParticipant) {
          const stream = new MediaStream();
          room.localParticipant?.trackPublications.forEach((pub) => {
            const mst = (pub.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined;
            if (mst) {
              stream.addTrack(mst);
            }
          });
          if (stream.getTracks().length > 0) {
            setLocalStream(stream);
          }
        }
      });

      room.on(RoomEvent.DataReceived, (payload, participant) => {
        // Handle data messages if needed
        console.log('[LiveKit] Data received from', participant?.identity);
      });

      // Connect to LiveKit room
      await room.connect(resolvedSfuUrl, token);

      // Stats polling — LiveKit Room has no getConnectionStats; poll via getStats on publisher if available
      const statsInterval = setInterval(async () => {
        if (roomRef.current) {
          try {
            // Use WebRTC peer connection stats if exposed via engine, otherwise skip
            const pc = (roomRef.current as any).engine?.publisher?.pc as RTCPeerConnection | undefined;
            if (pc) {
              const s = await pc.getStats();
              setStats(s);
            }
          } catch {}
        }
      }, 2000);

      return () => clearInterval(statsInterval);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // BLOCK CONDITION: Return exception + stack + JWT payload + sfuUrl + file/line
      console.error('[LiveKit] Connection failed:', {
        message: error.message,
        stack: error.stack,
        roomId,
        sfuUrl: sfuUrl ? resolveSfuUrl(sfuUrl) : 'N/A',
        livekitTokenPrefix: livekitToken?.slice(0, 20) + '...' || 'N/A',
        file: 'useWebRTC.ts',
        line: 'initialize callback',
      });
      setError(`LiveKit connection failed: ${error.message}`);
      throw error;
    }
  }, [roomId, participantId, jwt, livekitToken, sfuUrl, keyParam, setConnected, setReconnecting, setError, setShieldMode, addParticipant, removeParticipant, setLocalParticipant]);

  useEffect(() => {
    let cleanup: (() => void) | void;
    initialize().then((c) => { cleanup = c; }).catch(() => {});
    return () => {
      if (typeof cleanup === 'function') cleanup();
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      (window as any).__LIVEKIT_ROOM__ = null;
    };
  }, [initialize]);

  const toggleAudio = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      const enabled = !roomRef.current.localParticipant.isMicrophoneEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
    }
  }, []);

  const toggleVideo = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      const enabled = !roomRef.current.localParticipant.isCameraEnabled;
      await roomRef.current.localParticipant.setCameraEnabled(enabled);
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      try {
        await roomRef.current.localParticipant.setScreenShareEnabled(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Screen share failed');
      }
    }
  }, [setError]);

  const stopScreenShare = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      await roomRef.current.localParticipant.setScreenShareEnabled(false);
    }
  }, []);

  const leave = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
      (window as any).__LIVEKIT_ROOM__ = null;
    }
  }, []);

  return {
    room: roomRef.current,
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