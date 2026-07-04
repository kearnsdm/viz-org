import type { GameState, LedgerEntry, Task } from "./types";

// The motivation layer: a small token economy built on behaviorist ideas.
// - Completing work earns points (more for urgent and *heavy*/aversive tasks).
// - Points bank into Build Credits — the reward is the right to keep building
//   viz-org (Premack principle: gate the wanted activity behind the work).
// - Starting counts: a focus session earns points even if the task isn't done,
//   which is what gets you moving on the heavy stuff.

export const POINTS_PER_CREDIT = 100;
export const FOCUS_POINTS = 8;
/** v3 contract: the first completed sprint of the day pays double. */
export const FIRST_SPRINT_POINTS = 16;
/** v3 contract: each checked component pays +2, capped at the task's value. */
export const COMPONENT_POINTS = 2;
const POINTS_PER_LEVEL = 120;

// Surprise mechanics (the "unannounced" reinforcement).
/** Chance a finished task pays a surprise bonus. */
const LUCKY_CHANCE = 0.13;
/** Finish another task within this window to extend a combo. */
const COMBO_WINDOW_MS = 12 * 60 * 1000;

export function emptyGame(): GameState {
  return {
    points: 0,
    tasksCompleted: 0,
    heavyCompleted: 0,
    focusSessions: 0,
    creditsRedeemed: 0,
    streak: 0,
    pointsToday: 0,
    tasksToday: 0,
    heavyToday: 0,
    focusToday: 0,
    bestDayPoints: 0,
    badges: [],
    awardedTaskIds: [],
    minutesCompleted: 0,
    luckyTotal: 0,
    comboTotal: 0,
    comboCount: 0,
    comboBest: 0,
    ledger: [],
  };
}

/** Fill in any missing game fields (older saved/imported boards). */
export function withGame(game?: GameState): GameState {
  return { ...emptyGame(), ...(game ?? {}) };
}

/** Points a task is worth: effort (from estimate) + urgency + a heavy bonus. */
export function taskPoints(task: Task): number {
  const effort = Math.max(5, Math.round((task.estimateMinutes ?? 30) / 6));
  const urgencyBonus = task.urgency === "urgent" ? 5 : task.urgency === "high" ? 3 : 0;
  const heavyBonus = task.heavy ? 15 : 0;
  return effort + urgencyBonus + heavyBonus;
}

export function level(points: number): number {
  return Math.floor(points / POINTS_PER_LEVEL) + 1;
}

/** Build Credits available to spend right now. */
export function availableCredits(game: GameState): number {
  return Math.floor(game.points / POINTS_PER_CREDIT) - game.creditsRedeemed;
}

/** Points still needed before the next Build Credit. */
export function pointsToNextCredit(game: GameState): number {
  return POINTS_PER_CREDIT - (game.points % POINTS_PER_CREDIT);
}

/** A Date as a local yyyy-mm-dd string. (Not toISOString — that's UTC, which
 * rolls the app's "today" over hours early in the evening US-time.) */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
  return isoDate(new Date());
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

/** Roll the daily counters / streak forward to today before awarding points. */
function rollDay(game: GameState): GameState {
  const today = todayStr();
  if (game.todayDate === today) return game;
  let streak = game.streak;
  if (game.lastActiveDate === yesterdayStr()) streak = game.streak + 1;
  else if (game.lastActiveDate !== today) streak = 1;
  return {
    ...game,
    todayDate: today,
    pointsToday: 0,
    tasksToday: 0,
    heavyToday: 0,
    focusToday: 0,
    streak: Math.max(1, streak),
  };
}

function award(game: GameState, pts: number): GameState {
  const rolled = rollDay(game);
  const pointsToday = rolled.pointsToday + pts;
  return {
    ...rolled,
    points: rolled.points + pts,
    pointsToday,
    bestDayPoints: Math.max(rolled.bestDayPoints, pointsToday),
    lastActiveDate: todayStr(),
  };
}

export interface BadgeDef {
  id: string;
  label: string;
  emoji: string;
  hint: string;
  /** Hidden until earned (shown as ❓). Awarded by events, not by `test`. */
  secret?: boolean;
  test: (g: GameState) => boolean;
}

const never = () => false;

export const BADGES: BadgeDef[] = [
  // Visible milestones.
  { id: "first", label: "First Step", emoji: "🌱", hint: "Complete your first task", test: (g) => g.tasksCompleted >= 1 },
  { id: "ten", label: "Rolling", emoji: "🛼", hint: "Complete 10 tasks", test: (g) => g.tasksCompleted >= 10 },
  { id: "frog", label: "Faced the Frog", emoji: "🐸", hint: "Finish a heavy task", test: (g) => g.heavyCompleted >= 1 },
  { id: "heavy5", label: "Heavy Hitter", emoji: "🥊", hint: "Finish 5 heavy tasks", test: (g) => g.heavyCompleted >= 5 },
  { id: "century", label: "Century Day", emoji: "💯", hint: "Earn 100 points in a day", test: (g) => g.bestDayPoints >= 100 },
  { id: "streak3", label: "On a Roll", emoji: "🔥", hint: "3-day streak", test: (g) => g.streak >= 3 },
  { id: "streak7", label: "Unstoppable", emoji: "⚡", hint: "7-day streak", test: (g) => g.streak >= 7 },
  { id: "focus10", label: "Deep Worker", emoji: "🎧", hint: "Finish 10 focus sessions", test: (g) => g.focusSessions >= 10 },
  { id: "credit1", label: "Earned a Build", emoji: "🛠️", hint: "Bank your first Build Credit", test: (g) => Math.floor(g.points / POINTS_PER_CREDIT) >= 1 },
  // More milestones (v2).
  { id: "fifty", label: "Half Century", emoji: "🏅", hint: "Complete 50 tasks", test: (g) => g.tasksCompleted >= 50 },
  { id: "timelord", label: "Time Lord", emoji: "⏳", hint: "Finish 10 hours of work", test: (g) => (g.minutesCompleted ?? 0) >= 600 },
  { id: "marathon", label: "Marathon Day", emoji: "🏃", hint: "300 points in one day", test: (g) => g.bestDayPoints >= 300 },
  { id: "vault", label: "The Vault", emoji: "🏦", hint: "1,000 lifetime points", test: (g) => g.points >= 1000 },
  { id: "fortnight", label: "Fortnight", emoji: "🌟", hint: "14-day streak", test: (g) => g.streak >= 14 },
  // Secret easter eggs (revealed only once unlocked).
  { id: "lucky", label: "Lucky Drop", emoji: "🍀", hint: "Caught a surprise bonus", secret: true, test: never },
  { id: "combo3", label: "Hat Trick", emoji: "🎰", hint: "Three finishes in a row, fast", secret: true, test: never },
  { id: "combo5", label: "On Fire", emoji: "🚀", hint: "A five-task combo", secret: true, test: never },
  { id: "nightowl", label: "Night Owl", emoji: "🦉", hint: "Finished something after midnight", secret: true, test: never },
  { id: "earlybird", label: "Early Bird", emoji: "🐦", hint: "Finished something before 6am", secret: true, test: never },
  { id: "frogfirst", label: "Frog Legs", emoji: "🐸", hint: "Ate the frog first thing", secret: true, test: never },
  { id: "pond", label: "Cleared the Pond", emoji: "🌊", hint: "3 heavy tasks in one day", secret: true, test: never },
  { id: "late", label: "Better Late", emoji: "⏰", hint: "Finished an overdue task", secret: true, test: never },
  { id: "sweep", label: "Clean Sweep", emoji: "🧹", hint: "Cleared the whole day", secret: true, test: never },
  { id: "grind", label: "In the Zone", emoji: "🎯", hint: "3 focus sprints in a day", secret: true, test: never },
  { id: "maker", label: "Maker", emoji: "🧱", hint: "Redeemed a build session", secret: true, test: never },
  { id: "peekaboo", label: "Peekaboo", emoji: "👀", hint: "You found the secret", secret: true, test: never },
];

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}

/** Add badge ids, recording the first new one for a celebratory toast. */
export function addBadges(game: GameState, ids: string[]): GameState {
  const have = new Set(game.badges);
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length === 0) return game;
  return { ...game, badges: [...game.badges, ...fresh], lastBadge: { id: fresh[0], at: Date.now() } };
}

function earnBadges(game: GameState): GameState {
  return addBadges(
    game,
    BADGES.filter((b) => !b.secret && b.test(game)).map((b) => b.id),
  );
}

export interface CompleteContext {
  isFrog?: boolean;
  overdue?: boolean;
}

/** Record a task completion. No-op if already counted. Returns new game + points awarded. */
export function completeTask(game: GameState, task: Task, ctx: CompleteContext = {}): { game: GameState; awarded: number } {
  if (game.awardedTaskIds.includes(task.id)) return { game, awarded: 0 };
  const base = taskPoints(task);
  const now = Date.now();

  // Combo: another finish soon after the last one extends a streak; from the
  // third in a row it starts paying a small escalating bonus.
  const within = !!game.lastCompleteAt && now - game.lastCompleteAt <= COMBO_WINDOW_MS;
  const comboCount = within ? (game.comboCount ?? 1) + 1 : 1;
  const comboBonus = comboCount >= 3 ? (comboCount - 2) * 5 : 0;

  // Lucky drop: an occasional, unannounced surprise bonus.
  const lucky = Math.random() < LUCKY_CHANCE ? 10 + Math.floor(Math.random() * 31) : 0;

  const total = base + comboBonus + lucky;
  let g = award(game, total);
  const wasFirstToday = g.tasksToday === 0;
  const est = task.estimateMinutes ?? 30;
  const effort = Math.max(5, Math.round(est / 6));
  const tags = [`${effort} effort`];
  if (task.urgency === "urgent") tags.push("urgent +5");
  else if (task.urgency === "high") tags.push("high +3");
  if (task.heavy) tags.push("🔥 frog +15");
  if (comboBonus) tags.push(`🎰 combo +${comboBonus}`);
  if (lucky) tags.push(`🍀 lucky +${lucky}`);
  const entry: LedgerEntry = { id: task.id, title: task.title, points: total, base, lucky, combo: comboBonus, at: now, tags };
  g = {
    ...g,
    tasksCompleted: g.tasksCompleted + 1,
    tasksToday: g.tasksToday + 1,
    heavyCompleted: g.heavyCompleted + (task.heavy ? 1 : 0),
    heavyToday: g.heavyToday + (task.heavy ? 1 : 0),
    minutesCompleted: (g.minutesCompleted ?? 0) + est,
    luckyTotal: (g.luckyTotal ?? 0) + lucky,
    comboTotal: (g.comboTotal ?? 0) + comboBonus,
    comboCount,
    comboBest: Math.max(g.comboBest ?? 0, comboCount),
    lastCompleteAt: now,
    awardedTaskIds: [...g.awardedTaskIds, task.id],
    ledger: [entry, ...(g.ledger ?? [])].slice(0, 200),
  };
  if (lucky) g = { ...g, lastLucky: { points: lucky, at: now } };
  if (comboBonus) g = { ...g, lastCombo: { count: comboCount, bonus: comboBonus, at: now } };
  g = earnBadges(g);

  const secret: string[] = [];
  const hour = new Date().getHours();
  if (hour < 4) secret.push("nightowl");
  else if (hour < 6) secret.push("earlybird");
  if (ctx.isFrog && wasFirstToday) secret.push("frogfirst");
  if (g.heavyToday >= 3) secret.push("pond");
  if (ctx.overdue) secret.push("late");
  if (lucky) secret.push("lucky");
  if (comboCount >= 3) secret.push("combo3");
  if (comboCount >= 5) secret.push("combo5");
  g = addBadges(g, secret);

  return { game: g, awarded: total };
}

/** A rough split of where lifetime points came from, for the dashboard. */
export function pointsBreakdown(game: GameState): { label: string; points: number; color: string }[] {
  const focus = game.focusSessions * FOCUS_POINTS;
  const lucky = game.luckyTotal ?? 0;
  const combo = game.comboTotal ?? 0;
  const work = Math.max(0, game.points - focus - lucky - combo);
  return [
    { label: "Task work", points: work, color: "#6366f1" },
    { label: "Focus sprints", points: focus, color: "#0ea5e9" },
    { label: "Combos", points: combo, color: "#f59e0b" },
    { label: "Lucky drops", points: lucky, color: "#10b981" },
  ].filter((s) => s.points > 0);
}

/** Record a finished focus session. The first sprint of the day pays double. */
export function completeFocus(game: GameState): { game: GameState; awarded: number } {
  const rolled = rollDay(game);
  const first = rolled.focusToday === 0;
  const pts = first ? FIRST_SPRINT_POINTS : FOCUS_POINTS;
  let g = award(rolled, pts);
  const entry: LedgerEntry = {
    id: `spr_${Date.now().toString(36)}`,
    title: "Focus sprint completed",
    points: pts,
    base: pts,
    lucky: 0,
    combo: 0,
    at: Date.now(),
    tags: first ? ["showed up", "first of day ×2"] : ["showed up"],
  };
  g = {
    ...g,
    focusSessions: g.focusSessions + 1,
    focusToday: g.focusToday + 1,
    ledger: [entry, ...(g.ledger ?? [])].slice(0, 200),
  };
  g = earnBadges(g);
  if (g.focusToday >= 3) g = addBadges(g, ["grind"]);
  return { game: g, awarded: pts };
}

// --- v3: component checks (+2 per step, capped at the task's value) --------

/** Award a checked component step. Pays +2 until the task's own value is
 * exhausted, then further checks pay nothing (the cap keeps step-splitting
 * from inflating a task past what finishing it is worth). */
export function checkComponent(game: GameState, task: Task, label: string): { game: GameState; awarded: number } {
  const tally = game.componentPointsByTask?.[task.id] ?? 0;
  const cap = taskPoints(task);
  const pay = Math.max(0, Math.min(COMPONENT_POINTS, cap - tally));
  const byTask = { ...(game.componentPointsByTask ?? {}), [task.id]: tally + pay };
  let g = pay > 0 ? award(game, pay) : rollDay(game);
  const entry: LedgerEntry = {
    id: `cmp_${task.id}_${Date.now().toString(36)}`,
    title: `Step: ${label}`,
    points: pay,
    base: pay,
    lucky: 0,
    combo: 0,
    at: Date.now(),
    tags: ["component"],
  };
  g = { ...g, componentPointsByTask: byTask, ledger: [entry, ...(g.ledger ?? [])].slice(0, 200) };
  return { game: g, awarded: pay };
}

/** Reverse the most recent component award for a task (an unchecked step). */
export function uncheckComponent(game: GameState, task: Task, label: string): GameState {
  const tally = game.componentPointsByTask?.[task.id] ?? 0;
  const back = Math.min(COMPONENT_POINTS, tally);
  const byTask = { ...(game.componentPointsByTask ?? {}), [task.id]: Math.max(0, tally - back) };
  const ledger = [...(game.ledger ?? [])];
  const i = ledger.findIndex((e) => e.title === `Step: ${label}`);
  if (i > -1) ledger.splice(i, 1);
  return {
    ...game,
    points: Math.max(0, game.points - back),
    pointsToday: Math.max(0, game.pointsToday - back),
    componentPointsByTask: byTask,
    ledger,
  };
}

// --- v3: undo a completion (the Undo toast beats a confirm dialog) ---------

/** Fully reverse a task-completion award, so board-hover completes are safely
 * undoable. Inverse of completeTask for everything it counted. */
export function reverseCompletion(game: GameState, task: Task): GameState {
  if (!game.awardedTaskIds.includes(task.id)) return game;
  const entry = (game.ledger ?? []).find((e) => e.id === task.id);
  const pts = entry?.points ?? taskPoints(task);
  const est = task.estimateMinutes ?? 30;
  return {
    ...game,
    points: Math.max(0, game.points - pts),
    pointsToday: Math.max(0, game.pointsToday - pts),
    tasksCompleted: Math.max(0, game.tasksCompleted - 1),
    tasksToday: Math.max(0, game.tasksToday - 1),
    heavyCompleted: Math.max(0, game.heavyCompleted - (task.heavy ? 1 : 0)),
    heavyToday: Math.max(0, game.heavyToday - (task.heavy ? 1 : 0)),
    minutesCompleted: Math.max(0, (game.minutesCompleted ?? 0) - est),
    luckyTotal: Math.max(0, (game.luckyTotal ?? 0) - (entry?.lucky ?? 0)),
    comboTotal: Math.max(0, (game.comboTotal ?? 0) - (entry?.combo ?? 0)),
    awardedTaskIds: game.awardedTaskIds.filter((id) => id !== task.id),
    ledger: (game.ledger ?? []).filter((e) => e.id !== task.id),
  };
}

// --- v3: ranks — certify practice, never attendance ------------------------
// Advance on points AND demonstrated practice (frogs, sprints, builds).
// Ranks never decay (all inputs are lifetime counters); perks are expressive
// only — themes and glyph packs, never function. DRAFT ladder, Devin to ratify.

export interface RankReq {
  label: string;
  have: (g: GameState) => number;
  need: number;
}

export interface RankDef {
  name: string;
  motto: string;
  reqs: RankReq[];
  perk?: string;
}

export const RANKS: RankDef[] = [
  { name: "Clerk of Intake", motto: "you capture what arrives", reqs: [] },
  {
    name: "List Keeper",
    motto: "you finish what you list",
    reqs: [
      { label: "120 pts", have: (g) => g.points, need: 120 },
      { label: "10 tasks completed", have: (g) => g.tasksCompleted, need: 10 },
    ],
  },
  {
    name: "Box Builder",
    motto: "you shape work into projects",
    reqs: [
      { label: "240 pts", have: (g) => g.points, need: 240 },
      { label: "1 credit banked", have: (g) => Math.floor(g.points / POINTS_PER_CREDIT), need: 1 },
    ],
  },
  {
    name: "Frog Handler",
    motto: "you face heavy work on purpose",
    reqs: [
      { label: "360 pts", have: (g) => g.points, need: 360 },
      { label: "3 frogs eaten", have: (g) => g.heavyCompleted, need: 3 },
    ],
  },
  {
    name: "Cartographer",
    motto: "you navigate the whole landscape",
    perk: "Slate board theme",
    reqs: [
      { label: "480 pts", have: (g) => g.points, need: 480 },
      { label: "5 frogs eaten", have: (g) => g.heavyCompleted, need: 5 },
      { label: "5 sprints finished", have: (g) => g.focusSessions, need: 5 },
      { label: "2 builds redeemed", have: (g) => g.creditsRedeemed, need: 2 },
    ],
  },
  {
    name: "Frogkeeper",
    motto: "heavy work is routine, not crisis",
    perk: "Field-Notes glyph pack + Dawn theme",
    reqs: [
      { label: "720 pts", have: (g) => g.points, need: 720 },
      { label: "10 frogs eaten", have: (g) => g.heavyCompleted, need: 10 },
      { label: "12 sprints finished", have: (g) => g.focusSessions, need: 12 },
      { label: "4 builds redeemed", have: (g) => g.creditsRedeemed, need: 4 },
    ],
  },
  {
    name: "Landscape Architect",
    motto: "you redesign how the work flows",
    perk: "custom codename word bank",
    reqs: [
      { label: "1,000 pts", have: (g) => g.points, need: 1000 },
      { label: "15 frogs eaten", have: (g) => g.heavyCompleted, need: 15 },
      { label: "6 builds redeemed", have: (g) => g.creditsRedeemed, need: 6 },
    ],
  },
];

/** Highest rank whose every requirement is met (ranks never decay in practice
 * because all inputs are lifetime counters). */
export function rankIndex(g: GameState): number {
  let idx = 0;
  for (let i = 1; i < RANKS.length; i++) {
    if (RANKS[i].reqs.every((r) => r.have(g) >= r.need)) idx = i;
    else break;
  }
  return idx;
}
