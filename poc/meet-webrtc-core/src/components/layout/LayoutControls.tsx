import { useLayoutStore } from '../../layout/layoutStore';
import { usePresenceStore } from '../../presence/presenceStore';
import './LayoutControls.css';

interface LayoutControlsProps {
  onClearSpotlight?: () => void;
}

export function LayoutControls({ onClearSpotlight }: LayoutControlsProps) {
  const mode = useLayoutStore((s) => s.mode);
  const userLockedMode = useLayoutStore((s) => s.userLockedMode);
  const setLayoutMode = useLayoutStore((s) => s.setLayoutMode);
  const unlockMode = useLayoutStore((s) => s.unlockMode);
  const pinnedParticipantIds = useLayoutStore((s) => s.pinnedParticipantIds);
  const pinParticipant = useLayoutStore((s) => s.pinParticipant);
  const spotlightParticipantId = useLayoutStore((s) => s.spotlightParticipantId);
  const screenShareOwnerId = useLayoutStore((s) => s.screenShareOwnerId);
  const presence = usePresenceStore();
  const isHost = presence.hostId !== null && presence.hostId === presence.localParticipantId;
  const spotlightName = spotlightParticipantId
    ? presence.participants.get(spotlightParticipantId)?.name || 'Participant'
    : null;
  const viewLabel = mode === 'content' ? 'Presentation' : mode === 'speaker' ? 'Speaker' : 'Gallery';

  return (
    <div className="meeting-layout-options">
      <div className="meeting-layout-options__choices" role="group" aria-label="Layout view selection">
        <button onClick={unlockMode} aria-pressed={userLockedMode === null}
          aria-label="Dynamic layout" title="Automatically follow speakers, pins, and screen sharing">
          <span aria-hidden="true">◈</span> Dynamic
        </button>
        <button onClick={() => setLayoutMode('gallery')} aria-pressed={userLockedMode === 'gallery'}
          aria-label="Gallery view"><span aria-hidden="true">▦</span> Gallery</button>
        <button onClick={() => setLayoutMode('speaker')} aria-pressed={userLockedMode === 'speaker'}
          aria-label="Speaker view"><span aria-hidden="true">▣</span> Speaker</button>
        {screenShareOwnerId && (
          <button onClick={() => setLayoutMode('content')} aria-pressed={userLockedMode === 'content'}
            aria-label="Screen presentation view"><span aria-hidden="true">▤</span> Presentation</button>
        )}
      </div>
      <div className="meeting-layout-options__details">
        <span className="meeting-layout-options__hint">
          {userLockedMode === null ? `Dynamic · ${viewLabel}` : `${viewLabel} view`} · Layout and pins affect only your view.
        </span>
        {pinnedParticipantIds.length > 0 && (
          <button className="meeting-layout-options__pins" onClick={() => pinParticipant(null)}
            aria-label={`Clear all ${pinnedParticipantIds.length} pins`}>
            {pinnedParticipantIds.length} pinned · Clear
          </button>
        )}
        {spotlightName && (
          <span className="meeting-layout-options__spotlight">
            Spotlight: {spotlightName}
            {isHost && onClearSpotlight && (
              <button onClick={onClearSpotlight} aria-label="Clear spotlight" title="Clear spotlight for everyone">×</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
