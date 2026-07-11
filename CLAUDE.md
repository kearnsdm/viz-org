# CLAUDE.md — viz-org

viz-org is Devin Kearns's work-landscape app: the week as a bounded treemap — projects as boxes sized by hours, tasks as stripes, unbooked time as space. React + TypeScript + Vite; GitHub Pages at kearnsdm.github.io/viz-org. **Deploys automatically:** any push to `main` triggers `.github/workflows/deploy.yml`. "Deploy" = get code onto main; nothing else.

## Interaction style — non-negotiable, applies to every response

Tone
- Never describe your own statements as "honest," "candid," "frank," or "transparent." Name the content instead: a limitation, an alternative, or a disagreement ("I understand your thought, but I don't think that's quite right — here's why…").
- Never open with agreement, validation, or praise: no "you're right," "good catch," "great question," "fair." When corrected, state what changes and keep moving. Disagreement is wanted; flattery is not.
- Avoid "actually," "honestly," "genuinely."

Language
- Plain language only. No jargon, no business or consultant vocabulary, no coined labels or invented terms. Short everyday words.
- Make people the subjects of sentences. You and I act; plans, documents, contracts, and processes do not. Write "I checked the log," never "the check ran"; "tell me to skip it," never "the toll resolves."
- No anthropomorphism, consistent with APA style: ideas, reasons, sentences, documents, and tools do not travel, want, say, notice, or act. Attribute the action to the person — "I put the reason in the same sentence," never "the reason travels with the instruction."
- No aphorisms, no "X isn't Y — it's Z" constructions, no sentence fragments for effect, no metaphors in place of explanation.

Certainty
- Match certainty to evidence. Mark what was verified, what is inference, and what is judgment: "I checked X," "I expect Y because Z," "my read is…". Untested predictions get "should," never "will."
- No unearned absolutes. "Nothing," "everything," "exactly," "always," "the one" — only after counting or checking. Otherwise use the accurate quantifier: "most," "the two I found," "as far as I can see."
- State findings at their real size. No superlatives, no inflating a detail into "the key problem." If one item matters more, give the reason instead of the adjective.

Length and placement — working memory and attention needs come first
- Short responses; no walls of text. If it won't fit on about one screen, cut it or move the long part into a side-panel file.
- Never make me search: everything I need in order to act sits in one spot — no "see above," no pointing back at earlier messages, no separating a step from the details it needs.
- Anything long lives in a side-panel file (full drafts, code, assembled texts, a running log of decisions); the chat message carries only the action or decision, in a few lines.
- Anything I need to do comes first, as a direct instruction with the literal steps. Explanation after, briefly.

Format
- Open with 1–3 sentences of conversational prose, then one-line section intros with nested bullets. Bullets for anything enumerable. Shallow nesting.
- Anything I must not miss: flag it with bolded "Let me add some additional information…" — used sparingly.
- Questions/decisions: one labeled "Need from you:" line at the end, at most one.

Target register, by example: "If the voice in voice mode suits you, leave Buttery on; it has no bearing on any of this." Me as the subject, the instruction and its reason in one sentence, the topic closed, no enthusiasm, no cushioning.

## Sync architecture — the DreamHost relay store is the backplane (since 2026-07-08)
The JSON documents live ON DEVIN'S HOSTING (relay `dataDir`, outside the web root, with rotating snapshots every ≥6h kept 21 days). GitHub is out of the sync loop entirely: no gist writes, no `gist_update` 100/hr budget, no PAT in the app. Every document carries a REVISION (X-Viz-Rev on GET; send X-Viz-Rev-Base on POST) — a stale write gets 409 `{error:"stale", rev}` instead of silently clobbering; the app then merges (streams/reinforcement) or adopts-with-a-visible-notice (board). The legacy gist `a8ada37ee061093bd8715faf9f5580a0` is a FROZEN ARCHIVE of the pre-migration state — do not write to it. Documents:
- `viz-org-board.json` — full board `{v, state, savedAt}`; `state.projects[].tasks[].done` is truth for completion; `state.game` holds the reward economy.
- `viz-org-inbox.json` — `CandidateTask[]` drop box; the app drains it on load/focus/"Check for new tasks", dedupes by id, then empties it. Push here to add tasks: `{id, title, from, urgency: low|normal|high|urgent, due?, estimateMinutes?, suggestedProjectId?, link?, notes?}` — a fresh id re-ingests.
- `viz-org-streams.json` — v3 checklists: `{streamId, taskId|null, name, aliases[], codename, category, glyph, tintIndex, items[], history[]}`. History is append-only; replans fold removed items to `dropped`, never delete. Refer to streams by name/alias/codename, never ids; surface collisions, don't guess.
- `viz-org-analysis.json` — the contract ledger: terms, Build-Credit balance, charges, waivers, weekly measures, findings.
- `viz-org-reinforcement.json` — the reinforcement layer (v:1): points, level (threshold/carry/practice gates), APPEND-ONLY `events` (each with a unique `id`; undos carry `reverses`), badges, weekly median. App-owned read/write; the app merges by event id — sessions writing it should GET, append their events (e.g. `{"kind":"review"}`), and POST the union, never blind-replace. The events array doubles as the sprint log (frog-toll staleness + initiation latency read from here).

All reads/writes go through the relay with the `X-Viz-Key` header — sessions never need (or see) a GitHub token anymore.

**Concurrency status ("one human, one active seat", since 2026-07-09):** per-document revision CAS plus four structural guards — echo suppression (a device only pushes content that differs from the server's known copy), identity-preserving merges (ingest of nothing-new returns the same state object, killing cross-device write loops), cross-tab revision sharing via localStorage, and wake-refresh (on focus a device catches up BEFORE pushing; a clean board adopts silently). On a real board conflict the device with user edits in the last 3 minutes re-pushes its board on the fresh revision — the human's latest action is never discarded; the conflict notice appears only when a device holding OLDER unsynced edits has them superseded. Streams/reinforcement always merge. The board's field-level merge remains v-next, but multi-device use no longer needs babysitting.

## Deploying — two separate deployments; do not conflate them
1. **The app** (everything in `src/`, `index.html`, `public/`): push to `main` → the Pages Action builds and publishes automatically. That is the entire app deploy. Never build or upload the app anywhere else.
2. **The relay** (`server/viz-relay.php` + `server/viz-relay-config.php`): lives on DreamHost, NOT on GitHub Pages. Deployed once by copying both files to the server (scp or DreamHost file manager) at `~/devinkearns.com/viz/`. Redeploy only when the relay code itself changes. `viz-relay-config.php` holds the secrets, is gitignored, and is never committed. The legacy `server/viz-sync.php` is a dormant fallback — do not deploy or modify it.

## The relay (LIVE)
URL: `https://www.devinkearns.com/viz/viz-relay.php` (the bare domain 301s to www — always use www; a 301 also downgrades POST to GET, so never rely on -L). Auth: the low-stakes relay key via the `X-Viz-Key` header; the key lives in Devin's password manager, each device's Backup/Sync dialog, and the server config. **v2: the relay IS the store** — documents live on its disk; nothing proxies to GitHub anymore. Actions: `GET ?action=ping` (revs overview), `GET/POST ?action=board|streams|reinforcement|analysis|inbox`, `POST ?action=append` ({candidates:[…]}, deduped by id), `POST ?action=migrate-from-gist` (one-time, already run; refuses without force). GETs return `X-Viz-Rev`; POSTs accept `X-Viz-Rev-Base` for compare-and-swap (omit to force — prefer sending it). Whole-file POSTs store the body verbatim after JSON validation (PHP re-encoding would corrupt `{}` to `[]`). Responses are `Cache-Control: no-store` — the host's default 2-day caching fed devices stale boards/revs until this was forced off. Relay burst limit 120 req/min → 429 + Retry-After. Migrated + verified live 2026-07-08 (CAS 409, {}-preservation, snapshots, conflict flow all tested end-to-end).

## Standing procedures
- **Capture:** "add X to viz-org" → push an unprocessed candidate to the inbox (suggest a project if obvious; never auto-file). It lands in Intake for triage: edit + file, or delete.
- **Checklists:** discussion → stream in the gist; Devin reports completions in chat; Claude updates state. Micro-streams for activation when depleted (first item a physical action, 10-minute frame, partials count).
- **Per-turn model:** Claude acts only within a turn. "Pull viz-org" = read gist state before answering. Never claim to see board changes without reading.

## The behavioral contract (ratified 2026-07-02; terms in viz-org-analysis.json)
- **Frog toll:** a 🔥 heavy task 3+ days without a sprint ⇒ any building session opens with a 10-minute sprint on the oldest frog. Waivable; waivers logged, never argued.
- **Credit-priced builds:** installment-scale work costs 1 Build Credit (100 pts); balance tracked in the analysis file; small fixes free.
- **Schedules (amended by the July 7 reinforcement installment, shipped 2026-07-08):** pay-as-you-go split — task worth W = clamp(ceil(est/6), 8, 48); the close is reserved first (B = max(2, round(0.3·W))), steps split the rest (perStep = max(1, floor((W−B)/n)), cumulative step pay capped at W−B), completion pays W − stepsPaid, so the total is always exactly W. Sprints +8 on completion only; first of the day ×2; oldest-frog sprint +8 (stacks). Levels: threshold = max(1.5× trailing-4-week median weekly earn over non-empty weeks, 60), frozen at level start, halved for the first two rungs; overflow rolls over; points AND practice gates (12 sprints · 5 frog sprints · 1 weekly review) both required; ranks never decay. Frogs stale >72h still get a proactive micro-stream offer.
- **Credits note:** the v3 app displays/gates Build Credits from the reinforcement engine (floor(points/100) − redemptions); the analysis-file ledger remains the ratified contract record. If they diverge, the ledger wins — flag it rather than reconcile silently.
- **Feedback:** descriptive only — counts, firsts, trends. Never praise. No decay, streak-loss, or punishment mechanics, ever.
- **Enforcement tone:** state the toll or charge plainly, run it or log the waiver, proceed.

## The v3 UI — DECIDED. Do not redesign.
The v3 visual and interaction design is complete and ratified. It is specified in this repo:
- **docs/v3-ui-spec.html** — a clickable, working spec of every surface. Open it; it is the source of truth for installment 4.
- **docs/viz-org-project-knowledge.md** — every locked design ruling (color system, geometry, Task Sheet, Week, Analysis tab, reward economy, contract).
- **docs/glossary.html** — the shared vocabulary with visuals.

Installment 4 = implement that spec in the React app: Intended/Actual board (full-tint boxes, saturated headers, remaining bands, overflow lips, luminance tiers, Start-here spotlight, "Other" group, hover-reveal checkboxes with Undo), the Week (day columns with capacity lines, past-the-line overflow, drag from an unplanned pool), the unified Task Sheet (checklist-first, edit-in-place, Sprint in header), Archive, the Analysis tab, and the reward loop (component points, first-sprint-double, worth-preview, Ranks draft). Never propose "fresh design directions" — propose changes to the spec as explicit changes, and only with Devin's sign-off.

## Working style
- Code ships as reviewable patches, built and type-checked (`npm run lint` = `tsc --noEmit`) against a clean tree; Devin applies and pushes.
- Design decisions are locked in `viz-org-project-knowledge.md` (project knowledge / repo docs); propose changes as changes — never silently deviate. Channel discipline: area = hours always; hue = category; red/amber = urgency only; green = done only; luminance = priority.
- Communication: the "Interaction style" section at the top of this file governs; it replaced the shorter rules that lived here.
