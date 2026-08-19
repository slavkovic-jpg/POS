# Personal Operating System (POS)

AI Chief of Staff, strategic advisor, decision engine, and life management platform.

> This is **not** a task manager. It exists to help you make consistently better decisions across career, health, learning, relationships, finances, and long-term goals — while protecting energy and preventing burnout.

## Stack

- Node.js + Express (API)
- SQLite via built-in `node:sqlite` (storage — zero native deps)
- React + Vite (web UI)
- Conversation backend, in priority order: **Claude API** (`claude-opus-4-8`, adaptive thinking) → **local Ollama** (default `hermes3:latest`) → built-in stub responder. The chat endpoint tries them in that order and returns the first that succeeds.

## Quick start

```bash
npm install
cp .env.example .env      # then paste your ANTHROPIC_API_KEY (optional — stub runs without it)
npm run migrate           # creates ./data/pos.db
npm run dev               # server on :5185, web on :5173
```

Open http://localhost:5173.

### Enabling the conversation

Every turn assembles a system prompt from your strategy scaffold, personal knowledge model, and open questions, then sends the last 20 messages of history — so whichever backend answers, it sees who you are, what you've decided, and what's still unresolved.

**Claude (preferred)** — set `ANTHROPIC_API_KEY` in `.env`. Model defaults to `claude-opus-4-8`; override with `POS_MODEL=…`.

**Ollama (fallback while you don't have a key, or when the API is unreachable)** — install Ollama and pull any chat-capable model:
```
ollama pull hermes3        # or llama3.2, qwen2.5, mistral, etc.
```
The Ollama desktop app starts the daemon automatically. If you're running headless, `ollama serve`. Default model is `hermes3:latest`; override with `OLLAMA_HOST` / `OLLAMA_MODEL`, or disable with `OLLAMA_ENABLED=false`.

**Stub** — always available. Scripted heuristics; no LLM calls. Runs when both above are unavailable.

## Layout

```
server/       Express API + SQLite domain modules
  server.mjs         entry + routes
  db.mjs             SQLite handle
  migrations.mjs     schema (idempotent; safe to re-run)
  llm.mjs            shared one-shot LLM helper (Claude -> Ollama -> error)
  context.mjs        builds the chat system prompt from all state
  context-state.mjs  current conditions: energy + available time
  chat.mjs           conversation
  capture.mjs        chat -> open questions / decisions / knowledge
  strategy.mjs       mission / values / life domains
  knowledge.mjs      personal knowledge model
  open-questions.mjs unresolved strategic questions
  decisions.mjs      decision journal
  onboarding.mjs     profile + CV analysis
  briefing.mjs       morning briefing + stage tracker
  review.mjs         weekly + monthly reviews
  tasks.mjs          task CRUD, subtask rollups, cognitive-load stats
  task-ai.mjs        unpack / breakdown / decision engine
src/
  pages/       Chat, Briefing, Tasks, Strategy, Knowledge, OpenQuestions,
               Decisions, Reviews, Onboarding
  components/  ConfidenceBar, StageTracker, CaptureModal, UnpackModal, FocusTimer
  lib/api.js   frontend fetch client
data/          SQLite lives here (gitignored)
```

## The task loop

Tasks are scored on eight dimensions, not just checked off. Three LLM-backed
operations sit on top:

- **Unpack** — a messy brain dump becomes several scored tasks. Proposed only;
  nothing is written until you approve each one.
- **Break down** — a task you keep avoiding becomes 3–6 micro-steps, where the
  first is startable in under a minute. This is the procrastination
  intervention, not a planning nicety.
- **Decide** — given the energy you actually have and the minutes you actually
  have, one task is chosen, with the reasoning shown so you can disagree.

**Current conditions** (energy + available time) is the input that makes the
rest honest. A recommendation that doesn't fit the real window is the wrong
recommendation however important the work is — so the decision engine filters
on fit *before* importance, and when energy is `overwhelmed` it will choose
recovery and say so. Time and energy fit are enforced in code, not left to the
model: a pick that violates them is replaced by local scoring and flagged in
the UI.

## Design principles

1. Conversation is the primary interface. Tasks, projects, and goals are outputs of understanding.
2. Confidence over completion. Every plan has a confidence score; the system asks only questions that raise it.
3. The system recommends. The user decides. Strategic changes require explicit approval.
4. Sustainable success over maximum throughput. Burnout signals throttle recommendations.

## Roadmap (v0 → v1)

- [x] Skeleton: server, DB schema, chat page
- [x] Claude API wired in, with Ollama and stub fallbacks
- [x] Foundational onboarding (profile, CV analysis, hypothesis review, discovery)
- [x] Strategy scaffold CRUD UI
- [x] Weekly + monthly reviews drafted from real activity
- [x] Decision journal
- [x] Chat capture — conversation into structured records
- [x] Tasks: brain-dump unpack, breakdown, decision engine, focus timer
- [x] Current conditions (energy + available time) feeding every planning surface
- [ ] Briefing driven by the confidence engine rather than manual stage toggles
- [ ] Sunday cadence — surface open questions whose review date has arrived
- [ ] Health integrations (Apple Watch / Garmin) feeding energy automatically
- [ ] Voice capture (Siri / Google)
