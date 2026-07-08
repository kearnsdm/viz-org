import { createContext, useContext } from "react";
import type { AppState, GameState, Stream, Task } from "./types";
import { isoDate } from "./game";

// ============================================================================
// The reinforcement layer — ratified July 7 2026 (reinforcement-installment-
// handoff.md is the contract; the v4 mockup is the visual reference).
//
// Everything here is pure: state in, state out. Persistence is at the bottom
// (localStorage); gist sync lives in sync.ts (viz-org-reinforcement.json).
// The append-only `events` array is the authoritative earn history — it
// doubles as the sprint log (closing the frog-toll staleness gap) and feeds
// initiation-latency. All totals, gates, and medians are FOLDS OVER THE LOG;
// stored scalars are display caches, never trusted over the fold.
//
// DOCUMENTED SPEC DEVIATIONS (each flagged in the handback for ratification;
// all were confirmed necessary by a three-lens design review):
//  D1. Pay split uses the reserve-the-bonus variant. The literal spec formula
//      (perStep = max(2, round(0.7W/n)), bonus = W − n·perStep) goes NEGATIVE
//      for the most common case (W=8 with 4+ steps → bonus −2…−4) and its
//      max(2,·) floor lets step totals exceed W (n=30 on W=8 pays 60),
//      falsifying "farm-proof by construction". Instead: reserve the close
//      first — B = max(2, round(0.3·W)); stepBudget = W − B;
//      perStep = max(1, floor(stepBudget / n)); cumulative step pay per task
//      is capped at stepBudget; the close pays W − stepsPaid. Total is always
//      exactly W, the close always pays ≥ B ≥ 2 (finishing beats stalling),
//      nothing is ever negative, and completing an unchecked checklist pays
//      the same W as a stepless task (no anti-checklist incentive). This
//      reproduces the mockup's own rows (W=34,n=6 → +4 each, +10 close).
//  D2. Events carry unique `id`s and reversals carry `reverses` — the spec's
//      schema cannot otherwise express undo or survive a cross-device merge.
//  D3. Threshold bootstrap: the trailing-4-week median counts only weeks that
//      contain at least one earning event; with fewer than two such weeks it
//      falls back to a floor (60). threshold = max(round(1.5·median), 60),
//      halved (min 30) for the first two rungs. The spec's "hard cap = 2
//      weeks of median" is vacuous (1.5m < 2m always) and is NOT implemented
//      — what it was meant to bound needs a ruling.
//  D4. A "review" event kind exists (the practice gate was otherwise
//      unsatisfiable — nothing produced weekly reviews). Producers: the
//      Analysis tab's "Log weekly review" action, and chat writing the gist.
//  D5. A "redeem" event kind exists; v3 credits read ONLY this engine
//      (floor(total/100) − redeems − baseline). The legacy engine and the
//      analysis-file ledger otherwise give three diverging answers.
//
// ACCEPTED SINGLE-USER TRADE-OFFS (documented, not defects): estimateMinutes
// is self-reported, so W is honor-bound; splitting one big task into several
// raises total W (capped per task at 48); the W floor of 8 pays trivial tasks
// like half-hour ones. Fine for a system whose only user owns the integrity.
//
// COMPACTION RULE (unimplemented, planned): events older than the trailing
// median window may be folded into weekly aggregate records preserving
// lifetime counters and since-startedAt gate windows. At current volume the
// log stays small for years.
// ============================================================================

export const REINF_STORAGE_KEY = "viz-org-reinforcement-v1";

/** Fixed id for the one-time legacy seed — union-merge dedupes double seeds. */
export const SEED_EVENT_ID = "seed-legacy-v1";
/** Sprint pay: on completion only. */
export const SPRINT_PAY = 8;
/** First completed sprint of the day pays double (an extra `doubler` event). */
export const DOUBLER_PAY = 8;
/** Sprinting the oldest 🔥 on the board pays an extra bonus (stacks). */
export const FROG_BONUS_PAY = 8;
/** Threshold floor while earn history is thin (D3). Devin-tunable. */
const THRESHOLD_FLOOR = 60;
/** Practice gates per level (defaults; Devin-tunable per rank). */
const GATE_DEFAULTS = { sprints: 12, frogSprints: 5, reviews: 1 };
/** Points per Build Credit (unchanged from the ratified contract). */
export const POINTS_PER_CREDIT = 100;

/** The fixed, fully visible ladder — no surprise in this channel. */
export const LADDER = [
  "Clerk of Intake",
  "List Keeper",
  "Box Builder",
  "Frog Handler",
  "Cartographer",
  "Frogkeeper",
  "Landscape Architect",
];

// --- types (spec §5, amended per D2/D4/D5) -----------------------------------

export type REventKind =
  | "seed" // one-time legacy fold-in (excluded from medians and gates)
  | "sprint" // a completed sprint (+8); taskId when started from a task
  | "doubler" // first-of-day double (extra +8)
  | "frogBonus" // oldest-frog sprint bonus (extra +8)
  | "step" // a stream item open → done
  | "close" // task completion (close payment = W − stepsPaid)
  | "bonus" // anything chat/the ledger grants by hand
  | "review" // a weekly review (practice gate) — D4
  | "redeem" // a Build Credit redemption — D5
  | "undo"; // compensating reversal; carries `reverses` — D2

export interface REvent {
  id: string;
  at: number;
  kind: REventKind;
  delta: number;
  taskId?: string;
  streamItemId?: string;
  /** id of the event this one reverses (kind === "undo"). */
  reverses?: string;
  /** Short human label for the earnings popover. */
  label?: string;
  /** For `close` events: the task's planned day (feeds As Planned). */
  planned?: string;
}

export interface RGates {
  sprints: [number, number];
  frogSprints: [number, number];
  reviews: [number, number];
}

export interface RLevel {
  rank: string;
  next: string | null;
  /** Points needed this level — frozen at the moment the level started. */
  threshold: number;
  startedAt: number;
  /** Overflow rolled in from the previous level (pre-filled bar segment). */
  carryIn: number;
  gates: RGates;
}

export interface BadgeAward {
  earnedAt: number;
  tier?: number;
  count?: number;
  /** Display data for awards written from outside the app (hidden pool). */
  name?: string;
  glyph?: string;
}

export interface ReinforcementState {
  v: 1;
  /** Cache of the fold — recomputed on every change, never authoritative. */
  pointsTotal: number;
  level: RLevel;
  events: REvent[];
  badges: Record<string, BadgeAward>;
  weekly: { medianEarn: number };
  /** Legacy creditsRedeemed at seed time (D5). */
  creditsRedeemedBase: number;
  /** Size of the hidden badge pool, written from outside the app; the
   * "+N undiscovered" tile renders only when this is known. */
  hiddenPool?: number;
  updatedAt: number;
}

export function rid(): string {
  return `re_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// --- task worth & the pay-as-you-go split (spec §2 as amended by D1) ---------

/** W = clamp(ceil(estimateMinutes / 6), 8, 48); no estimate → 8. */
export function taskWorth(task: Task): number {
  const est = task.estimateMinutes ?? 0;
  if (est <= 0) return 8;
  return Math.min(48, Math.max(8, Math.ceil(est / 6)));
}

export interface PaySplit {
  /** Countable steps: open + done (dropped never pays). */
  n: number;
  perStep: number;
  /** The reserved close payment when every step has been paid. */
  closeReserve: number;
  /** Total step budget (W − reserve). */
  stepBudget: number;
}

/** D1: reserve the close first, split the rest across steps. */
export function paySplit(task: Task, stream: Stream | undefined): PaySplit {
  const W = taskWorth(task);
  const n = stream ? stream.items.filter((i) => i.state !== "dropped").length : 0;
  if (n === 0) return { n: 0, perStep: 0, closeReserve: W, stepBudget: 0 };
  const closeReserve = Math.max(2, Math.round(0.3 * W));
  const stepBudget = W - closeReserve;
  const perStep = Math.max(1, Math.floor(stepBudget / n));
  return { n, perStep, closeReserve, stepBudget };
}

/** Unreversed events, paired by `reverses` id — the one true fold input. */
export function effectiveEvents(events: REvent[]): REvent[] {
  const reversed = new Set<string>();
  for (const e of events) if (e.kind === "undo" && e.reverses) reversed.add(e.reverses);
  return events.filter((e) => e.kind !== "undo" && !reversed.has(e.id));
}

/** Net step pay already made for a task (undo-aware, from the fold). */
export function stepsPaidFor(events: REvent[], taskId: string): number {
  return effectiveEvents(events)
    .filter((e) => e.kind === "step" && e.taskId === taskId)
    .reduce((s, e) => s + e.delta, 0);
}

/** What the NEXT checked step on this task actually pays (cap-aware, D1). */
export function nextStepPay(task: Task, stream: Stream | undefined, events: REvent[]): number {
  const { n, perStep, stepBudget } = paySplit(task, stream);
  if (n === 0) return 0;
  const paid = stepsPaidFor(events, task.id);
  return Math.max(0, Math.min(perStep, stepBudget - paid));
}

/** The close payment right now: W − stepsPaid (≥ closeReserve normally).
 * The stream is irrelevant here by design — however the task ends, the total
 * paid is exactly W (no anti-checklist incentive). */
export function closePayFor(task: Task, _stream: Stream | undefined, events: REvent[]): number {
  const W = taskWorth(task);
  return Math.max(0, W - stepsPaidFor(events, task.id));
}

/** Whether a task's close has been paid and not reversed. */
export function closePaid(events: REvent[], taskId: string): boolean {
  return effectiveEvents(events).some((e) => e.kind === "close" && e.taskId === taskId);
}

// --- points, weekly earn, thresholds ------------------------------------------

/** pointsTotal = Σ deltas of unreversed events (the seed included). */
export function pointsTotal(rs: ReinforcementState): number {
  return effectiveEvents(rs.events).reduce((s, e) => s + e.delta, 0);
}

/** Points earned within the current level (carry-in pre-fills the bar).
 * Doubler events are deduped to one per local day (tab-race guard). */
export function levelProgress(rs: ReinforcementState): number {
  const since = rs.level.startedAt;
  let sum = 0;
  const doublerDays = new Set<string>();
  for (const e of effectiveEvents(rs.events)) {
    if (e.at < since || e.kind === "seed") continue;
    if (e.kind === "doubler") {
      const day = isoDate(new Date(e.at));
      if (doublerDays.has(day)) continue;
      doublerDays.add(day);
    }
    sum += e.delta;
  }
  return Math.max(0, rs.level.carryIn + sum);
}

export function pointsToGo(rs: ReinforcementState): number {
  return Math.max(0, rs.level.threshold - levelProgress(rs));
}

/** Monday-start local week key (consistent with the board's weekDates). */
function weekKey(at: number): string {
  const d = new Date(at);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

/** Trailing-4-week median weekly earn over NON-EMPTY weeks (D3): weeks with
 * no earning events are skipped; fewer than two non-empty weeks → floor. */
export function weeklyMedianEarn(events: REvent[], now = Date.now()): number {
  const WEEK = 7 * 24 * 3600 * 1000;
  const byWeek = new Map<string, number>();
  for (const e of effectiveEvents(events)) {
    if (e.kind === "seed" || e.delta <= 0) continue;
    if (now - e.at >= 4 * WEEK || e.at > now) continue;
    const k = weekKey(e.at);
    byWeek.set(k, (byWeek.get(k) ?? 0) + e.delta);
  }
  const weeks = [...byWeek.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (weeks.length < 2) return THRESHOLD_FLOOR;
  const mid = weeks.length / 2;
  const median = weeks.length % 2 ? weeks[Math.floor(mid)] : (weeks[mid - 1] + weeks[mid]) / 2;
  return Math.round(median);
}

/** Threshold for the level that STARTS now — frozen until its level-up (D3). */
export function nextThreshold(rankIdx: number, median: number): number {
  const base = Math.max(Math.round(1.5 * median), THRESHOLD_FLOOR);
  return rankIdx < 2 ? Math.max(30, Math.round(base / 2)) : base;
}

/** Practice-gate progress, derived from events since the level started. */
export function gateProgress(rs: ReinforcementState): RGates {
  const since = rs.level.startedAt;
  let sprints = 0;
  let frogs = 0;
  let reviews = 0;
  for (const e of effectiveEvents(rs.events)) {
    if (e.at < since) continue;
    if (e.kind === "sprint") sprints++;
    if (e.kind === "frogBonus") frogs++;
    if (e.kind === "review") reviews++;
  }
  const g = rs.level.gates;
  return {
    sprints: [Math.min(sprints, g.sprints[1]), g.sprints[1]],
    frogSprints: [Math.min(frogs, g.frogSprints[1]), g.frogSprints[1]],
    reviews: [Math.min(reviews, g.reviews[1]), g.reviews[1]],
  };
}

export function gatesMet(rs: ReinforcementState): boolean {
  const g = gateProgress(rs);
  return g.sprints[0] >= g.sprints[1] && g.frogSprints[0] >= g.frogSprints[1] && g.reviews[0] >= g.reviews[1];
}

/** True when points are the ONLY unmet requirement — drives the "levels you
 * up" pill, which must never promise what the gates would deny. */
export function pointsAreOnlyGate(rs: ReinforcementState): boolean {
  return !!rs.level.next && gatesMet(rs);
}

// --- credits (D5) --------------------------------------------------------------

export function creditsRedeemed(rs: ReinforcementState): number {
  return rs.creditsRedeemedBase + effectiveEvents(rs.events).filter((e) => e.kind === "redeem").length;
}

export function availableCredits3(rs: ReinforcementState): number {
  return Math.max(0, Math.floor(pointsTotal(rs) / POINTS_PER_CREDIT) - creditsRedeemed(rs));
}

export function pointsToNextCredit3(rs: ReinforcementState): number {
  return POINTS_PER_CREDIT - (((pointsTotal(rs) % POINTS_PER_CREDIT) + POINTS_PER_CREDIT) % POINTS_PER_CREDIT);
}

// --- the reducer ----------------------------------------------------------------

export type RAction =
  | { type: "sprint"; taskId?: string; oldestFrog: boolean }
  | { type: "step"; task: Task; stream: Stream; itemId: string }
  | { type: "unstep"; task: Task; itemId: string }
  | { type: "close"; task: Task; stream?: Stream }
  | { type: "unclose"; task: Task }
  | { type: "review" }
  | { type: "redeem" }
  | { type: "seed"; legacy: GameState }
  | { type: "ingest"; remote: ReinforcementState }
  | { type: "evaluateBadges"; board: AppState; streams: Stream[] };

function freshLevel(rankIdx: number, median: number, carryIn: number, now: number): RLevel {
  return {
    rank: LADDER[Math.min(rankIdx, LADDER.length - 1)],
    next: rankIdx + 1 < LADDER.length ? LADDER[rankIdx + 1] : null,
    threshold: nextThreshold(rankIdx, median),
    startedAt: now,
    carryIn,
    gates: {
      sprints: [0, GATE_DEFAULTS.sprints],
      frogSprints: [0, GATE_DEFAULTS.frogSprints],
      reviews: [0, GATE_DEFAULTS.reviews],
    },
  };
}

export function emptyReinforcement(now = Date.now()): ReinforcementState {
  return {
    v: 1,
    pointsTotal: 0,
    level: freshLevel(0, THRESHOLD_FLOOR, 0, now),
    events: [],
    badges: {},
    weekly: { medianEarn: THRESHOLD_FLOOR },
    creditsRedeemedBase: 0,
    updatedAt: now,
  };
}

function withDerived(rs: ReinforcementState): ReinforcementState {
  return {
    ...rs,
    pointsTotal: pointsTotal(rs),
    weekly: { medianEarn: weeklyMedianEarn(rs.events) },
    updatedAt: Date.now(),
  };
}

/** Ranks never decay; overflow rolls over as a pre-filled segment. Level-up
 * needs points AND practice gates (gates reset each level, so a giant carry
 * cannot cascade rungs — the gates are the implicit brake). */
function maybeLevelUp(rs: ReinforcementState): ReinforcementState {
  let cur = rs;
  for (let guard = 0; guard < LADDER.length; guard++) {
    if (!cur.level.next) return cur;
    const progress = levelProgress(cur);
    if (progress < cur.level.threshold || !gatesMet(cur)) return cur;
    const overflow = progress - cur.level.threshold;
    const rankIdx = LADDER.indexOf(cur.level.next);
    cur = { ...cur, level: freshLevel(rankIdx, weeklyMedianEarn(cur.events), overflow, Date.now()) };
  }
  return cur;
}

function append(rs: ReinforcementState, events: REvent[]): ReinforcementState {
  if (!events.length) return rs;
  return withDerived(maybeLevelUp({ ...rs, events: [...rs.events, ...events] }));
}

export function reinforcementReducer(rs: ReinforcementState, action: RAction): ReinforcementState {
  const now = Date.now();
  switch (action.type) {
    case "sprint": {
      const first = !sprintedToday(rs);
      const evts: REvent[] = [
        { id: rid(), at: now, kind: "sprint", delta: SPRINT_PAY, taskId: action.taskId, label: "Sprint finished" },
      ];
      if (first)
        evts.push({ id: rid(), at: now, kind: "doubler", delta: DOUBLER_PAY, taskId: action.taskId, label: "First of the day ×2" });
      if (action.oldestFrog)
        evts.push({ id: rid(), at: now, kind: "frogBonus", delta: FROG_BONUS_PAY, taskId: action.taskId, label: "Oldest frog 🔥" });
      return append(rs, evts);
    }
    case "step": {
      const pay = nextStepPay(action.task, action.stream, rs.events);
      return append(rs, [
        {
          id: rid(),
          at: now,
          kind: "step",
          delta: pay,
          taskId: action.task.id,
          streamItemId: action.itemId,
          label: `Step · ${action.task.title.slice(0, 40)}`,
        },
      ]);
    }
    case "unstep": {
      // Reverse the most recent unreversed step event for this item at its
      // RECORDED delta (D2) — restores exactly the cap headroom it consumed.
      const eff = effectiveEvents(rs.events);
      const target = [...eff]
        .reverse()
        .find((e) => e.kind === "step" && e.taskId === action.task.id && e.streamItemId === action.itemId);
      if (!target) return rs;
      return append(rs, [
        {
          id: rid(),
          at: now,
          kind: "undo",
          delta: -target.delta,
          taskId: action.task.id,
          streamItemId: action.itemId,
          reverses: target.id,
          label: "Step unchecked",
        },
      ]);
    }
    case "close": {
      if (closePaid(rs.events, action.task.id)) return rs; // pays once
      const delta = closePayFor(action.task, action.stream, rs.events);
      return append(rs, [
        {
          id: rid(),
          at: now,
          kind: "close",
          delta,
          taskId: action.task.id,
          label: `Closed · ${action.task.title.slice(0, 40)}`,
          planned: action.task.scheduledFor,
        },
      ]);
    }
    case "unclose": {
      // Reverse the close payment (steps keep their pay — the work happened).
      const eff = effectiveEvents(rs.events);
      const target = [...eff].reverse().find((e) => e.kind === "close" && e.taskId === action.task.id);
      if (!target) return rs;
      return append(rs, [
        {
          id: rid(),
          at: now,
          kind: "undo",
          delta: -target.delta,
          taskId: action.task.id,
          reverses: target.id,
          label: "Completion undone",
        },
      ]);
    }
    case "review":
      return append(rs, [{ id: rid(), at: now, kind: "review", delta: 0, label: "Weekly review" }]);
    case "redeem": {
      if (availableCredits3(rs) < 1) return rs;
      return append(rs, [
        { id: rid(), at: now, kind: "redeem", delta: 0, label: "🛠️ Build Credit redeemed" },
      ]);
    }
    case "seed": {
      // Fold the legacy total in exactly once. The fixed event id makes a
      // double seed collapse in any union merge; an already-seeded or
      // already-active state never re-seeds.
      if (rs.events.some((e) => e.id === SEED_EVENT_ID) || rs.events.length > 0) return rs;
      const legacyPoints = Math.max(0, action.legacy.points);
      const idx = Math.max(0, Math.min(LADDER.length - 1, legacyRankIndex(action.legacy)));
      const seeded: ReinforcementState = {
        ...rs,
        creditsRedeemedBase: Math.max(0, action.legacy.creditsRedeemed),
        level: freshLevel(idx, THRESHOLD_FLOOR, 0, now),
        events: [
          {
            id: SEED_EVENT_ID,
            at: now,
            kind: "seed",
            delta: legacyPoints,
            label: "Carried over from the first economy",
          },
        ],
      };
      return withDerived(seeded);
    }
    case "ingest":
      // Merged-in events may cross the threshold too (another device earned
      // them) — level-up must not wait for the next local action.
      return maybeLevelUp(mergeReinforcement(rs, action.remote));
    case "evaluateBadges": {
      const awards = evaluateBadges(rs, action.board, action.streams);
      if (!awards) return rs;
      return withDerived({ ...rs, badges: awards });
    }
    default:
      return rs;
  }
}

/** Where the legacy ladder left the user (mirror of game.ts rankIndex, kept
 * local so this module has no dependency cycle). */
function legacyRankIndex(g: GameState): number {
  const pts = g.points;
  if (pts >= 1000 && g.heavyCompleted >= 15 && g.creditsRedeemed >= 6) return 6;
  if (pts >= 720 && g.heavyCompleted >= 10 && g.focusSessions >= 12 && g.creditsRedeemed >= 4) return 5;
  if (pts >= 480 && g.heavyCompleted >= 5 && g.focusSessions >= 5 && g.creditsRedeemed >= 2) return 4;
  if (pts >= 360 && g.heavyCompleted >= 3) return 3;
  if (pts >= 240 && Math.floor(pts / 100) >= 1) return 2;
  if (pts >= 120 && g.tasksCompleted >= 10) return 1;
  return 0;
}

// --- cross-device merge (D2: union by event id, NEVER adopt-replace) -----------

export function mergeReinforcement(local: ReinforcementState, remote: ReinforcementState): ReinforcementState {
  if (!remote || remote.v !== 1 || !Array.isArray(remote.events)) return local;
  const seen = new Set(local.events.map((e) => e.id));
  const merged = [...local.events];
  for (const e of remote.events) {
    if (e && typeof e.id === "string" && !seen.has(e.id)) {
      merged.push(e);
      seen.add(e.id);
    }
  }
  merged.sort((a, b) => a.at - b.at);

  const li = LADDER.indexOf(local.level.rank);
  const ri = LADDER.indexOf(remote.level?.rank ?? "");
  const level =
    ri > li
      ? remote.level
      : ri === li && (remote.level?.startedAt ?? 0) > local.level.startedAt
        ? remote.level
        : local.level;

  // Badges: earliest earn wins the date; tier/count only ratchet upward.
  // Defensive: the relay round-trip can turn an empty {} into [].
  const remoteBadges =
    remote.badges && !Array.isArray(remote.badges) ? remote.badges : ({} as Record<string, BadgeAward>);
  const badges: Record<string, BadgeAward> = { ...remoteBadges };
  for (const [id, a] of Object.entries(local.badges ?? {})) {
    const r = badges[id];
    if (!r) badges[id] = a;
    else
      badges[id] = {
        ...r,
        earnedAt: Math.min(r.earnedAt, a.earnedAt),
        tier: Math.max(r.tier ?? 0, a.tier ?? 0) || undefined,
        count: Math.max(r.count ?? 0, a.count ?? 0) || undefined,
        name: r.name ?? a.name,
        glyph: r.glyph ?? a.glyph,
      };
  }

  return withDerived({
    ...local,
    events: merged,
    level,
    badges,
    creditsRedeemedBase: Math.max(local.creditsRedeemedBase, remote.creditsRedeemedBase ?? 0),
    hiddenPool: remote.hiddenPool ?? local.hiddenPool,
  });
}

// --- persistence ---------------------------------------------------------------

export function loadReinforcement(): ReinforcementState | null {
  try {
    const raw = localStorage.getItem(REINF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && Array.isArray(parsed.events)) {
      const rs = parsed as ReinforcementState;
      if (Array.isArray(rs.badges)) rs.badges = {}; // relay {}→[] defence
      if (typeof rs.creditsRedeemedBase !== "number") rs.creditsRedeemedBase = 0;
      return withDerived(rs);
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function saveReinforcement(rs: ReinforcementState): void {
  try {
    localStorage.setItem(REINF_STORAGE_KEY, JSON.stringify(rs));
  } catch {
    /* best-effort */
  }
}

// --- selectors the UI needs ------------------------------------------------------

/** The oldest open 🔥 on the board — the frog the toll and the +8 point at.
 * Evaluated at sprint START and recorded on the event, so board changes
 * mid-sprint can't retroactively change what the sprint was. */
export function oldestFrogId(state: AppState): string | undefined {
  let best: Task | undefined;
  for (const p of state.projects) {
    for (const t of p.tasks) {
      if (t.heavy && !t.done && !t.held && (!best || t.createdAt < best.createdAt)) best = t;
    }
  }
  return best?.id;
}

/** Has a sprint already been completed today (local date)? */
export function sprintedToday(rs: ReinforcementState, now = new Date()): boolean {
  const today = isoDate(now);
  return effectiveEvents(rs.events).some((e) => e.kind === "sprint" && isoDate(new Date(e.at)) === today);
}

/** "about N days at your pace" — null when there's no real history yet. */
export function daysToGo(rs: ReinforcementState): number | null {
  const WEEK = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const recent = effectiveEvents(rs.events).filter(
    (e) => e.kind !== "seed" && e.delta > 0 && now - e.at < WEEK,
  );
  if (recent.length < 2) return null;
  const perDay = Math.max(1, rs.weekly.medianEarn / 7);
  return Math.max(1, Math.ceil(pointsToGo(rs) / perDay));
}

/** Recent earnings for the rail popover — newest first, undos folded out. */
export function recentEarnings(rs: ReinforcementState, limit = 5): REvent[] {
  return effectiveEvents(rs.events)
    .filter((e) => e.kind !== "seed")
    .reverse()
    .slice(0, limit);
}

// --- React context ----------------------------------------------------------------

export interface ReinforcementContextValue {
  rs: ReinforcementState;
  dispatchR: (action: RAction) => void;
}

export const ReinforcementContext = createContext<ReinforcementContextValue | null>(null);

export function useReinforcement(): ReinforcementContextValue {
  const ctx = useContext(ReinforcementContext);
  if (!ctx) throw new Error("useReinforcement must be used within its provider");
  return ctx;
}

// --- badge metric helpers (pure folds over the log) ------------------------------

function dayKey(at: number): string {
  return isoDate(new Date(at));
}

function isWorkday(d: Date): boolean {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

/** Longest run of consecutive workdays with ≥1 completed sprint. */
export function sprintWorkdayStreak(events: REvent[]): number {
  const days = new Set(
    effectiveEvents(events)
      .filter((e) => e.kind === "sprint")
      .map((e) => dayKey(e.at)),
  );
  if (!days.size) return 0;
  let best = 0;
  for (const start of days) {
    let run = 0;
    const d = new Date(start + "T12:00:00");
    for (let guard = 0; guard < 400; guard++) {
      if (!isWorkday(d)) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      if (!days.has(isoDate(d))) break;
      run++;
      d.setDate(d.getDate() - 1);
    }
    best = Math.max(best, run);
  }
  return best;
}

/** Most frog sprints inside any rolling 7-day window. */
export function frogSprintsInAWeek(events: REvent[]): number {
  const frogs = effectiveEvents(events)
    .filter((e) => e.kind === "frogBonus")
    .map((e) => e.at)
    .sort((a, b) => a - b);
  const WEEK = 7 * 24 * 3600 * 1000;
  let best = 0;
  for (let i = 0; i < frogs.length; i++) {
    let j = i;
    while (j < frogs.length && frogs[j] - frogs[i] < WEEK) j++;
    best = Math.max(best, j - i);
  }
  return best;
}

/** Most completed sprints in a single local calendar day. */
export function sprintsInADay(events: REvent[]): number {
  const byDay = new Map<string, number>();
  for (const e of effectiveEvents(events)) {
    if (e.kind !== "sprint") continue;
    const k = dayKey(e.at);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  return byDay.size ? Math.max(...byDay.values()) : 0;
}

/** Sprints completed before 9am (local). */
export function earlySprints(events: REvent[]): number {
  return effectiveEvents(events).filter((e) => e.kind === "sprint" && new Date(e.at).getHours() < 9).length;
}

/** Weeks where ≥70% of planned closes landed on their planned day (min 3). */
export function asPlannedWeeks(events: REvent[]): number {
  const byWeek = new Map<string, { planned: number; onDay: number }>();
  for (const e of effectiveEvents(events)) {
    if (e.kind !== "close" || !e.planned) continue;
    const week = weekKey(e.at);
    const rec = byWeek.get(week) ?? { planned: 0, onDay: 0 };
    rec.planned++;
    if (e.planned === dayKey(e.at)) rec.onDay++;
    byWeek.set(week, rec);
  }
  let weeks = 0;
  for (const rec of byWeek.values()) if (rec.planned >= 3 && rec.onDay / rec.planned >= 0.7) weeks++;
  return weeks;
}

/**
 * Evaluate the computable badge metrics; returns the merged awards map, or
 * null when nothing changed. Awards only ever ratchet upward. The hidden
 * pool is deliberately NOT enumerated here — its awards arrive via the gist.
 */
export function evaluateBadges(
  rs: ReinforcementState,
  board: AppState,
  streams: Stream[],
): Record<string, BadgeAward> | null {
  const now = Date.now();
  const evts = rs.events;
  const out: Record<string, BadgeAward> = { ...rs.badges };
  let changed = false;

  const ratchet = (id: string, ok: boolean, tier?: number, count?: number) => {
    if (!ok) return;
    const cur = out[id];
    if (!cur) {
      out[id] = { earnedAt: now, tier, count };
      changed = true;
      return;
    }
    const nt = Math.max(cur.tier ?? 0, tier ?? 0) || undefined;
    const nc = Math.max(cur.count ?? 0, count ?? 0) || undefined;
    if (nt !== cur.tier || nc !== cur.count) {
      out[id] = { ...cur, tier: nt, count: nc };
      changed = true;
    }
  };

  const tierOf = (value: number, tiers: number[]): number =>
    tiers.reduce((t, th, i) => (value >= th ? i + 1 : t), 0);

  const eff = effectiveEvents(evts);
  const sprints = eff.filter((e) => e.kind === "sprint").length;
  ratchet("first_light", sprints >= 1);
  ratchet("early_bird", earlySprints(evts) >= 5);

  const feast = frogSprintsInAWeek(evts);
  ratchet("frog_feast", feast >= 1, tierOf(feast, [1, 2, 3]));

  const streak = sprintWorkdayStreak(evts);
  ratchet("momentum", streak >= 5, tierOf(streak, [5, 10, 20]));

  ratchet("marathon", sprintsInADay(evts) >= 6);

  // Close-shaped badges use board/stream context at evaluation time.
  const closes = eff.filter((e) => e.kind === "close");
  let speedRuns = 0;
  for (const c of closes) {
    if (!c.taskId) continue;
    const stream = streams.find((s) => s.taskId === c.taskId);
    if (stream && stream.items.length > 0) {
      if (stream.items.every((i) => i.state === "done")) ratchet("completionist", true);
      if (stream.items.every((i) => i.state !== "open")) ratchet("full_provenance", true);
    }
    for (const p of board.projects) {
      const t = p.tasks.find((x) => x.id === c.taskId);
      if (t && c.at - t.createdAt <= 3600 * 1000) speedRuns++;
    }
  }
  ratchet("speed_run", speedRuns >= 5, tierOf(speedRuns, [5, 25, 50]));

  const planned = asPlannedWeeks(evts);
  ratchet("as_planned", planned >= 1, undefined, planned);

  ratchet("builder", creditsRedeemed(rs) >= 1 || (board.game?.creditsRedeemed ?? 0) >= 1);

  return changed ? out : null;
}
