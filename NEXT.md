# NEXT.md — where things stand

Durable rules, invariants and the session protocol live in **AGENTS.md**. This
file is only "what's going on right now". Keep it short and keep it current.

---

## Current state

**Capture routing is stable and load-bearing.** A dump splits into fragments,
each classified to a destination (task/commitment/project/idea/dependency/
knowledge/open_question/decision/health_signal/unclear) with the model running
in parallel with deterministic rules, shown on one review screen, written only
on explicit confirmation. It knows what already exists — open projects and
commitments go into the prompt as short references, so a fragment attaches to
the right project or updates an existing commitment instead of duplicating it.
"File this" turns a Copilot conversation into the same reviewed records. A free
Mistral tier makes this fast enough to be usable; Ollama sits behind it for
offline use. The load-bearing lessons from building this (object-rooted
schemas, no `description` on model-facing fields, reference-not-raw-id links,
salvaging a response that breaks mid-way) are in AGENTS.md, not here.

**Chat is gone — Copilot is the one conversation surface**, merged because
Chat had no capability Copilot lacked. Capture (the old 3-destination
extraction) is gone too, superseded entirely by File this. Copilot's layout is
static-top/scrolling-transcript, newest message first, with a tri-colour
Advisor/Intake/Coach switch.

**The sidebar and six pages (Dashboard, Tasks, Strategy, Commitments, Projects,
Inbox) carry live numbers** via `GET /api/nav-status` (polled, deliberately
lighter than `/api/dashboard`) and a sticky in-page `SectionTabs` bar per page —
a tab's badge is always the same number the sidebar shows for that page, never
a second opinion.

**Tasks are now editable** (`TaskForm`, matching the form `CommitmentForm`/
`ProjectForm` already had) and carry a new `scheduled_at` field — when it's
actually placed in the day, distinct from `due_date` the same way
`effort_remaining_minutes` is distinct from `time_minutes`.

**Briefing is a conversation now, not a checkbox form.** Talking to it
(`briefing_messages`, its own table — not `chat_messages`, so it can't leak
into File this) proposes stage completions and a structured plan; accepting
the plan is what writes `scheduled_at` onto the tasks in it. Verified live:
a two-turn conversation about two real tasks produced a plan with correct
9am/11am time guesses, and accepting it actually scheduled both.

**A Guide widget lives on the Dashboard** — small, persistent, grounded in
`dashboardSummary()`/`navStatus()`/`recommendNext()`. It phrases; it never
computes its own ranking. Verified: asked "what should I do now," it gave the
exact same task and reasoning `/api/tasks/recommend` returns — not a second
opinion. Went through two real rounds of tuning after live use:
1) it needed richer grounding to be worth talking to — actual open-question
   text, which strategy fields and which specific life domains are missing,
   an ordered "what's actually incomplete" list — plus a prompt telling it the
   conversation is stateful (don't repeat an earlier answer, advance when
   asked to be walked through things one at a time);
2) its "never decide" rule, meant only for the ranking engine, had no scope
   on it, so it generalised into refusing to help write a strategy field at
   all — "I can't decide what to write for you," verbatim, three turns
   running, even to "give an example." Fixed by explicitly naming two
   separate jobs in `GUIDE_SYSTEM` (wayfinding vs. helping the user think or
   write) and scoping the hard rule to the first one only. AGENTS.md
   invariant 23 generalises the lesson: an unscoped "never X" reliably gets
   over-applied by a capable model.

**A zoomable calendar** (`Timeline.jsx`, one component, `scope` prop) is
embedded on Dashboard (`scope="all"`), Tasks (`scope="tasks"`), and
Commitments (`scope="commitments"`). Quarter → month → week (default) → day,
the last being an hour grid for scheduled tasks with an unscheduled-today tray
above it (click "Schedule" to place one). Every event links to its source row
via `/page#anchor-id`, using a new shared `useHashFlash()` hook that replaced
`StrategyPage`'s one-off version of the same scroll-and-flash behavior.
`GET /api/calendar?from=&to=` (`server/calendar.mjs`) is the one feed
everything reads — tasks, commitments, projects, decisions, open questions,
dependencies, health signals, normalized and toned (overdue/at-risk → danger,
due today → warn) from data the app already has, nothing new invented.

Reworked after live feedback: docked full-width at the top of the page rather
than a permanently full-width sticky bar; once the page scrolls past its own
height it shrinks into a translucent ~40%-width corner widget (full opacity on
hover) instead of sitting in document flow, so it no longer competes with
`SectionTabs`. The float threshold is measured from the element's own docked
height, not a guessed pixel value — a guessed one left it floating while
`SectionTabs` hadn't yet reflowed into the space that freed up, and the two
visibly overlapped. `SectionTabs` also sits above it in z-index as a backstop,
so the tabs stay clickable even in a residual edge case on a very short page.

---

**FTS5 retrieval landed for `buildSystemPrompt()`.** `knowledge_fts`
(`server/migrations.mjs`) is an external-content FTS5 table over `knowledge`,
kept in sync by insert/update/delete triggers, with a one-time `rebuild` on
migrate for rows that predate the index (ran clean against the real dev DB:
44 existing rows backfilled). `searchKnowledge()` (`server/knowledge.mjs`)
turns free text into a safe quoted-OR MATCH query and ranks by `rank`.
`buildSystemPrompt()` now takes a `question` option — all four responders in
`chat.mjs` pass the user's current message — and uses it to retrieve instead
of dumping `listKnowledge()` whole; without a question (or no matches) it
falls back to the highest-confidence rows, capped at 20 either way, so prompt
size no longer tracks table size. Verified with `test/knowledge-fts.test.mjs`:
a matching question surfaces the relevant row and excludes an unrelated one,
and 200 filler rows added between two prompt builds change prompt length by
under 200 characters.

---

## Next task — Bring the six remaining pages up to the current visual standard

Knowledge, Open Questions, Decisions, Reviews, Briefing, Onboarding still need
the visual pass the other six pages already got.

---

## Queue — after that, in order

1. **Dedicated Ideas and Dependencies pages.**
2. **Google Tasks capture, direct from POS.** Cutover order is load-bearing —
   see below.
3. **Phone access**: Tailscale + PWA manifest and service worker.
4. **Orchestrator + specialist agents.** Newly viable now that a fast backend
   exists.
5. **Fix `README.md`** — still claims the Ollama default is `hermes3:latest` and
   does not mention the hosted tier.
6. **Google Drive/Docs integration** — when POS recommends writing a document,
   scaffold it in Drive and keep it linked back to the task/decision that
   prompted it. A new integration surface (OAuth, an adopted-entity shape
   linking a doc to its source), not yet designed.

---

## Waiting on Milos

- **Decide what happens to `personal_os.tsx`** — the Canvas prototype, still
  untracked in the repo root.
- **Google OAuth consent screen: publish it** before queue item 2, or refresh
  tokens expire every 7 days.
- **Nothing is committed yet.** `AGENTS.md`, `NEXT.md`, `CLAUDE.md` and the whole
  routing layer are unstaged, pending your say-so.

## Waiting on the ExecAgent cutover

Queue item 3 cannot start until these happen **in this order**. ExecAgent marks
captured tasks `completed` and polls with `showCompleted: false`, so two pollers
is a race where the loser silently sees nothing.

1. `disableTaskCapture()` in ExecAgent (sets `TASKS_CAPTURE_ENABLED` off)
2. Run ExecAgent's `runBackup()`, import the resulting JSON into POS
3. Start POS's poller
4. Remove ExecAgent's `pollGoogleTasksJob` trigger
