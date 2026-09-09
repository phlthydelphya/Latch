import { useCollaborationStore } from '../../collaboration/collaborationStore';
import { ReactionEmoji } from '../../collaboration/types';

interface ReactionsBarProps {
  onSendReaction: (emoji: ReactionEmoji) => void;
}

const EMOJIS: ReactionEmoji[] = ['👍', '👏', '❤️', '🎉', '✋'];

export function ReactionsBar({ onSendReaction }: ReactionsBarProps) {
  const isReactionsBarOpen = useCollaborationStore((s) => s.isReactionsBarOpen);
  const toggleReactionsBar = useCollaborationStore((s) => s.toggleReactionsBar);

  if (!isReactionsBarOpen) return null;

  const handleSelect = (emoji: ReactionEmoji) => {
    onSendReaction(emoji);
    toggleReactionsBar(false);
  };

  return (
    <div
      role="toolbar"
      aria-label="Reaction emojis"
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(20, 20, 30, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        borderRadius: '28px',
        padding: '6px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 60,
        animation: 'popIn 150ms ease-out',
      }}
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => handleSelect(emoji)}
          aria-label={`React with ${emoji}`}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '1.6rem',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '50%',
            transition: 'transform 120ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.35)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {emoji}
        </button>
      ))}

      <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 2px' }} />

      <button
        onClick={() => toggleReactionsBar(false)}
        aria-label="Close reactions"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--fg-muted)',
          fontSize: '1rem',
          cursor: 'pointer',
          padding: '2px 6px',
        }}
      >
        ✕
      </button>

      <style>{`
        @keyframes popIn {
          from { opacity: 0; transform: translate(-50%, 10px) scale(0.9); }
          to { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
      `}</style>
    </div>
  );
}
