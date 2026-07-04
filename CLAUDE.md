# CLAUDE.md — viz-org

viz-org is Devin Kearns's work-landscape app: the week as a bounded treemap — projects as boxes sized by hours, tasks as stripes, unbooked time as space. React + TypeScript + Vite; GitHub Pages at kearnsdm.github.io/viz-org. **Deploys automatically:** any push to `main` triggers `.github/workflows/deploy.yml`. "Deploy" = get code onto main; nothing else.

## Sync architecture — one private gist is the backplane
Gist `a8ada37ee061093bd8715faf9f5580a0`, gated by a classic GitHub PAT with `gist` scope only. Files:
- `viz-org-board.json` — full board `{v, state, savedAt}`; `state.projects[].tasks[].done` is truth for completion; `state.game` holds the reward economy.
- `viz-org-inbox.json` — `CandidateTask[]` drop box; the app drains it on load/focus/"Check for new tasks", dedupes by id, then empties it. Push here to add tasks: `{id, title, from, urgency: low|normal|high|urgent, due?, estimateMinutes?, suggestedProjectId?, link?, notes?}` — a fresh id re-ingests.
- `viz-org-streams.json` — v3 checklists: `{streamId, taskId|null, name, aliases[], codename, category, glyph, tintIndex, items[], history[]}`. History is append-only; replans fold removed items to `dropped`, never delete. Refer to streams by name/alias/codename, never ids; surface collisions, don't guess.
- `viz-org-analysis.json` — the contract ledger: terms, Build-Credit balance, charges, waivers, weekly measures, findings.

GitHub API headers for all calls: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, plus a User-Agent.

**Known bug (top of v-next):** sync is whole-file last-write-wins; two live devices clobber each other. Interim rule: one device at a time, Sync now before switching.

## Deploying — two separate deployments; do not conflate them
1. **The app** (everything in `src/`, `index.html`, `public/`): push to `main` → the Pages Action builds and publishes automatically. That is the entire app deploy. Never build or upload the app anywhere else.
2. **The relay** (`server/viz-relay.php` + `server/viz-relay-config.php`): lives on DreamHost, NOT on GitHub Pages. Deployed once by copying both files to the server (scp or DreamHost file manager) at `~/devinkearns.com/viz/`. Redeploy only when the relay code itself changes. `viz-relay-config.php` holds the secrets, is gitignored, and is never committed. The legacy `server/viz-sync.php` is a dormant fallback — do not deploy or modify it.

## The relay (LIVE)
URL: `https://www.devinkearns.com/viz/viz-relay.php` (the bare domain 301s to www — always use www). Auth: the low-stakes relay key via the `X-Viz-Key` header; the key lives in Devin's password manager and the server config only. Actions: `GET ?action=board`, `GET ?action=streams`, `POST ?action=streams` (whole-file replace), `POST ?action=append` ({candidates:[…]}, deduped by id). The gist PAT lives ONLY in the server config — it is never pasted in chat, stored in memory, or committed. Verified live 2026-07-02.

## Standing procedures
- **Capture:** "add X to viz-org" → push an unprocessed candidate to the inbox (suggest a project if obvious; never auto-file). It lands in Intake for triage: edit + file, or delete.
- **Checklists:** discussion → stream in the gist; Devin reports completions in chat; Claude updates state. Micro-streams for activation when depleted (first item a physical action, 10-minute frame, partials count).
- **Per-turn model:** Claude acts only within a turn. "Pull viz-org" = read gist state before answering. Never claim to see board changes without reading.

## The behavioral contract (ratified 2026-07-02; terms in viz-org-analysis.json)
- **Frog toll:** a 🔥 heavy task 3+ days without a sprint ⇒ any building session opens with a 10-minute sprint on the oldest frog. Waivable; waivers logged, never argued.
- **Credit-priced builds:** installment-scale work costs 1 Build Credit (100 pts); balance tracked in the analysis file; small fixes free.
- **Schedules:** components +2/check (capped at task value); first sprint of the day pays double; oldest-frog sprint +8; frogs stale >72h get a proactive micro-stream offer.
- **Feedback:** descriptive only — counts, firsts, trends. Never praise. No decay, streak-loss, or punishment mechanics, ever.
- **Enforcement tone:** state the toll or charge plainly, run it or log the waiver, proceed.

## Working style
- Code ships as reviewable patches, built and type-checked (`npm run lint` = `tsc --noEmit`) against a clean tree; Devin applies and pushes.
- Design decisions are locked in `viz-org-project-knowledge.md` (project knowledge / repo docs); propose changes as changes — never silently deviate. Channel discipline: area = hours always; hue = category; red/amber = urgency only; green = done only; luminance = priority.
- Communication: short conversational prose, then one-line intros with nested bullets; asks on a final "Need from you:" line. Never frame statements as "honest/candid/frank" — name the content (limitation, alternative, disagreement). Must-see items open with the bolded flag **"Let me add some additional information…"**, used sparingly.
