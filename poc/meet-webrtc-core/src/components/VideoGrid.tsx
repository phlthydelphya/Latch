import { useMemo } from 'react';
import { useLayoutStore } from '../layout/layoutStore';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { LayoutParticipantTile } from '../layout/types';
import { GalleryView } from './layout/GalleryView';
import { SpeakerView } from './layout/SpeakerView';
import { ContentView } from './layout/ContentView';

interface VideoGridProps {
  localStream: MediaStream | null;
  remoteStreams: MediaStream[];
  screenStream: MediaStream | null;
  localVideoEnabled: boolean;
  localAudioEnabled: boolean;
  screenSharing: boolean;
  onPin?: (id: string) => void;
  onSpotlight?: (id: string) => void;
}

export function VideoGrid({
  localStream,
  remoteStreams,
  screenStream,
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

  // Construct LayoutParticipantTiles from streams + presence store
  const tiles = useMemo(() => {
    const result: LayoutParticipantTile[] = [];

    // Local participant tile
    const localId = localParticipantId || 'local';
    result.push({
      id: localId,
      name: localPresence?.name || 'You',
      stream: screenSharing ? screenStream : localStream,
      isLocal: true,
      isScreen: screenSharing,
      videoEnabled: localVideoEnabled,
      audioEnabled: localAudioEnabled,
      speaking: activeSpeakers.has(localId),
    });

    // Remote participant tiles
    // Exclude participants who are still in the waiting room queue
    const waitingIds = new Set(waitingQueue.map((w) => w.participantId));
    const remotePresenceList = Array.from(presenceParticipants.values()).filter((p) => !p.isLocal);
    const remoteList = remotePresenceList.filter((p) => !waitingIds.has(p.id));

    if (remoteList.length > 0) {
      remoteList.forEach((p, idx) => {
        const stream = remoteStreams[idx] || null;
        result.push({
          id: p.id,
          name: p.name,
          stream,
          isLocal: false,
          isScreen: p.screenSharing,
          videoEnabled: p.videoEnabled,
          audioEnabled: p.audioEnabled,
          speaking: activeSpeakers.has(p.id),
        });
      });
    } else if (remotePresenceList.length === 0) {
      // Fallback for mock/test runs without full presence roster
      remoteStreams.forEach((stream, idx) => {
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
        });
      });
    }

    return result;
  }, [
    localStream,
    remoteStreams,
    screenStream,
    localVideoEnabled,
    localAudioEnabled,
    screenSharing,
    presenceParticipants,
    localPresence,
    activeSpeakers,
    waitingQueue,
  ]);

  if (mode === 'content') {
    return (
      <ContentView
        screenStream={screenStream}
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