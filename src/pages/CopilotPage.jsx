import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSpeech } from '../lib/useSpeech.js';
import CaptureModal from '../components/CaptureModal.jsx';

/**
 * Voice-first conversation. Shares the chat_messages table with the Chat page
 * deliberately — one conversation thread, two input modalities. Anything you
 * say here is visible when you type there, and both feed Capture.
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
  const [captureOpen, setCaptureOpen] = useState(false);
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
    api.chat.messages().then(setMessages).catch(console.error);
    api.config().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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

  return (
    <div className="chat">
      <div className="page-header">
        <h1>Copilot</h1>
        <p>
          Talk instead of typing. Same conversation as the Chat page — say it here, it's there.
        </p>
      </div>

      {/* Mode selector */}
      <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
        <div className="segmented">
          {(config?.modes || []).map((m) => (
            <button
              key={m.key}
              className={'seg' + (mode === m.key ? ' active' : '')}
              onClick={() => setMode(m.key)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="item-meta" style={{ marginTop: 8 }}>
          {config?.modes?.find((m) => m.key === mode)?.hint}
        </div>
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

      {/* Transcript */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            Press the microphone and start talking. In Intake mode it mostly listens and asks what
            else — good for emptying your head at the end of a day.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {interim && (
          <div className="chat-msg user" style={{ opacity: 0.55, fontStyle: 'italic' }}>
            {interim}
          </div>
        )}
        {thinking && (
          <div className="chat-msg assistant" style={{ color: 'var(--text-faint)' }}>
            Thinking…
          </div>
        )}
      </div>

      {/* Voice controls */}
      <div className="voice-bar">
        <button
          className={'mic' + (listening ? ' listening' : '') + (speaking ? ' speaking' : '')}
          onClick={toggleMic}
          disabled={!supported.stt}
          title={listening ? 'Stop listening' : 'Start listening'}
        >
          {listening ? '■' : '●'}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {speaking ? 'Speaking…' : listening ? 'Listening — pause to send' : 'Microphone off'}
          </div>
          <div className="item-meta">
            {listening
              ? 'Stops automatically after a few seconds of silence.'
              : supported.stt ? 'Press to talk. Nothing is recorded to disk.' : 'Type below instead.'}
          </div>
        </div>

        {speaking && <button className="ghost" onClick={cancelSpeech}>Stop speaking</button>}
        <button className="ghost" onClick={() => setVoiceReplies((v) => !v)}
          title="Read replies aloud">
          {voiceReplies ? 'Voice on' : 'Voice off'}
        </button>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>Voice…</button>
        <button className="ghost" onClick={() => setCaptureOpen(true)} disabled={messages.length === 0}>
          Capture
        </button>
      </div>

      {showSettings && (
        <div className="panel" style={{ padding: 12, marginTop: 8 }}>
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

      {/* Typing still available */}
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

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={(n) => setToast(`Saved ${n} item${n === 1 ? '' : 's'}.`)}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
