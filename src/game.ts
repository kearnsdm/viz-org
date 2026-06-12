import type { GameState, Task } from "./types";

// The motivation layer: a small token economy built on behaviorist ideas.
// - Completing work earns points (more for urgent and *heavy*/aversive tasks).
// - Points bank into Build Credits — the reward is the right to keep building
//   viz-org (Premack principle: gate the wanted activity behind the work).
// - Starting counts: a focus session earns points even if the task isn't done,
//   which is what gets you moving on the heavy stuff.

export const POINTS_PER_CREDIT = 100;
export const FOCUS_POINTS = 8;
const POINTS_PER_LEVEL = 120;

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
  // Secret easter eggs (revealed only once unlocked).
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
  const pts = taskPoints(task);
  let g = award(game, pts);
  const wasFirstToday = g.tasksToday === 0;
  g = {
    ...g,
    tasksCompleted: g.tasksCompleted + 1,
    tasksToday: g.tasksToday + 1,
    heavyCompleted: g.heavyCompleted + (task.heavy ? 1 : 0),
    heavyToday: g.heavyToday + (task.heavy ? 1 : 0),
    awardedTaskIds: [...g.awardedTaskIds, task.id],
  };
  g = earnBadges(g);

  const secret: string[] = [];
  const hour = new Date().getHours();
  if (hour < 4) secret.push("nightowl");
  else if (hour < 6) secret.push("earlybird");
  if (ctx.isFrog && wasFirstToday) secret.push("frogfirst");
  if (g.heavyToday >= 3) secret.push("pond");
  if (ctx.overdue) secret.push("late");
  g = addBadges(g, secret);

  return { game: g, awarded: pts };
}

/** Record a finished focus session. */
export function completeFocus(game: GameState): { game: GameState; awarded: number } {
  let g = award(game, FOCUS_POINTS);
  g = { ...g, focusSessions: g.focusSessions + 1, focusToday: g.focusToday + 1 };
  g = earnBadges(g);
  if (g.focusToday >= 3) g = addBadges(g, ["grind"]);
  return { game: g, awarded: FOCUS_POINTS };
}
