# Personal Operating System (POS)

AI Chief of Staff, strategic advisor, decision engine, and life management platform.

> This is **not** a task manager. It exists to help you make consistently better decisions across career, health, learning, relationships, finances, and long-term goals — while protecting energy and preventing burnout.

## Stack

- Node.js + Express (API)
- SQLite via `better-sqlite3` (storage)
- React + Vite (web UI)
- LLM: **stubbed** in v0 — swap in Anthropic SDK later

## Quick start

```bash
npm install
npm run migrate    # creates ./data/pos.db
npm run dev        # server on :5185, web on :5173
```

Open http://localhost:5173.

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
