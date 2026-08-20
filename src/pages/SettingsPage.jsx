import React, { useEffect, useState } from 'react';
import {
  Settings, CheckCircle2, XCircle, MinusCircle, RefreshCw,
  AlertTriangle, Zap, Server, ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Callout } from '../components/ui.jsx';

const LABELS = {
  claude: { name: 'Claude (Anthropic)', env: 'ANTHROPIC_API_KEY', note: 'Best quality. Paid.' },
  gemini: { name: 'Google Gemini',      env: 'GEMINI_API_KEY',    note: 'Fast. Free tier is unavailable in some countries.' },
  hosted: { name: 'Hosted provider',    env: 'OPENAI_COMPAT_*',   note: 'Groq, Cerebras, OpenRouter, GitHub Models — several are free.' },
  ollama: { name: 'Ollama (local)',     env: 'OLLAMA_MODEL',      note: 'Private and offline. CPU-only here, so slow.' },
};

/**
 * Backend diagnostics. Exists because "the key is set" and "the key works"
 * are different claims, and only a real request can tell them apart.
 */
export default function SettingsPage() {
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.config().then(setConfig).catch((e) => setError(e.message)); }, []);

  async function runTest() {
    setTesting(true); setError(null); setResult(null);
    try { setResult(await api.testBackends()); }
    catch (err) { setError(err.message); }
    finally { setTesting(false); }
  }

  return (
    <div>
      <div className="page-header">
        <h1><Settings size={22} style={{ color: 'var(--accent)' }} />Settings</h1>
        <p>
          Which language model backends are configured, and whether they actually work. Keys live in{' '}
          <code>.env</code> on the server and are never sent to the browser.
        </p>
      </div>

      <div className="panel hero">
        <div className="section-head">
          <h2><Server size={15} />Backends</h2>
          <button onClick={runTest} disabled={testing}>
            <RefreshCw size={13} className={testing ? 'spin' : undefined} />
            {testing ? 'Testing…' : 'Test connections'}
          </button>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
          Each test makes one real request. Ollama is only checked for reachability and whether
          your configured model is pulled — a generation ping would take minutes on CPU.
        </p>

        {error && <Callout tone="danger" icon={AlertTriangle} title="Test failed">{error}</Callout>}

        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {['claude', 'gemini', 'hosted', 'ollama'].map((key) => {
            const cfg = config?.backends?.[key];
            const res = result?.[key];
            return <BackendRow key={key} id={key} cfg={cfg} res={res} />;
          })}
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            {result.fast_working ? (
              <Callout tone="ok" icon={CheckCircle2} title="Voice mode will work">
                A fast backend is responding, so spoken conversation will feel like a conversation.
              </Callout>
            ) : result.any_working ? (
              <Callout tone="warn" icon={AlertTriangle} title="Voice mode will be too slow">
                Only a local model is working. Replies take a minute or more, which is too long to
                hold a spoken exchange. Typing works fine.
              </Callout>
            ) : (
              <Callout tone="danger" icon={XCircle} title="No backend is working">
                The app falls back to a small scripted responder. Set a key in <code>.env</code> and
                restart the server.
              </Callout>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2><Zap size={15} />How the fallback chain works</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Every request tries backends in order and returns the first that succeeds:
        </p>
        <div className="row-flex" style={{ flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 12.5 }}>
          <span className="badge ok">Claude</span><span style={{ color: 'var(--text-faint)' }}>→</span>
          <span className="badge exploring">Gemini</span><span style={{ color: 'var(--text-faint)' }}>→</span>
          <span className="badge exploring">Hosted</span><span style={{ color: 'var(--text-faint)' }}>→</span>
          <span className="badge awaiting">Ollama</span><span style={{ color: 'var(--text-faint)' }}>→</span>
          <span className="badge">scripted stub</span>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 14, marginBottom: 0 }}>
          A backend that is not configured is skipped silently. One that errors is logged and the
          chain continues, so a bad key degrades the app rather than breaking it. Web research needs
          Claude or Gemini specifically — a local model has no web access, and answering from
          training data would look like research without being it.
        </p>
      </div>

      <FreeProviders />

      <div className="panel">
        <h2>Editing configuration</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Keys are read from <code>.env</code> at startup and are intentionally not editable from
          the browser — that was one of the things worth changing about the prototype this app
          borrowed from, which kept its key in browser storage where any script on the page could
          read it.
        </p>
        <pre style={{
          background: 'var(--bg-inset)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: 14, fontSize: 12.5,
          fontFamily: 'var(--mono)', overflowX: 'auto', color: 'var(--text-dim)', margin: 0,
        }}>{`# .env  (restart the server after editing)
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# optional
POS_MODEL=claude-opus-4-8
GEMINI_MODEL=gemini-3-flash-preview
OLLAMA_MODEL=hermes3:latest`}</pre>
      </div>
    </div>
  );
}

/**
 * Free options, listed with the exact values to paste. Included because "use a
 * hosted provider" is useless advice without knowing which ones cost nothing.
 */
function FreeProviders() {
  const [providers, setProviders] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/config/providers').then((r) => r.json()).then(setProviders).catch(() => {});
  }, []);

  if (!providers.length) return null;

  return (
    <div className="panel">
      <div className="section-head">
        <h2><Zap size={15} />Free options</h2>
        <button className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show setup'}
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        This machine has no CUDA GPU, so local inference runs on the CPU at a few tokens per
        second. Each of these is far faster and costs nothing at personal volumes. Pick one, put
        three lines in <code>.env</code>, restart, then press Test connections above.
      </p>

      {open && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {providers.map((p) => (
            <div key={p.id} style={{
              background: 'var(--bg-inset)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '13px 15px',
            }}>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <strong>{p.name}</strong>
                <a href={p.signup} target="_blank" rel="noreferrer" className="badge exploring">
                  Get a key <ExternalLink size={9} />
                </a>
              </div>
              <div className="item-meta" style={{ marginTop: 4 }}>{p.note}</div>
              <pre style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 6, padding: 10, fontSize: 11.5, marginTop: 9,
                fontFamily: 'var(--mono)', overflowX: 'auto', color: 'var(--text-dim)',
              }}>{`OPENAI_COMPAT_BASE_URL=${p.base_url}
OPENAI_COMPAT_API_KEY=<your key>
OPENAI_COMPAT_MODEL=${p.example_model}
OPENAI_COMPAT_LABEL=${p.name}`}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackendRow({ id, cfg, res }) {
  const meta = LABELS[id];
  const state = !cfg?.configured ? 'unset' : res ? (res.ok ? 'ok' : 'fail') : 'unknown';
  const Icon = { ok: CheckCircle2, fail: XCircle, unset: MinusCircle, unknown: MinusCircle }[state];
  const color = { ok: 'var(--success)', fail: 'var(--danger)', unset: 'var(--text-faint)', unknown: 'var(--text-faint)' }[state];

  return (
    <div style={{
      background: 'var(--bg-inset)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '13px 15px',
    }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div className="row-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon size={17} style={{ color, marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 570 }}>{meta.name}</div>
            <div className="item-meta">{meta.note}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {state === 'unset' && <span className="badge">not configured</span>}
          {state === 'unknown' && <span className="badge">configured, untested</span>}
          {state === 'ok' && <span className="badge ok">working · {res.ms}ms</span>}
          {state === 'fail' && <span className="badge danger">failed</span>}
          {cfg?.model && <div className="item-meta" style={{ marginTop: 4, fontFamily: 'var(--mono)' }}>{cfg.model}</div>}
        </div>
      </div>

      {state === 'unset' && (
        <div className="item-meta" style={{ marginTop: 9 }}>
          Set <code>{meta.env}</code> in <code>.env</code> and restart the server.
        </div>
      )}
      {state === 'ok' && res.reply && (
        <div className="item-meta" style={{ marginTop: 9, fontFamily: 'var(--mono)' }}>
          replied: “{res.reply}”
        </div>
      )}
      {state === 'ok' && res.warning && (
        <div className="item-meta" style={{ marginTop: 9, color: 'var(--warn)' }}>{res.warning}</div>
      )}
      {state === 'fail' && (
        <div style={{
          marginTop: 10, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--danger)',
          background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.25)',
          borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{res.error}</div>
      )}
    </div>
  );
}
