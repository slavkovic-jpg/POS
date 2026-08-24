import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useHashFlash } from '../lib/useHashFlash.js';

export default function OpenQuestionsPage() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [importance, setImportance] = useState(3);
  const [reviewDate, setReviewDate] = useState('');

  async function refresh() { setItems(await api.questions.list()); }
  useEffect(() => { refresh().finally(() => setLoaded(true)); }, []);
  useHashFlash(loaded);

  async function add() {
    if (!q.trim()) return;
    await api.questions.add({ question: q, strategic_importance: importance, review_date: reviewDate || null });
    setQ(''); setReviewDate('');
    refresh();
  }
  async function resolve(id) {
    const resolution = prompt('How is this resolved?') || '';
    if (!resolution) return;
    await api.questions.resolve(id, resolution);
    refresh();
  }
  async function setStatus(id, status) { await api.questions.update(id, { status }); refresh(); }

  return (
    <div>
      <div className="page-header">
        <h1>Open questions</h1>
        <p>Unresolved strategic questions the system will not let you forget. Each carries importance and a review date.</p>
      </div>

      <div className="panel">
        <h2>Capture</h2>
        <div className="row-flex" style={{ alignItems: 'stretch' }}>
          <div style={{ flex: 4 }}>
            <label>Question</label>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Should we pursue AI consulting?" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Importance</label>
            <select value={importance} onChange={(e) => setImportance(+e.target.value)}>
              {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Review date</label>
            <input type="text" placeholder="YYYY-MM-DD" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button onClick={add}>Log</button></div>
        </div>
      </div>

      <div className="panel">
        <h2>Awaiting resolution</h2>
        {items.length === 0 ? <div className="empty">Nothing open — nice.</div> : (
          <ul className="item-list">
            {items.map((it) => (
              <li key={it.id} id={`question-${it.id}`}>
                <div>
                  <div className="item-title">{it.question}</div>
                  <div className="item-meta">
                    <span className={`badge ${it.status}`}>{it.status}</span>
                    <span> · importance {it.strategic_importance}</span>
                    {it.review_date && <span> · review {it.review_date}</span>}
                  </div>
                </div>
                <div className="item-actions">
                  {it.status === 'awaiting' && <button className="ghost" onClick={() => setStatus(it.id, 'exploring')}>Explore</button>}
                  <button onClick={() => resolve(it.id)}>Resolve</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
