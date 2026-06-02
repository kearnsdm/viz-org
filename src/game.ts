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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Roll the daily counters / streak forward to today before awarding points. */
function rollDay(game: GameState): GameState {
  const today = todayStr();
  if (game.todayDate === today) return game;
  let streak = game.streak;
  if (game.lastActiveDate === yesterdayStr()) streak = game.streak + 1;
  else if (game.lastActiveDate !== today) streak = 1;
  return { ...game, todayDate: today, pointsToday: 0, streak: Math.max(1, streak) };
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
  test: (g: GameState) => boolean;
}

export const BADGES: BadgeDef[] = [
  { id: "first", label: "First Step", emoji: "🌱", hint: "Complete your first task", test: (g) => g.tasksCompleted >= 1 },
  { id: "ten", label: "Rolling", emoji: "🛼", hint: "Complete 10 tasks", test: (g) => g.tasksCompleted >= 10 },
  { id: "frog", label: "Faced the Frog", emoji: "🐸", hint: "Finish a heavy task", test: (g) => g.heavyCompleted >= 1 },
  { id: "heavy5", label: "Heavy Hitter", emoji: "🥊", hint: "Finish 5 heavy tasks", test: (g) => g.heavyCompleted >= 5 },
  { id: "century", label: "Century Day", emoji: "💯", hint: "Earn 100 points in a day", test: (g) => g.bestDayPoints >= 100 },
  { id: "streak3", label: "On a Roll", emoji: "🔥", hint: "3-day streak", test: (g) => g.streak >= 3 },
  { id: "streak7", label: "Unstoppable", emoji: "⚡", hint: "7-day streak", test: (g) => g.streak >= 7 },
  { id: "focus10", label: "Deep Worker", emoji: "🎧", hint: "Finish 10 focus sessions", test: (g) => g.focusSessions >= 10 },
  { id: "credit1", label: "Earned a Build", emoji: "🛠️", hint: "Bank your first Build Credit", test: (g) => Math.floor(g.points / POINTS_PER_CREDIT) >= 1 },
];

function earnBadges(game: GameState): GameState {
  const earned = new Set(game.badges);
  for (const b of BADGES) if (!earned.has(b.id) && b.test(game)) earned.add(b.id);
  return { ...game, badges: [...earned] };
}

/** Record a task completion. No-op if already counted. Returns new game + points awarded. */
export function completeTask(game: GameState, task: Task): { game: GameState; awarded: number } {
  if (game.awardedTaskIds.includes(task.id)) return { game, awarded: 0 };
  const pts = taskPoints(task);
  let g = award(game, pts);
  g = {
    ...g,
    tasksCompleted: g.tasksCompleted + 1,
    heavyCompleted: g.heavyCompleted + (task.heavy ? 1 : 0),
    awardedTaskIds: [...g.awardedTaskIds, task.id],
  };
  return { game: earnBadges(g), awarded: pts };
}

/** Record a finished focus session. */
export function completeFocus(game: GameState): { game: GameState; awarded: number } {
  let g = award(game, FOCUS_POINTS);
  g = { ...g, focusSessions: g.focusSessions + 1 };
  return { game: earnBadges(g), awarded: FOCUS_POINTS };
}
