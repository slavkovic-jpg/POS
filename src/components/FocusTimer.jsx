import React, { useEffect, useRef, useState } from 'react';

/**
 * Focus block. Counts down from the task's own estimate rather than a fixed
 * pomodoro, so the timer reflects what the task actually needs.
 */
export default function FocusTimer({ task, onClose, onComplete }) {
  const total = Math.max(60, (task.time_minutes || 15) * 60);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(true);
  const [finished, setFinished] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!running || finished) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          setFinished(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, finished]);

  // Escape closes; space toggles pause.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' && !finished) { e.preventDefault(); setRunning((r) => !r); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, finished]);

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const pct = ((total - remaining) / total) * 100;
  const elapsedMin = Math.round((Date.now() - startedAt.current) / 60000);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body" style={{ padding: 28 }}>
          {task.domain_key && <span className="badge">{task.domain_key}</span>}
          <h2 style={{ margin: '12px 0 20px', fontSize: 17 }}>{task.title}</h2>

          <div style={{
            fontFamily: 'var(--mono)',
            fontSize: 56,
            fontWeight: 700,
            color: finished ? 'var(--success)' : 'var(--accent-strong)',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '20px 0',
            letterSpacing: '0.04em',
          }}>
            {mins}:{secs}
          </div>

          <div className="confidence-bar-track" style={{ marginTop: 14 }}>
            <div className="confidence-bar-fill" style={{ width: `${pct}%` }} />
          </div>

          {finished ? (
            <p style={{ color: 'var(--success)', marginTop: 18, fontSize: 14 }}>
              Block complete. Stand up and look at something far away before the next one.
            </p>
          ) : (
            <p className="item-meta" style={{ marginTop: 14 }}>
              Space to {running ? 'pause' : 'resume'} · Esc to close. Closing does not lose the task.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button className="ghost" onClick={onClose}>
            {finished ? 'Close' : `Stop (${elapsedMin}m in)`}
          </button>
          <div className="row-flex">
            {!finished && (
              <button className="ghost" onClick={() => setRunning((r) => !r)}>
                {running ? 'Pause' : 'Resume'}
              </button>
            )}
            <button onClick={onComplete}>Mark done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
