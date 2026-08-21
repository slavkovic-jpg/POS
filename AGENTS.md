# AGENTS.md — Personal OS (POS)

Durable rules for anyone (human or AI) working in this repo. Read this before
touching anything. Current state and the next task live in **NEXT.md**, not here.

This file holds things that would be **lost if deleted** — constraints,
invariants, and decisions. It is deliberately not a changelog. Do not add
progress narrative, dates, commit hashes, or test counts to it.

---

## What this is

An AI Chief of Staff / strategic advisor / decision engine. **Not a task
manager.** Node/Express + `node:sqlite` + React/Vite, plain CSS design system.

It absorbed a second project, **ExecAgent** (`C:\Users\MilosSlavkovic\exec-agent`,
Apps Script + Sheets): its schema (inbox, projects, commitments, ideas,
dependencies, sessions, event_log), its deterministic ranking engine, and its
"OK Google → Google Tasks" voice capture path. ExecAgent is **still live** and
still polling until the Phase 2 cutover — see the race condition below.

---

## Architectural north star

**Prioritisation is arithmetic, not a model.** `server/scoring.mjs` decides what
to do next; a language model is only ever allowed to *phrase* the explanation.

This is the load-bearing decision in the app. It means ranking still works when
every backend is down, offline, rate-limited, or unaffordable — and it is the
only part of the system that can be genuinely tested. Evaluate every new idea
against one question: *does this keep the decision in deterministic code, or
does it quietly move judgment into a model?*

---

## Hard constraints — never violate

1. **`server/scoring.mjs` stays pure.** No database import, no network, no model
   import, no `Date.now()` outside an injected `now`. Every input arrives as an
   argument. Breaking this makes the one testable part of the app untestable and
   couples "what should I do next" to a backend being reachable.
2. **A model never computes a ranking, a score, or an ordering.** It phrases.
   If a feature seems to need model judgment in the ranking, that is a design
   error to fix in the weights, not in the prompt.
3. **Every suggestion carries at least one plain-language reason.** A ranking you
   cannot argue with is a ranking you cannot trust.
4. **No reason ever comments on the person.** It describes the work, the date, or
   who is waiting — never "you failed to", "you procrastinated", or the polite
   versions. `carriedForwardNote()` is the reference wording: describe the
   pattern, then *ask* what is going on; never assert a cause. Guarded by a test
   asserting against a forbidden-phrase list. **This is the rule most likely to
   erode**, because every individual softening sounds reasonable.
5. **Nothing captured is ever written without the user seeing it first.**
   The review gate is the product. It is now per *batch* rather than per item —
   `routeCapture()` proposes and touches no table, `commitRoutes()` is the only
   writer and only runs on what came back from the review screen — but "propose,
   then write on agreement" is the invariant, not the number of clicks.
   `unclear` routes to `inbox`, which is what `inbox` is for.
   **Auto-write was considered and declined**; see Open decisions.
6. **API keys live server-side in `.env` and are never sent to the browser.**
   Deliberately unlike the Canvas prototype this borrowed from, which kept its
   key in `localStorage` where any script on the page could read it.
7. **POS must never poll Google Tasks while ExecAgent still does.** ExecAgent
   marks each task `completed` after capture and polls with
   `showCompleted: false`. Two pollers is a race where the loser silently sees
   nothing. Cutover is a switch, never an overlap.
8. **The chat backend has no tools and is not getting any.** `respond()` is a
   text responder; it can describe a filing plan and cannot act on one — which
   it does, convincingly, and then nothing happens. That is deliberate: giving
   the conversation write access would put an unreviewed model on the write
   path. The bridge is `routeConversation()`, which extracts what an exchange
   actually settled and sends it to the same review screen as everything else.
   Do not solve "the assistant can't file things" by giving the assistant tools.

9. **No autonomous action on the user's behalf.** The app advises and ranks; a
   human decides.

---

## Silent-wrongness invariants

**These matter more than anything else in this file.** Getting one wrong
produces a *plausible wrong answer*, not a crash or a red test — so it will not
be caught by running the code. Each one below has already happened.

1. **`WRITABLE_TASK_FIELDS` (`server/tasks.mjs`) is the single source for both
   INSERT and UPDATE.** A hand-maintained INSERT column list drifted and silently
   dropped four columns — including `effort_remaining_minutes` and
   `income_impact`. An 18-hour job due tomorrow scored **7 and ranked last**,
   behind a 10-minute walk, and the API returned `200`. Adding a task column
   means adding it to that one list. Guarded by a round-trip test that fails if
   the list grows without the test growing.

2. **`effort_remaining_minutes` and `time_minutes` are different quantities.**
   `time_minutes` is one sitting; `effort_remaining_minutes` is total work left
   across sessions. Slack is computed from effort remaining. Feed the wrong one
   and a three-day build looks like a thirty-minute errand, with no error.

3. **Slack bands are relative to the size of the job, never absolute hours.**
   Five spare hours is luxurious for a twenty-minute errand and nothing at all
   for a three-day build. An absolute threshold called both "tight".

4. **`hoursLeftInDay()` exists so that anything due today has real capacity.**
   Without it, a task due today has zero capacity and gets declared
   undeliverable at nine in the morning.

5. **Tier 0 / `incomeAtRisk` must span BOTH `tasks` and `commitments`.** An
   obligation is an obligation whether it was recorded as a commitment or
   captured as a task marked `contracted`. Reading only `commitments` let a
   contracted task be undeliverable while the app cheerfully suggested a hobby.

6. **`satisfaction` on `tasks` IS fulfilment.** It is not a spare column and
   there is no separate `fulfilment` field. Reuse before adding.

7. **Two importance scales coexist and one is inverted.** POS
   `strategic_importance` is 1–5 with **1 = highest**; ExecAgent's lineage uses
   `high`/`medium`/`low` labels. `rankToLabel()` is the only bridge. Anything
   comparing them numerically without it silently ranks backwards.

8. **Never ask a model for a numeric scale.** A model told "1–5 where 1 is
   highest" will invert it, confidently and silently. Every model-facing schema
   in `server/schemas.mjs` uses a **label enum**, mapped to numbers server-side.
   This was caught only by noticing the most consequential item ranked last.

9. **Ollama's `format` parameter (a JSON Schema) constrains the sampler — the
   prompt does not.** Unconstrained, the model returns *valid JSON with invented
   field names* (`{"task": …}` instead of `{"title": …}`) and every scoring field
   missing. The sanitizer then discards it and you get the raw-text fallback,
   which reads as "the local model is unreliable" when the plumbing was the
   problem. Every extraction passes a schema.

10. **`num_ctx` must be set explicitly.** Ollama's default context is far smaller
    than most models support, and on overflow it silently drops the **oldest**
    tokens — which is the system prompt. That looks exactly like "the model
    ignored its instructions". Also set `temperature: 0` for extraction, or the
    same input scores differently on each run.

11. **Format contagion: a model imitates the assistant turns already in the
    history far more strongly than it obeys a formatting instruction.** One
    markdown-formatted reply in the thread and every following *spoken* turn
    comes back in bullet points, whatever the prompt says — confirmed by moving
    the rule to the end of the prompt and getting byte-identical output.
    `speechify()` strips markdown from prior assistant turns when `spoken: true`.
    Fix the history, not the prompt.

12. **A capture must never be lost because parsing failed.**
    `rawFallbackCandidate` keeps the raw text as one unscored task with the full
    text in notes and sets `degraded`. A brain dump that vanishes is worse than
    a badly-parsed one.

13. **`weights` defaults are a starting point, not a claim.** They live in a
    table with a settings UI because untunable weights will be wrong for one
    specific person. Do not "correct" a weight the user has tuned.

14. **Relative dates must be normalised before storage.** A model echoes the
    user's own words, so "send it to Sarah by Friday" arrives as the literal
    string `"Friday"`. `parseDateLoose` cannot read it → `slackFor` returns null
    → a three-day job due Friday carries **no deadline pressure at all** and
    Tier 0 never fires. That is the single scenario the whole engine exists for,
    failing silently, on the app's most important input. `normalizeDate()` in
    `router.mjs` handles it at the boundary; anything that still will not parse
    is surfaced as a visible warning rather than stored quietly. Any new path
    that accepts a date from a model must normalise it too.

15. **Routing destinations are not equally safe, and the danger is inverse to
    how it feels.** A misfiled task costs three seconds to delete. A misfiled
    `knowledge` row becomes a premise in every future system prompt. A
    hallucinated `contracted` commitment with critical slack makes the ranker
    refuse to suggest anything else and be very confident about it — one bad row
    takes the whole app hostage. `BLAST_RADIUS` encodes this and the review
    screen sorts by it, so the dangerous rows get read first. Do not reorder the
    review by capture order, "for predictability".

16. **Strict `json_schema` mode does not support a top-level array — the root
    must be an object.** Providers disagree about how to fail this. Mistral does
    not error; it returns an **empty result**, which is indistinguishable from
    "the model found nothing to extract". Measured on identical prompt and
    input: 0 items with an array-rooted schema, 3 correct items with no schema
    at all. It also *happened to work* on some inputs, which is worse than
    failing outright — it made a transport bug look like prompt quality and cost
    a long debugging detour. `ROUTE_SCHEMA` is object-rooted with an `items`
    array; `unwrapItems()` tolerates either shape. **Any new schema sent to a
    hosted provider must have an object root.**

17. **A model asked for a domain will answer `"career/contribution"`.** That
    matches no row in `life_domains`, so the item shows no badge and is missing
    from every domain rollup — it looks *absent* rather than wrong. Storing a
    near-miss is worse than storing nothing. `validDomain()` filters it, and it
    runs in `writeOne` rather than only at classification time, because the
    review screen lets fields be edited and the writer is the last gate. The
    same reasoning applies to any enum a model fills in.

18. **`preClassify` must never silently override the model, and vice versa.**
    When the rules and the model disagree, the model's pick is kept but
    confidence drops to `low` and the disagreement is shown. This is the case
    most worth a human eye, so it must not look settled. Observed working: the
    model called a Sarah/Friday/deliverable fragment a `task`; the rule caught
    it and flagged it for review.

19. **A `description` in a model-facing JSON schema is format contagion.** The
    description travels to the provider inside a JSON string, so its quotes
    arrive escaped — and the model imitates that escaping in its own output,
    the same mechanism as invariant 11. Measured on identical input: with two
    short descriptions on `ROUTE_SCHEMA`'s link fields, the response broke into
    escaped quotes partway through the second item **every time**; without
    them, clean every time. Worse than a parse error, it sometimes still
    *parsed*, with the remaining items swallowed into one enormous key — a
    fragment the user typed vanishing with nothing reporting a problem. The
    enum carries the meaning; the prompt carries the wording.

20. **Never let a model hand you an id.** It is handed short references instead
    — `P1`, `C2` — built by `routingContext()` and resolved back server-side.
    A real id is `prj_20260820-143011-a3f2`: a dozen tokens to copy perfectly,
    and one wrong character gives a link that resolves to nothing while looking
    deliberate. An item pointing at a row that does not exist looks *filed* and
    is orphaned, which is worse than never linking it. Every reference is
    resolved against the live table, and `writeOne` re-checks — the review
    screen can edit these fields, so the writer is the last gate. Same
    reasoning as `validDomain` in invariant 17.

21. **Trim what a model leaves on its own keys.** Observed on responses that
    parse perfectly: `"due_date:"` and `"due_date "` instead of `"due_date"`.
    The field is then simply absent, so a commitment carries no deadline, so
    `slackFor` returns null, and Tier 0 never fires — invariant 14's failure
    reached by a different road. `cleanKeys()` runs on every model row,
    salvaged ones included.

---

## Toolchain gotchas

- **`node:sqlite` (`DatabaseSync`), not `better-sqlite3`.** The latter needs
  Visual Studio C++ build tools, which this machine does not have. Consequence:
  **there is no `db.transaction()`** — use explicit `BEGIN` / `COMMIT` /
  `ROLLBACK`.
- **`PRAGMA busy_timeout` defaults to 0.** With `node --watch`, the old and new
  processes overlap for a moment and you get `database is locked` on restart.
  Set to 5000 in `db.mjs`; do not remove it.
- **`POS_DATA_DIR`** points tests at a scratch directory. Without it a test run
  writes into the real database.
- **Ports**: 5185 Express, 5173 Vite. `npm run ports:free` when one is stuck.
  Hitting **5185** in a browser returns `{"error":"not found"}` — the app is on
  5173 in dev.
- **There is no "run all tests" convention beyond `npm test`**, and its glob
  **must stay quoted** (`node --test "test/**/*.test.mjs"`) or Windows will not
  expand it.
- **Windows/PowerShell**: `&&` is a parser error in PS 5.1. A Bash tool is also
  available and takes *different* syntax. **Backticks in a commit message
  trigger shell substitution** — use `git commit -F <file>`.
- **This machine has no CUDA GPU** (Intel Iris Xe, 15W i7-1255U), so Ollama runs
  CPU-only. An 8B model manages roughly 1 token/sec — a trivial 242-token request
  measured **179 seconds**. Default is `qwen2.5:3b`, chosen by measurement (~45s
  for the same extraction). `qwen2.5:1.5b` is ~2× faster again and adequate for
  capture. **Prompt processing dominates on CPU**, which is why prompt size is a
  latency problem here, not just a cost problem.
- **A hosted provider can fail on an HTTP 200.** Mistral returns
  `finish_reason: "error"` with output that is valid for two records and then
  degenerates. Nothing in the status code says so, and the old error message
  quoted only the first 300 characters, which look perfect. `oneShotJson`
  now reports length and finish reason and carries `err.rawText`;
  `salvageItems()` keeps the complete records so a batch is not thrown away
  wholesale, and the review screen says part of the answer was unreadable.
  Retried **once**, not to the full retry budget — the failure is more
  input-shaped than transient, so further identical requests mostly buy
  latency.
- **Gemini is blocked at the account level, not the key level.** The key
  authenticates; Google returns `400 FAILED_PRECONDITION — free tier is not
  available in your country`. It appeared to work in Google Canvas because Canvas
  injects its own API access. Needs billing enabled to use at all.
- **FTS5 is available** in `node:sqlite` (SQLite 3.51.3) — `CREATE VIRTUAL TABLE
  … USING fts5` works and ranks correctly. Retrieval needs no new dependency.
- **Google OAuth apps left in *Testing* publishing status have refresh tokens
  that expire after 7 days.** Publish the app (unverified is fine for a single
  personal user) or plan on re-authenticating weekly.
- **Writing into a vault Obsidian currently has open triggers an auto-merge with
  documented data-loss reports.** Any markdown mirror must be machine-owned,
  whole-file writes, in its own subfolder.
- **A modal that stays mounted while closed does not resync its props.**
  `useState(initialText)` captures the value from the *first* render — an empty
  dump box — so text typed later never arrives. It fails silently and looks like
  "the modal opened blank". Resync in an effect keyed on `open`.
- **`preview_start` resolves `.claude/launch.json` from the session's working
  directory, not from the repo you are editing.** Opening a session in one repo
  and working in another silently attaches the preview to the *wrong project's*
  dev server. Start the server yourself and pass an explicit `url`.
- **Browser-tool screenshots need the Browser pane actually displayed**;
  otherwise the page is not compositing and the call times out. `read_page` and
  `get_page_text` work regardless and are better verification anyway.

---

## Decided against — do not re-propose

- **`better-sqlite3`** — native build dependency this machine cannot satisfy.
- **API keys in browser storage** — the prototype's approach; the one thing
  clearly worth changing about it.
- **A separate `memory` table.** Created day one for the spec's "six memory
  layers", never read or written by anything. The six layers are a `layer`
  column on `knowledge`. One store with a facet beats two stores where one is
  empty.
- **Keeping Apps Script as a relay.** POS has no inbound route from the
  internet, so Apps Script could never push to it — POS would have to poll Apps
  Script, which needs OAuth anyway. Direct Google Tasks polling is the same auth
  cost with one less moving part.
- **Porting ExecAgent's `Tabs` and `Research` sheets** — low value against the
  merge cost.
- **Wikilinks in the markdown mirror** — standard links keep the export
  portable and readable outside Obsidian.
- **Numeric scales in model-facing schemas** — see invariant 8.
- **`description` fields in model-facing schemas** — see invariant 19.
- **Trusting "configured" as "working".** Settings makes a real request per
  backend, because a key can be present and still be revoked, out of quota,
  regionally blocked, or scoped to the wrong model.

---

## Open decisions — do not resolve unilaterally

- **Whether to pay for an API at all.** Currently no — this is a stated
  constraint, not an oversight. A **free Mistral tier is configured and live**
  (`mistral-small-latest`, ~4s for a nine-fragment routing call), which is what
  makes the routing layer usable. Do not assume a paid key will appear, and do
  not design anything that only works with one.
- **Auto-write for low-risk destinations.** Proposed and **declined** — the
  batch-review gate was chosen instead. Do not re-propose without new reason;
  the answer was about trust in the routing, not about the number of clicks. If
  it is ever revisited, the enrichment fields in `ROUTE_SCHEMA` must become
  `required` first (see the note in that file).
- **Whether the markdown mirror targets Obsidian specifically**, or stays plain
  portable markdown that Obsidian merely *can* open.
- **`personal_os.tsx`** (the Canvas prototype) is still untracked in the repo
  root. Keep, commit as reference, or delete — not decided.
- **Whether `daily_context` self-report should ever feed burnout scoring.**
  Currently burnout is built only from recorded behaviour, deliberately, so it
  cannot be gamed on a bad day.

---

## Working style

- Terse single-step prompts during verification: *"Do X, confirm."* Match that.
- He designed this architecture. **Don't lecture him about his own system.**
- Push back when you genuinely think he's wrong. Don't condescend.
- When you don't know, ask. When you've misunderstood, name it and correct it
  without performative self-flagellation.
- Verify stale docs against the code before repeating their claims. `README.md`
  in particular has drifted.

---

## Session protocol

### Starting a session
1. Read **AGENTS.md** (this file) and **NEXT.md**. That should be enough — you
   should not need chat history or `git log` to know where things stand.
2. Confirm the "next task" in NEXT.md is still what he wants before starting it.
3. Check anything a stale doc asserts against the actual code before acting on it.

### Ending a session
1. **Update NEXT.md** — current state paragraph, the next single task, the queue.
2. **Durable facts go in AGENTS.md**, not in tool-local memory and not in chat.
   A new invariant, a toolchain gotcha that cost real time, a decision made
   against something: those belong here, because memory in one AI tool is
   invisible to every other tool and to the next person who opens the repo.
3. Keep narrative *out* of AGENTS.md. If it has a date on it, it goes in NEXT.md.

### Session-start prompt — Claude Code
`CLAUDE.md` re-exports this file, so it loads automatically:

```
Read NEXT.md and pick up the current task.
```

### Session-start prompt — Codex
Codex does **not** load `AGENTS.md` automatically. Say so explicitly:

```
Read AGENTS.md and NEXT.md first, then pick up the current task in NEXT.md.
```
