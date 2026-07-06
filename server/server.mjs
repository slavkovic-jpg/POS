import express from 'express';
import cors from 'cors';
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

// ---- Fallback --------------------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

const PORT = process.env.PORT || 5185;
app.listen(PORT, () => {
  console.log(`[pos] server listening on http://localhost:${PORT}`);
});
