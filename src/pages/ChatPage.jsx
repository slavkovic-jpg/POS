import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import CaptureModal from '../components/CaptureModal.jsx';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { api.chat.messages().then(setMessages).catch(console.error); }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    // optimistic append
    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content: t };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api.chat.send(t);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id),
        { id: `u-${Date.now()}`, role: 'user', content: r.user_text },
        r.assistant,
      ]);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="chat">
      <div className="page-header">
        <h1>Chat</h1>
        <p>Conversation is the primary interface. Tasks, goals, and plans are outputs of understanding.</p>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            Start with what's on your mind. The system will ask only questions that meaningfully raise planning confidence.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.content}
            {m.meta && (() => {
              try {
                const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta;
                return meta?.intent ? <span className="intent">{meta.intent}</span> : null;
              } catch { return null; }
            })()}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="What's on your mind? (Enter to send · Shift+Enter for newline)"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={send} disabled={sending || !text.trim()}>Send</button>
          <button className="ghost" onClick={() => setCaptureOpen(true)} disabled={messages.length === 0}>
            Capture
          </button>
        </div>
      </div>

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={(n) => setToast(`Saved ${n} item${n === 1 ? '' : 's'}.`)}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
