# viz-org — build digest (July 8–9, 2026 session)

Canonical detail lives in the repo: `CLAUDE.md` and `docs/viz-org-project-knowledge.md`.
This is the consolidated state after the reinforcement + backplane + concurrency work.
App HEAD at time of writing: `c1abd7b` · deployed on GitHub Pages (kearnsdm.github.io/viz-org).

## Sync architecture — the relay IS the store (since 2026-07-08)
- The JSON documents (board, streams, reinforcement, analysis, inbox) now live ON
  DREAMHOST, in the relay's dataDir (`~/viz-data`, OUTSIDE the web root), written
  flock-guarded + atomically (tmp+rename). GitHub is entirely out of the sync loop.
- This retired: the gist_update 100/hr write cap (the cause of silent multi-machine
  data loss) AND the July-11 PAT expiry. The old gist (`a8ada37…`) is a FROZEN ARCHIVE
  of the pre-migration state — never written to again.
- Every document carries a REVISION. GET returns `X-Viz-Rev`; POST sends `X-Viz-Rev-Base`
  for compare-and-swap. A stale write gets `409 {error:"stale",rev}` instead of
  clobbering. Rotating snapshots (~6h cadence, 21-day retention) in `dataDir/snapshots`
  replace gist history — this is the restore mechanism.
- Relay responses are `Cache-Control:no-store` (DreamHost's default 2-day caching fed
  stale revs → conflict loops; forced off on both server and client).

## Concurrency model — "one human, one active seat"
- Echo suppression: a device only pushes a doc whose content differs from the server's
  known copy (background tabs stop bumping revisions).
- Wake-refresh: on window focus a device catches up from the server BEFORE pushing.
- Cross-tab revision sharing (localStorage) so sibling tabs aren't seen as foreign.
- On a real board 409: the device with user edits in the last 3 min re-pushes its board
  (the active seat wins — your latest action is never discarded); a clean bystander
  adopts silently; the conflict toast appears ONLY when older unsynced edits are
  genuinely superseded. Streams/reinforcement always merge (by id).
- DATA-LOSS GUARD: an EMPTY (0-task) board can never overwrite a non-empty one on ANY
  path (push, 409 arbitration, cross-tab). A blank device pulls the real board back and
  toasts "restored from the server." An all-zero board is treated as a symptom, never
  intent. (Resolved a "woke up to an empty board" scare — server was never actually empty.)
- Still v-next: the board has no field-level merge (streams/reinforcement do). One
  edit can still be lost-with-notice on a genuine board collision.

## Reinforcement layer (installment shipped 2026-07-08)
Ratified July 7 spec (`reinforcement-installment-handoff.md`) + design-review deviations:
- New pure module `src/reinforcement.ts` + file `viz-org-reinforcement.json`.
  Append-only EVENT LOG is the source of truth; points/level/gates/badges are FOLDS
  over it (stored scalars are caches). Merges by event id (never adopt-replace).
- Task worth `W = clamp(ceil(est/6), 8, 48)`, default 8.
- DEVIATION D1 (reserve-the-bonus, replaces the spec's negative-going formula):
  `B = max(2, round(0.3·W))`; `perStep = max(1, floor((W−B)/n))`; step pay capped at
  `W−B`; close pays `W − stepsPaid`. Total always = W; close always ≥ 2; nothing
  negative; finishing an unchecked checklist still pays full W (no anti-checklist incentive).
- Sprints: +8 on completion; first-of-day ×2; oldest-frog +8 (stacks). Frog identity
  captured at sprint START.
- Leveling: threshold = `max(round(1.5×median weekly earn over non-empty weeks), 60)`,
  halved (min 30) for the first two rungs, frozen at level start; overflow rolls over;
  practice gates (12 sprints / 5 frog sprints / 1 weekly review) required too; ranks
  never decay. D3 = the median bootstrap/floor. D4 = a "review" event kind (Analysis tab
  "Log weekly review" button) so the gate is satisfiable. D5 = credits read ONLY the new
  engine in v3.
- UI: header rank rail (replaced the HUD chip; popover has earnings/rollover/credits),
  slim rank card, Worth-the-most / Quick-hits boxes, escutcheon badge grid
  (`src/components/Heraldry.tsx` — config-driven registry, three tiers
  known/rumored/hidden; heraldic elaboration by level; hidden pool NOT enumerated in code).
- Channel discipline kept: rank bar desaturated (near-white); urgency-red/done-green
  stay OUT of badge tinctures.

## Board visual rulings (all ratified in chat, supersede earlier ones)
- BOUNDED LANDSCAPE, not a square: frame fills viewport height (`clamp(460px, 100vh−250px, 1300px)`)
  at a fixed 1.6:1, centered — scales up on big monitors, never a full-width strip,
  never scrolls past the fold. (A strict square was tried and rejected as too small.)
- Section borders: each box has a ~2.5px border in a DARK SHADE OF ITS OWN category
  hue (supersedes the 1px hairline seam) so similar-hued sections read apart.
- The frame IS the week: weekly-budget surplus renders as a dashed "unbooked time" tile
  (click = add project); planning past budget renders as a red-hatched "+Xh more than
  the week holds" tile. All tiles go through the same squarifier — area = real hours.
- Overview toggle (Tasks / Overview): Overview drops task stripes + spotlight, shows
  only allocation + runover, and un-groups every small category into its own box.
- Holding pen: a held task leaves the board ENTIRELY — no hours, no stripe, no
  Week/Today/spotlight, and (fixed `d4d89da`) no stripe in its box and no active-list row
  in the project screen (shows as a muted "⏸ On hold" footnote). Third board mode
  "Holding" sizes boxes by held minutes. A hold requires a FUTURE return date
  (`scheduledFor`); auto-resurfaces with a warning dialog.

## Rewards tab layout
Board-like: top band (rank fills left; Build Credits + Recent earnings at the right
end of the same row), then Worth-the-most | Quick-hits side by side (grid uses
`minmax(0,1fr)` so long titles ellipsize instead of overflowing), then the escutcheon
grid. Container 1040px, centered.

## Sync-safety UX
- Header SyncPill: Local only / Synced / Saving… / Unsaved / Not syncing.
- Prominent SyncBanner when writes are paused or a failure stranded changes: "saved on
  THIS device / don't edit on another machine / countdown / Try now." "Synced" on the
  machine you're using = it's on the server and inside the snapshot rotation.

## Open items / watch
- Board field-level merge (top of v-next) — the last real clobber vector.
- Reinforcement revision climbs fast (~500) — worth a look for write churn from the
  `evaluateBadges` effect.
- Optional off-site backup (everything lives on DreamHost now; snapshots cover
  day-to-day loss but not a DreamHost account catastrophe).
