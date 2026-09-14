import { useEffect, useMemo } from 'react';
import { useLayoutStore } from '../layout/layoutStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { LayoutParticipantTile } from '../layout/types';
import { GalleryView } from './layout/GalleryView';
import { SpeakerView } from './layout/SpeakerView';
import { ContentView } from './layout/ContentView';

interface VideoGridProps {
  localStream: MediaStream | null;
  /** Camera streams keyed by participantId (for both local and remote) */
  cameraStreams: Map<string, MediaStream>;
  /** Screen share streams keyed by participantId (owner-keyed) */
  screenStreams: Map<string, MediaStream>;
  localVideoEnabled: boolean;
  localAudioEnabled: boolean;
  screenSharing: boolean;
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function VideoGrid({
  localStream,
  cameraStreams,
  screenStreams,
  localVideoEnabled,
  localAudioEnabled,
  screenSharing,
  onPin,
  onSpotlight,
}: VideoGridProps) {
  const mode = useLayoutStore((s) => s.mode);
  const presenceParticipants = usePresenceStore((s) => s.participants);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const localPresence = presenceParticipants.get(localParticipantId || '');
  const activeSpeakers = usePresenceStore((s) => s.activeSpeakers);
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);
  const screenShareOwnerId = useLayoutStore((s) => s.screenShareOwnerId);
  const retainParticipants = useLayoutStore((s) => s.retainParticipants);
  const evaluateArbitration = useLayoutStore((s) => s.evaluateArbitration);

  // Construct LayoutParticipantTiles from streams + presence store
  const tiles = useMemo(() => {
    const result: LayoutParticipantTile[] = [];

    // Local participant tile - ALWAYS use camera stream (localStream)
    // When screen sharing, also attach cameraStream for PiP
    const localId = localParticipantId || 'local';
    const localCameraStream = cameraStreams.get(localId) || localStream;
    const localScreenStream = screenStreams.get(localId) || null;
    
    result.push({
      id: localId,
      name: localPresence?.name || 'You',
      stream: localCameraStream, // Always camera stream for the tile
      isLocal: true,
      isScreen: false, // Local tile is never a screen tile
      videoEnabled: localVideoEnabled,
      audioEnabled: localAudioEnabled,
      speaking: activeSpeakers.has(localId),
      cameraStream: localCameraStream,
    });

    // Remote participant tiles
    // Exclude participants who are still in the waiting room queue
    const waitingIds = new Set(waitingQueue.map((w) => w.participantId));
    const remotePresenceList = Array.from(presenceParticipants.values()).filter((p) => !p.isLocal);
    const remoteList = remotePresenceList.filter((p) => !waitingIds.has(p.id));

    if (remoteList.length > 0) {
      remoteList.forEach((p) => {
        // Use camera stream keyed by participantId, not index
        const cameraStream = cameraStreams.get(p.id) || null;
        const screenStream = screenStreams.get(p.id) || null;
        const isScreenOwner = screenShareOwnerId === p.id;
        
        result.push({
          id: p.id,
          name: p.name,
          stream: cameraStream, // Always camera stream for the tile
          isLocal: false,
          isScreen: p.screenSharing && isScreenOwner, // Only true if this participant is the screen share owner
          videoEnabled: p.videoEnabled,
          audioEnabled: p.audioEnabled,
          speaking: activeSpeakers.has(p.id),
          cameraStream: cameraStream,
        });
      });
    } else if (remotePresenceList.length === 0) {
      // Fallback for mock/test runs without full presence roster
      // Convert cameraStreams map to array for backward compatibility
      const cameraStreamArray = Array.from(cameraStreams.values());
      cameraStreamArray.forEach((stream, idx) => {
        const id = `remote-${idx}`;
        result.push({
          id,
          name: `Participant ${idx + 1}`,
          stream,
          isLocal: false,
          isScreen: false,
          videoEnabled: true,
          audioEnabled: true,
          speaking: false,
          cameraStream: stream,
        });
      });
    }

    return result;
  }, [
    localStream,
    localParticipantId,
    cameraStreams,
    screenStreams,
    localVideoEnabled,
    localAudioEnabled,
    screenSharing,
    presenceParticipants,
    localPresence,
    activeSpeakers,
    waitingQueue,
    screenShareOwnerId,
  ]);

  useEffect(() => {
    retainParticipants(tiles.map((tile) => tile.id));
    evaluateArbitration(tiles.length);
  }, [tiles, retainParticipants, evaluateArbitration]);

  // For ContentView, we need the owner's screen stream
  const ownerScreenStream = screenShareOwnerId ? screenStreams.get(screenShareOwnerId) || null : null;

  if (mode === 'content') {
    return (
      <ContentView
        screenStream={ownerScreenStream}
        tiles={tiles}
        onPin={onPin}
        onSpotlight={onSpotlight}
      />
    );
  }

  if (mode === 'speaker') {
    return (
      <SpeakerView
        tiles={tiles}
        onPin={onPin}
        onSpotlight={onSpotlight}
      />
    );
  }

  // Default: Gallery View
  return (
    <GalleryView
      tiles={tiles}
      onPin={onPin}
      onSpotlight={onSpotlight}
    />
  );
}
