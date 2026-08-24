import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSpeech } from '../lib/useSpeech.js';
import { FolderInput } from 'lucide-react';
import RouteModal from '../components/RouteModal.jsx';

/**
 * The one conversation surface — voice or typed, advisor or intake or coach.
 * Formerly split across Copilot and Chat, which shared the same
 * `chat_messages` table and backend and differed only in whether voice was
 * wired up. Chat added nothing Copilot didn't already do, so it was retired
 * rather than kept as a second, thinner path to the same conversation.
 *
 * Layout is static-top, scrolling-transcript: the mode switch, mic, and input
 * never move. Only `.chat-messages` scrolls, and it renders newest-first, so
 * a new message needs no auto-scroll-to-bottom trick — it simply appears
 * where you're already looking.
 */
export default function CopilotPage() {
  const [messages, setMessages] = useState([]);
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState(() => localStorage.getItem('pos_mode') || 'advisor');
  const [voiceReplies, setVoiceReplies] = useState(
    () => localStorage.getItem('pos_voice_replies') !== 'false'
  );
  const [thinking, setThinking] = useState(false);
  const [typed, setTyped] = useState('');
  const [routeOpen, setRouteOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { localStorage.setItem('pos_mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('pos_voice_replies', String(voiceReplies)); }, [voiceReplies]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    api.chat.messages().then((msgs) => {
      setMessages(msgs);
      markSeen(Math.max(0, ...msgs.map((m) => Number(m.id) || 0)));
    }).catch(console.error);
    api.config().then(setConfig).catch(console.error);
  }, []);

  // Newest-first means the newest message is already at the top of the list.
  // Only nudge the scroll position back to 0 if the reader was already there
  // — someone scrolled down into history should not get yanked back up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 40) el.scrollTop = 0;
  }, [messages, thinking]);

  // Declared before useSpeech so the callback can reference speech helpers via
  // the ref below without a circular dependency.
  const speechRef = useRef(null);

  const send = useCallback(async (text, { spoken }) => {
    const clean = text?.trim();
    if (!clean || thinking) return;

    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: clean }]);
    setThinking(true);
    try {
      const r = await api.chat.send(clean, { mode, spoken });
      setMessages((m) => [
        ...m.filter((x) => !String(x.id).startsWith('tmp-')),
        { id: `u-${Date.now()}`, role: 'user', content: clean },
        r.assistant,
      ]);
      markSeen(r.assistant.id);
      if (spoken && voiceReplies) speechRef.current?.speak(r.assistant.content);
    } catch (err) {
      setToast(`Failed: ${err.message}`);
      setMessages((m) => m.filter((x) => !String(x.id).startsWith('tmp-')));
    } finally {
      setThinking(false);
    }
  }, [mode, thinking, voiceReplies]);

  const speech = useSpeech({
    onFinalTranscript: (text) => send(text, { spoken: true }),
    silenceMs: 3500,
  });
  speechRef.current = speech;

  const {
    listening, speaking, interim, error: speechError,
    startListening, stopListening, cancelSpeech, supported,
    voices, voiceURI, setVoiceURI, clearError,
  } = speech;

  function toggleMic() {
    if (listening) stopListening();
    else { cancelSpeech(); startListening(); }
  }

  const slowBackend = config && !config.fast_backend_available;
  const activeHint = config?.modes?.find((m) => m.key === mode)?.hint;

  return (
    <div className="chat">
      <div className="page-header" style={{ marginBottom: 10 }}>
        <h1>Copilot</h1>
        <p>Talk or type — same conversation either way.</p>
      </div>

      {/* Static: mode switch, mic/voice/File-this, and the input. Never scrolls. */}
      <div className="copilot-topbar">
        <div className="mode-switch">
          {(config?.modes || []).map((m) => (
            <button
              key={m.key}
              className={`mode-${m.key}` + (mode === m.key ? ' active' : '')}
              onClick={() => setMode(m.key)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="row-flex" style={{ gap: 8 }}>
          <button
            className={'mic' + (listening ? ' listening' : '') + (speaking ? ' speaking' : '')}
            onClick={toggleMic}
            disabled={!supported.stt}
            title={listening ? 'Stop listening' : 'Start listening'}
          >
            {listening ? '■' : '●'}
          </button>
          {speaking && <button className="ghost" onClick={cancelSpeech}>Stop speaking</button>}
          <button className="ghost" onClick={() => setVoiceReplies((v) => !v)} title="Read replies aloud">
            {voiceReplies ? 'Voice on' : 'Voice off'}
          </button>
          <button className="ghost" onClick={() => setShowSettings((s) => !s)}>Voice…</button>
          {/* The assistant has no tools and never will, so it can describe a
              filing plan perfectly and do nothing with it. This is how what
              was agreed actually reaches the tables — same review screen,
              same nothing-writes-unconfirmed rule. */}
          <button onClick={() => setRouteOpen(true)} disabled={messages.length === 0}>
            <FolderInput size={13} />File this
          </button>
        </div>
      </div>
      {activeHint && <div className="item-meta" style={{ marginTop: 2, marginBottom: 10 }}>{activeHint}</div>}

      {interim && <div className="interim-preview">"{interim}"</div>}

      <div className="chat-input">
        <textarea
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const t = typed; setTyped('');
              send(t, { spoken: false });
            }
          }}
          placeholder="…or type. Enter to send."
          rows={2}
        />
        <button
          onClick={() => { const t = typed; setTyped(''); send(t, { spoken: false }); }}
          disabled={thinking || !typed.trim()}
        >
          Send
        </button>
      </div>

      {slowBackend && (
        <div className="panel" style={{ borderColor: 'var(--warn)', padding: 12, marginBottom: 12 }}>
          <strong style={{ color: 'var(--warn)' }}>Voice will be slow on this backend.</strong>
          <div className="item-meta" style={{ marginTop: 4 }}>
            Only a local model is configured, which takes a minute or more per reply — long enough
            that a spoken conversation stops feeling like one. Set <code>ANTHROPIC_API_KEY</code> or{' '}
            <code>GEMINI_API_KEY</code> in <code>.env</code> for voice to work properly. Typing still
            works fine.
          </div>
        </div>
      )}

      {!supported.stt && (
        <div className="panel" style={{ borderColor: 'var(--warn)', padding: 12, marginBottom: 12 }}>
          <strong style={{ color: 'var(--warn)' }}>Speech input unavailable in this browser.</strong>
          <div className="item-meta" style={{ marginTop: 4 }}>
            The Web Speech API needs Chrome or Edge. You can still type, and replies can still be
            read aloud if your browser supports synthesis.
          </div>
        </div>
      )}

      {speechError && (
        <div className="panel" style={{ borderColor: 'var(--danger)', padding: 12, marginBottom: 12 }}>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--danger)', fontSize: 13 }}>{speechError}</span>
            <button className="ghost" onClick={clearError}>Dismiss</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <label>Voice</label>
          <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
            ))}
          </select>
          <div className="row-flex" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => speech.speak(
              'This is how replies will sound in voice mode.'
            )}>Test voice</button>
          </div>
        </div>
      )}

      {/* The only thing that scrolls. Newest first. */}
      <div className="chat-messages" ref={scrollRef}>
        {thinking && (
          <div className="chat-msg assistant" style={{ color: 'var(--text-faint)' }}>
            Thinking…
          </div>
        )}
        {messages.length === 0 && !thinking && (
          <div className="empty">
            Press the microphone and start talking. In Intake mode it mostly listens and asks what
            else — good for emptying your head at the end of a day.
          </div>
        )}
        {[...messages].reverse().map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>

      <RouteModal
        open={routeOpen}
        source="conversation"
        onClose={() => setRouteOpen(false)}
        onFiled={(r) => setToast(filedToast(r))}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Advances the unread-replies cursor the sidebar reads — never backwards. */
function markSeen(id) {
  if (!id) return;
  const current = Number(localStorage.getItem('pos_last_seen_message_id')) || 0;
  if (id > current) localStorage.setItem('pos_last_seen_message_id', String(id));
}

/** Say where things actually went, not just how many. */
function filedToast(result) {
  const written = result?.written || [];
  if (!written.length) return 'Nothing filed.';
  const names = {
    task: 'task', commitment: 'commitment', project: 'project', idea: 'idea',
    dependency: 'dependency', knowledge: 'knowledge note',
    open_question: 'open question', decision: 'decision',
    health_signal: 'health signal', unclear: 'left in inbox',
  };
  const counts = {};
  for (const w of written) counts[w.destination] = (counts[w.destination] || 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) =>
    k === 'unclear' ? `${n} left in inbox` : `${n} ${names[k]}${n === 1 ? '' : 's'}`);
  return `Filed ${written.length}: ${parts.join(', ')}.`;
}
