import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrations.mjs';
import { respond, saveMessage, recentMessages } from './chat.mjs';
import { getStrategy, updateStrategy, updateDomain } from './strategy.mjs';
import { listKnowledge, addKnowledge, updateKnowledge, deleteKnowledge } from './knowledge.mjs';
import { listOpenQuestions, addOpenQuestion, updateOpenQuestion, resolveOpenQuestion } from './open-questions.mjs';
import { listDecisions, addDecision, reviewDecision } from './decisions.mjs';
import { listTasks, addTask, updateTask, procrastinationCandidates } from './tasks.mjs';
import { getOrCreateTodayBriefing, updateBriefing } from './briefing.mjs';

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Chat ------------------------------------------------------------------
app.get('/api/chat/messages', (_req, res) => res.json(recentMessages(100)));
app.post('/api/chat/send', (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  saveMessage('user', text);
  const reply = respond(text);
  const stored = saveMessage('assistant', reply.text, { intent: reply.intent });
  res.json({ user_text: text, assistant: stored, intent: reply.intent });
});

// ---- Strategy --------------------------------------------------------------
app.get('/api/strategy', (_req, res) => res.json(getStrategy()));
app.patch('/api/strategy', (req, res) => res.json(updateStrategy(req.body || {})));
app.patch('/api/strategy/domains/:key', (req, res) =>
  res.json(updateDomain(req.params.key, req.body || {}))
);

// ---- Knowledge -------------------------------------------------------------
app.get('/api/knowledge', (req, res) => res.json(listKnowledge(req.query.category)));
app.post('/api/knowledge', (req, res) => res.json(addKnowledge(req.body || {})));
app.patch('/api/knowledge/:id', (req, res) => res.json(updateKnowledge(+req.params.id, req.body || {})));
app.delete('/api/knowledge/:id', (req, res) => { deleteKnowledge(+req.params.id); res.json({ ok: true }); });

// ---- Open Questions --------------------------------------------------------
app.get('/api/open-questions', (req, res) => res.json(listOpenQuestions(req.query.status)));
app.post('/api/open-questions', (req, res) => res.json(addOpenQuestion(req.body || {})));
app.patch('/api/open-questions/:id', (req, res) => res.json(updateOpenQuestion(+req.params.id, req.body || {})));
app.post('/api/open-questions/:id/resolve', (req, res) =>
  res.json(resolveOpenQuestion(+req.params.id, req.body?.resolution || ''))
);

// ---- Decisions -------------------------------------------------------------
app.get('/api/decisions', (_req, res) => res.json(listDecisions()));
app.post('/api/decisions', (req, res) => res.json(addDecision(req.body || {})));
app.post('/api/decisions/:id/review', (req, res) => res.json(reviewDecision(+req.params.id, req.body || {})));

// ---- Tasks -----------------------------------------------------------------
app.get('/api/tasks', (req, res) => res.json(listTasks({ status: req.query.status })));
app.post('/api/tasks', (req, res) => res.json(addTask(req.body || {})));
app.patch('/api/tasks/:id', (req, res) => res.json(updateTask(+req.params.id, req.body || {})));
app.get('/api/tasks/procrastination', (_req, res) => res.json(procrastinationCandidates()));

// ---- Briefing --------------------------------------------------------------
app.get('/api/briefing/today', (_req, res) => res.json(getOrCreateTodayBriefing()));
app.patch('/api/briefing/today', (req, res) => res.json(updateBriefing(req.body || {})));

// ---- Static (built SPA) ----------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const hasDist = fs.existsSync(path.join(DIST, 'index.html'));

if (hasDist) {
  app.use(express.static(DIST));
  // SPA fallback for non-/api routes
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  // Dev hint if someone hits the API server root without a built bundle
  app.get('/', (_req, res) => {
    res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Personal OS – API</title>
       <body style="font-family:system-ui;max-width:640px;margin:60px auto;color:#222;line-height:1.5">
         <h1 style="margin:0 0 8px">Personal OS API</h1>
         <p style="color:#666;margin:0 0 20px">You're hitting the API server, not the web UI.</p>
         <ul>
           <li>In dev: open <a href="http://localhost:5173">http://localhost:5173</a> (Vite proxies <code>/api</code> here).</li>
           <li>For a single-URL prod build: <code>npm run build</code>, then <code>npm start</code> and open <a href="/">this URL</a>.</li>
           <li>Health check: <a href="/api/health">/api/health</a></li>
         </ul>
       </body>`
    );
  });
}

// ---- Fallback --------------------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

const PORT = process.env.PORT || 5185;
app.listen(PORT, () => {
  console.log(`[pos] server listening on http://localhost:${PORT}`);
  console.log(hasDist
    ? `[pos] serving built UI from ${DIST}`
    : `[pos] dev mode — open http://localhost:5173 for the web UI (run "npm run dev")`);
});
