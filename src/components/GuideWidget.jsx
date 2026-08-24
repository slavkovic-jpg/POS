import React, { useEffect, useRef, useState } from 'react';
import { Compass, Send } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Small, persistent wayfinding chat on the Dashboard — "where do I do X",
 * "what's best right now", "I'm lost". Backed by `askGuide()`
 * (`server/guide.mjs`), which phrases the app's real numbers and the actual
 * `recommendNext()` pick; it never computes its own ranking, so asking this
 * "what should I do now" gives the same answer as the Dashboard's own
 * recommendation, not a second opinion.
 *
 * History lives in this component's state only — not persisted server-side,
 * on purpose. This is a quick tool, not a third conversation thread to
 * maintain alongside Copilot and Briefing.
 */
const SUGGESTIONS = [
  'What should I do now?',
  'Where do I record a promise?',
  "I'm not sure where to start",
];

export default function GuideWidget() {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, asking]);

  async function ask(question) {
    const q = question.trim();
    if (!q || asking) return;
    setText('');
    const priorHistory = history;
    setHistory((h) => [...h, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const r = await api.guide.ask(q, priorHistory);
      setHistory((h) => [...h, { role: 'assistant', text: r.answer }]);
    } catch (err) {
      setHistory((h) => [...h, { role: 'assistant', text: `Couldn't reach a backend: ${err.message}` }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      {history.length === 0 && (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
            Not sure where to go, or what's actually worth doing right now? Ask.
          </p>
          <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill" onClick={() => ask(s)} disabled={asking}>{s}</button>
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <div className="chat-messages" ref={scrollRef}
          style={{ maxHeight: 240, minHeight: 60, marginBottom: 10 }}>
          {history.map((h, i) => (
            <div key={i} className={`chat-msg ${h.role}`}>{h.text}</div>
          ))}
          {asking && <div className="chat-msg assistant" style={{ color: 'var(--text-faint)' }}>Thinking…</div>}
        </div>
      )}

      <div className="row-flex" style={{ gap: 8 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }}
          placeholder="Ask where to go, or what's worth doing now"
          style={{ flex: 1 }}
        />
        <button onClick={() => ask(text)} disabled={asking || !text.trim()}>
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
