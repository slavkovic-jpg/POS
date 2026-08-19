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
import { listTasks, allTasks, getTask, addTask, updateTask, deleteTask, procrastinationCandidates, taskStats } from './tasks.mjs';
import { getContext, setContext } from './context-state.mjs';
import { unpackThoughts, acceptTasks, breakdownTask, listSubtasks, toggleSubtask, recommendNext } from './task-ai.mjs';
import { getOrCreateTodayBriefing, updateBriefing } from './briefing.mjs';
import { getProfile, updateProfile, completeOnboarding, analyzeCv, acceptHypotheses } from './onboarding.mjs';
import { listReviews, getReview, startReview, updateReview, generateReview, gatherActivity } from './review.mjs';
import { captureFromConversation } from './capture.mjs';

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Chat ------------------------------------------------------------------
app.get('/api/chat/messages', (_req, res) => res.json(recentMessages(100)));
app.post('/api/chat/capture', async (req, res) => {
  try {
    const limit = Math.max(2, Math.min(50, Number(req.body?.limit) || 20));
    const result = await captureFromConversation({ limit });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/chat/send', async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  try {
    saveMessage('user', text);
    const reply = await respond(text);
    const meta = { intent: reply.intent };
    if (reply.model) meta.model = reply.model;
    if (reply.usage) meta.usage = reply.usage;
    if (reply.stop_reason) meta.stop_reason = reply.stop_reason;
    if (reply.error) meta.error = reply.error;
    const stored = saveMessage('assistant', reply.text, meta);
    res.json({ user_text: text, assistant: stored, intent: reply.intent });
  } catch (err) {
    console.error('[chat] send failed:', err);
    res.status(500).json({ error: err.message });
  }
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
// NOTE: literal-path routes must precede '/:id' routes, or Express matches
// '/api/tasks/stats' as id="stats".
app.get('/api/tasks', (req, res) =>
  res.json(req.query.all === 'true'
    ? allTasks()
    : listTasks({ status: req.query.status, domain_key: req.query.domain_key })));
app.get('/api/tasks/stats', (_req, res) => res.json(taskStats()));
app.get('/api/tasks/procrastination', (_req, res) => res.json(procrastinationCandidates()));
app.post('/api/tasks', (req, res) => res.json(addTask(req.body || {})));

// Brain dump -> structured task candidates (non-mutating; review then accept)
app.post('/api/tasks/unpack', async (req, res) => {
  try {
    res.json(await unpackThoughts(req.body?.text));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/tasks/accept', (req, res) => {
  const { tasks } = req.body || {};
  if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks array required' });
  res.json({ saved: acceptTasks(tasks) });
});

// Decision engine — the single best next action given current conditions
app.get('/api/tasks/recommend', async (_req, res) => {
  try {
    res.json(await recommendNext());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  const t = getTask(+req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ ...t, subtasks: listSubtasks(t.id) });
});
app.patch('/api/tasks/:id', (req, res) => res.json(updateTask(+req.params.id, req.body || {})));
app.delete('/api/tasks/:id', (req, res) => { deleteTask(+req.params.id); res.json({ ok: true }); });

// Break a task into low-friction micro-steps
app.post('/api/tasks/:id/breakdown', async (req, res) => {
  try {
    res.json(await breakdownTask(+req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/tasks/:id/subtasks', (req, res) => res.json(listSubtasks(+req.params.id)));
app.post('/api/subtasks/:id/toggle', (req, res) => {
  try {
    res.json(toggleSubtask(+req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ---- Current conditions ----------------------------------------------------
app.get('/api/context', (_req, res) => res.json(getContext()));
app.patch('/api/context', (req, res) => {
  try {
    res.json(setContext(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Briefing --------------------------------------------------------------
app.get('/api/briefing/today', (_req, res) => res.json(getOrCreateTodayBriefing()));
app.patch('/api/briefing/today', (req, res) => res.json(updateBriefing(req.body || {})));

// ---- Onboarding ------------------------------------------------------------
app.get('/api/onboarding/profile', (_req, res) => res.json(getProfile()));
app.patch('/api/onboarding/profile', (req, res) => res.json(updateProfile(req.body || {})));
app.post('/api/onboarding/analyze', async (req, res) => {
  try {
    const { cv_text } = req.body || {};
    const result = await analyzeCv(cv_text);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/onboarding/accept', (req, res) => {
  const { hypotheses } = req.body || {};
  if (!Array.isArray(hypotheses)) return res.status(400).json({ error: 'hypotheses array required' });
  res.json({ saved: acceptHypotheses(hypotheses) });
});
app.post('/api/onboarding/complete', (_req, res) => res.json(completeOnboarding()));

// ---- Reviews ---------------------------------------------------------------
app.get('/api/reviews', (req, res) => res.json(listReviews(req.query.kind)));
app.get('/api/reviews/:id', (req, res) => {
  const r = getReview(+req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});
app.post('/api/reviews', (req, res) => {
  try {
    res.json(startReview(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.patch('/api/reviews/:id', (req, res) => res.json(updateReview(+req.params.id, req.body || {})));
app.post('/api/reviews/:id/generate', async (req, res) => {
  try {
    const result = await generateReview(+req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/reviews/:id/activity', (req, res) => {
  const r = getReview(+req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(gatherActivity(r.period_start, r.period_end));
});

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
