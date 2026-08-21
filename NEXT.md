# NEXT.md — where things stand

Durable rules, invariants and the session protocol live in **AGENTS.md**. This
file is only "what's going on right now". Keep it short and keep it current.

---

## Current state

Capture now routes. A dump goes in, gets split into fragments, and each one is
classified to where it actually belongs — task, commitment, project, idea,
knowledge, open question, decision, health signal, or honestly `unclear` — then
the whole batch is shown on one review screen and filed with a single click.
Nothing writes before that click. Rows are ordered by blast radius rather than
capture order, so a commitment or a knowledge row is read first, because those
are the two that do real damage when wrong. Deterministic rules classify in
parallel with the model; when they disagree the item is marked unsure and
flagged, which has already caught a real misroute. Destination changes at review
are stored and fed back as few-shot examples.

A **free Mistral tier is configured and working** — a nine-fragment dump routes
in about four seconds, versus the 45s a local 3B model takes for a much smaller
job. That is what makes this layer usable at all; voice mode is now plausible
too. Ollama remains behind it in the chain for offline use.

Verified end to end: a raw sentence about a Q3 model owed to Sarah became a
contracted commitment with a real date, and the ranker immediately moved into
Tier 0 and suppressed everything else. Test rows were removed afterwards; the 8
real knowledge rows are intact.

**The router now knows what already exists.** Open projects and commitments go
into the prompt as short references (`P1`, `C2`, name only), and the review row
carries two dropdowns: which project this attaches to, and whether it updates a
record already recorded rather than creating a second one. Verified live: with a
"Domovik CRM Transition" project and a "Sampling working session" commitment in
the database, a three-line dump came back with the mapping task already attached
to the project, the sampling fragment already set to *update* the existing
commitment, and "book a dentist" attached to nothing. Filing the same promise
twice updates it; the second row never appears.

Two levers made that work, both of them worth knowing about: the link fields are
**enums over the references that exist**, because a free-text field gets written
about in `why` and left empty; and they carry **no `description`**, because a
description makes the model escape its own quotes and lose an item (AGENTS.md
19). A word-overlap check runs alongside the model and offers a match it missed,
so a duplicate is caught by either path.

One gap, left as it is: only the fragment that actually names the project links
itself. In "finish the Q3 model / send Sarah the summary", the second line has
no Q3 in it and stays unattached. Prompting around it was tried and bought
nothing; the dropdown fixes it in one click.

Filing from a conversation works too: Copilot has a **File this** button that
reads the exchange, extracts what was settled, and sends it to the same review
screen — an assistant reply laying out a project, a deadline, a blocking
approval and a next action comes back as three linked records. The dump box and
the conversation take different paths on purpose: the dump box splits by line,
so pasting structured prose into it shreds it. **File this** is for anything the
assistant laid out.

---

## Next task — FTS5 retrieval for `buildSystemPrompt()`

Knowledge is still dumped whole into every prompt, which caps how far it can
grow. FTS5 is available in `node:sqlite` and ranks correctly, so retrieval needs
no new dependency: index `knowledge`, pull the rows that match the current
question, and stop sending the rest.

**Definition of done**: adding a hundred knowledge rows does not change the size
of a chat prompt, and a question about a specific subject still gets the rows
about that subject in its context.

---

## Queue — after that, in order

1. **Bring the six remaining pages up to the current visual standard** —
   Knowledge, Open Questions, Decisions, Reviews, Briefing, Chat, Onboarding.
2. **Dedicated Ideas and Dependencies pages.**
3. **Google Tasks capture, direct from POS.** Cutover order is load-bearing —
   see below.
4. **Phone access**: Tailscale + PWA manifest and service worker.
5. **Orchestrator + specialist agents.** Newly viable now that a fast backend
   exists.
6. **Fix `README.md`** — still claims the Ollama default is `hermes3:latest` and
   does not mention the hosted tier.

---

## Waiting on Milos

- **Decide what happens to `personal_os.tsx`** — the Canvas prototype, still
  untracked in the repo root.
- **Google OAuth consent screen: publish it** before queue item 3, or refresh
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
