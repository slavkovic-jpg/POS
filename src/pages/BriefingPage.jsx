import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import ConfidenceBar from '../components/ConfidenceBar.jsx';
import StageTracker from '../components/StageTracker.jsx';

/** A rough guess at a clock time from whatever the model wrote — "9am",
 *  "9:30 AM", "14:00". Never trusted as-is; it only prefills the input the
 *  user actually confirms before anything is scheduled. */
function guessTime(label) {
  if (!label) return '';
  const m = String(label).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2] || '00';
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return '';
  return `${String(h).padStart(2, '0')}:${min}`;
}

export default function BriefingPage() {
  const [b, setB] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [toast, setToast] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    api.briefing.today().then(setB).catch(console.error);
    api.briefing.messages().then(setMessages).catch(console.error);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!b) return <div className="empty">Loading briefing…</div>;

  async function send() {
    const clean = text.trim();
    if (!clean || sending) return;
    setText('');
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: clean }]);
    setSending(true);
    try {
      const r = await api.briefing.chat(clean);
      setMessages((m) => [
        ...m.filter((x) => !String(x.id).startsWith('tmp-')),
        { id: `u-${Date.now()}`, role: 'user', content: clean },
        { id: `a-${Date.now()}`, role: 'assistant', content: r.reply },
      ]);
      if (r.proposal?.items?.length) {
        setProposal({
          stages: r.proposal.stages,
          items: r.proposal.items.map((it) => ({ ...it, time: guessTime(it.time_label) })),
        });
      }
    } catch (err) {
      setToast(`Failed: ${err.message}`);
      setMessages((m) => m.filter((x) => !String(x.id).startsWith('tmp-')));
    } finally {
      setSending(false);
    }
  }

  async function toggleStage(name) {
    const stages = { [name]: !b.stages[name] };
    setB(await api.briefing.update({ stages }));
  }

  function patchItem(i, patch) {
    setProposal((p) => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }));
  }

  async function acceptPlan() {
    setAccepting(true);
    try {
      const r = await api.briefing.accept({ items: proposal.items, stages: proposal.stages });
      setB(r);
      setProposal(null);
      setToast(r.scheduled_count > 0
        ? `Plan accepted — ${r.scheduled_count} task${r.scheduled_count === 1 ? '' : 's'} scheduled.`
        : 'Plan accepted.');
    } catch (err) {
      setToast(`Failed: ${err.message}`);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Morning briefing — {b.date}</h1>
        <p>A short conversation, not a form. Talk it through; accept the plan once it looks right.</p>
      </div>

      <div className="panel">
        <ConfidenceBar value={b.confidence} label="Plan readiness" />
        <h3>Stages</h3>
        <StageTracker stages={b.stages} stageNames={b.stage_names} onToggle={toggleStage} />
        <div className="item-meta" style={{ marginTop: 6 }}>
          These fill in as you talk. You can also toggle one by hand if the conversation missed it.
        </div>
      </div>

      <div className="panel">
        <h2>Talk it through</h2>
        <div className="chat-messages" ref={scrollRef} style={{ maxHeight: 340, minHeight: 140 }}>
          {messages.length === 0 && (
            <div className="empty">
              Say what's actually on today, or just say "morning" and answer what comes back.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>{m.content}</div>
          ))}
          {sending && (
            <div className="chat-msg assistant" style={{ color: 'var(--text-faint)' }}>Thinking…</div>
          )}
        </div>
        <div className="chat-input" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="What's actually on today? Enter to send."
          />
          <button onClick={send} disabled={sending || !text.trim()}>Send</button>
        </div>
      </div>

      {proposal?.items?.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--accent)' }}>
          <h2>Proposed plan</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
            Nothing here is scheduled until you accept it. Set or fix a time for anything you want
            actually placed on the calendar — leave it blank to keep it as a plain note.
          </p>
          <ul className="item-list">
            {proposal.items.map((it, i) => (
              <li key={i} style={{ alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="item-title">{it.title}</div>
                  {it.note && <div className="item-meta" style={{ marginTop: 3 }}>{it.note}</div>}
                  {!it.task_id && (
                    <div className="item-meta" style={{ marginTop: 3 }}>Not linked to a task — a note only.</div>
                  )}
                </div>
                <input type="time" value={it.time || ''} disabled={!it.task_id}
                  onChange={(e) => patchItem(i, { time: e.target.value })}
                  title={it.task_id ? 'When to schedule this' : 'Only tasks can be scheduled'}
                  style={{ width: 110 }} />
              </li>
            ))}
          </ul>
          <div className="row-flex" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="ghost" onClick={() => setProposal(null)}>Dismiss</button>
            <button onClick={acceptPlan} disabled={accepting}>
              {accepting ? 'Accepting…' : 'Accept plan'}
            </button>
          </div>
        </div>
      )}

      {b.accepted_plan?.length > 0 && (
        <div className="panel">
          <h2>Today's accepted plan</h2>
          <ul className="item-list">
            {b.accepted_plan.map((it, i) => (
              <li key={i}>
                <div>
                  <div className="item-title">
                    {it.time && <span className="badge" style={{ marginRight: 8 }}>{it.time}</span>}
                    {it.title}
                  </div>
                  {it.note && <div className="item-meta" style={{ marginTop: 3 }}>{it.note}</div>}
                </div>
              </li>
            ))}
          </ul>
          {b.accepted_at && (
            <div className="item-meta" style={{ marginTop: 8 }}>
              Accepted at {new Date(b.accepted_at).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2>Open questions</h2>
          {b.open_questions.length === 0 && <div className="empty">No open strategic questions.</div>}
          <ul className="item-list">
            {b.open_questions.map((q) => (
              <li key={q.id}>
                <div>
                  <div className="item-title">{q.question}</div>
                  <div className="item-meta">
                    <span className={`badge ${q.status}`}>{q.status}</span>
                    {q.review_date && <span> · review {q.review_date}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Active tasks</h2>
          {b.active_tasks.length === 0 && <div className="empty">No active tasks.</div>}
          <ul className="item-list">
            {b.active_tasks.map((t) => (
              <li key={t.id}>
                <div>
                  <div className="item-title">{t.title}</div>
                  <div className="item-meta">
                    {t.domain_key && <span className="badge">{t.domain_key}</span>}
                    {t.strategic_importance && <span> · importance {t.strategic_importance}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
