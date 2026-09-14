import { useState, useRef, useEffect } from 'react';
import { useCollaborationStore } from '../../collaboration/collaborationStore';

interface ChatDrawerProps {
  onSendMessage: (text: string) => void;
}

/**
 * Safe, zero-dependency inline markdown tokenizer.
 * Escapes HTML then translates bold, italic, inline code, and URLs safely.
 */
function renderSafeMarkdown(content: string): string {
  // 1. Strict HTML escape
  let safe = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. Inline code `code`
  safe = safe.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.85em;">$1</code>');

  // 3. Bold **text**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 4. Italic *text*
  safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 5. Autolink URLs
  safe = safe.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent,#00d4aa);text-decoration:underline;">$1</a>'
  );

  return safe;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatDrawer({ onSendMessage }: ChatDrawerProps) {
  const isChatOpen = useCollaborationStore((s) => s.isChatOpen);
  const toggleChat = useCollaborationStore((s) => s.toggleChat);
  const messages = useCollaborationStore((s) => s.messages);
  const markChatRead = useCollaborationStore((s) => s.markChatRead);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isChatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      markChatRead();
    }
  }, [messages, isChatOpen, markChatRead]);

  // Focus input when opened
  useEffect(() => {
    if (isChatOpen) {
      textareaRef.current?.focus();
    }
  }, [isChatOpen]);

  if (!isChatOpen) return null;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <aside className="meeting-chat"
      role="complementary"
      aria-label="Meeting chat"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: '72px', // space for control bar
        width: '320px',
        maxWidth: '100vw',
        background: 'rgba(15, 15, 22, 0.95)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '1rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>💬</span>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>In-Call Chat</h2>
        </div>
        <button
          onClick={() => toggleChat(false)}
          aria-label="Close chat"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-muted)',
            fontSize: '1.2rem',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Message Stream */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: '0.85rem',
              marginTop: '40px',
            }}
          >
            <p style={{ margin: '0 0 8px 0' }}>🔒 End-to-end encrypted chat</p>
            <p style={{ margin: 0, fontSize: '0.75rem' }}>
              Messages are stored in memory only and erased when the call ends.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.isLocal ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                fontSize: '0.75rem',
                color: 'var(--fg-muted)',
                marginBottom: '2px',
              }}
            >
              <span style={{ fontWeight: 600, color: msg.isLocal ? 'var(--accent, #00d4aa)' : 'var(--fg)' }}>
                {msg.senderName}
              </span>
              <span>{formatTime(msg.timestamp)}</span>
            </div>

            <div
              style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: msg.isLocal ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.isLocal ? 'var(--accent, #00d4aa)' : 'var(--bg-elevated, #1a1a24)',
                color: msg.isLocal ? '#0a0a0f' : 'var(--fg)',
                fontSize: '0.9rem',
                lineHeight: 1.4,
                wordBreak: 'break-word',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
              dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(msg.text) }}
            />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div
        style={{
          padding: '0.75rem',
          borderTop: '1px solid var(--border)',
          background: 'rgba(20, 20, 30, 0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={handleKeyDown}
            placeholder="Type a secure message…"
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--bg, #0a0a0f)',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 10px',
              fontSize: '0.85rem',
              outline: 'none',
              maxHeight: '100px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Send message"
            style={{
              background: input.trim() ? 'var(--accent, #00d4aa)' : 'var(--bg-elevated, #2a2a38)',
              color: input.trim() ? '#000' : 'var(--fg-muted)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '1rem',
              cursor: input.trim() ? 'pointer' : 'default',
              transition: 'all 120ms ease',
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </aside>
  );
}
