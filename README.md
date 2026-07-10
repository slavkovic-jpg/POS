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
  server.mjs         entry
  db.mjs             SQLite handle
  migrations.mjs     schema
  chat.mjs           conversation (stubbed responder)
  strategy.mjs       mission / values / life domains
  knowledge.mjs      personal knowledge model
  memory.mjs         6 memory layers
  open-questions.mjs unresolved strategic questions
  decisions.mjs      decision journal
  briefing.mjs       morning briefing + confidence engine
  review.mjs         weekly + monthly reviews
  tasks.mjs          task intelligence (scored, not just checkboxes)
src/
  pages/       Chat, Onboarding, Strategy, Knowledge, Briefing, Decisions, Review
  components/  ConfidenceBar, BriefingProgress, OpenQuestionsList, ...
  lib/api.js   frontend fetch client
data/          SQLite lives here (gitignored)
```

## Design principles

1. Conversation is the primary interface. Tasks, projects, and goals are outputs of understanding.
2. Confidence over completion. Every plan has a confidence score; the system asks only questions that raise it.
3. The system recommends. The user decides. Strategic changes require explicit approval.
4. Sustainable success over maximum throughput. Burnout signals throttle recommendations.

## Roadmap (v0 → v1)

- [x] Skeleton: server, DB schema, chat page, stubbed responder
- [ ] Foundational onboarding flow (CV / bio / goals ingest)
- [ ] Discovery mode (identity / values / current reality)
- [ ] Strategy scaffold CRUD UI
- [ ] Morning briefing with confidence bar + stage tracker
- [ ] Weekly CEO review + monthly strategic review
- [ ] Decision journal + follow-up scheduling
- [ ] Swap stub responder for Claude API
- [ ] Health integrations (Apple Watch / Garmin)
- [ ] Voice capture (Siri / Google)
