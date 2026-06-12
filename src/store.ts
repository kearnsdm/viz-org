import { createContext, useContext } from "react";
import type { AppState, CandidateTask, Project, Task, Urgency } from "./types";
import { addBadges, availableCredits, completeFocus, completeTask, emptyGame, isoDate, taskPoints, withGame } from "./game";

export { isoDate };

export const STORAGE_KEY = "viz-org-state-v1";

export const PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
];

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

/** Slots a project occupies on the board: its allocation, but never less than its task count. */
export function projectWeight(p: Project): number {
  return Math.max(p.capacity, p.tasks.length, 1);
}

/** Total slots currently claimed by all projects. */
export function allocatedSlots(state: AppState): number {
  return state.projects.reduce((s, p) => s + projectWeight(p), 0);
}

/** Free, unallocated board slots — the user's uncommitted time. */
export function freeSlots(state: AppState): number {
  return Math.max(0, state.boardCapacity - allocatedSlots(state));
}

/** Format a minute count as a short human duration, e.g. 90 -> "1h 30m". */
export function formatDuration(min?: number): string {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Total estimated minutes across a project's open (not done) tasks. */
export function projectMinutes(p: Project): number {
  return p.tasks.reduce((s, t) => s + (t.done ? 0 : t.estimateMinutes ?? 0), 0);
}

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return isoDate(d);
}

function makeTask(title: string, opts: Partial<Task> = {}): Task {
  return {
    id: uid("task"),
    title,
    done: false,
    urgency: "normal",
    createdAt: Date.now(),
    source: "manual",
    ...opts,
  };
}

/** Ensure required fields exist on a loaded/imported board (forward-compatible). */
export function normalizeState(s: AppState): AppState {
  return {
    boardCapacity: typeof s.boardCapacity === "number" ? s.boardCapacity : 32,
    projects: Array.isArray(s.projects) ? s.projects : [],
    inbox: Array.isArray(s.inbox) ? s.inbox : [],
    game: withGame(s.game),
    day: s.day && typeof s.day === "object" ? s.day : undefined,
    dayCapacities: s.dayCapacities && typeof s.dayCapacities === "object" ? s.dayCapacities : {},
    seenCandidateIds: Array.isArray(s.seenCandidateIds) ? s.seenCandidateIds : [],
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.projects)) return normalizeState(parsed);
    }
  } catch {
    // fall through to a blank board
  }
  return emptyState();
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence; ignore quota errors
  }
}

export function resetState(): AppState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return emptyState();
}

/** A blank board: no projects or tasks, just an empty Admin catch-all box. */
export function emptyState(): AppState {
  return {
    boardCapacity: 32,
    projects: [
      { id: uid("proj"), name: "Admin", color: "#64748b", capacity: 3, isAdmin: true, tasks: [] },
    ],
    inbox: [],
    game: emptyGame(),
  };
}

// --- Actions -------------------------------------------------------------

export type Action =
  | { type: "addProject"; name: string; capacity: number }
  | { type: "renameProject"; projectId: string; name: string }
  | { type: "setCapacity"; projectId: string; capacity: number }
  | { type: "deleteProject"; projectId: string }
  | { type: "setBoardCapacity"; capacity: number }
  | { type: "addTask"; projectId: string; title: string; urgency?: Urgency; due?: string; estimateMinutes?: number }
  | { type: "toggleTask"; projectId: string; taskId: string }
  | { type: "updateTask"; projectId: string; taskId: string; patch: Partial<Task> }
  | { type: "deleteTask"; projectId: string; taskId: string }
  | { type: "setHeavy"; projectId: string; taskId: string; heavy: boolean }
  | { type: "setFirstStep"; projectId: string; taskId: string; firstStep: string }
  | { type: "focusComplete" }
  | { type: "redeemCredit" }
  | { type: "chooseFrog"; taskId: string }
  | { type: "startDay" }
  | { type: "resetDay" }
  | { type: "setDayCapacity"; minutes: number; date?: string }
  | { type: "scheduleTask"; projectId: string; taskId: string; date?: string }
  | { type: "reorderToday"; ids: string[] }
  | { type: "snoozeTask"; projectId: string; taskId: string; until: string }
  | { type: "snoozeMany"; ids: string[]; until: string }
  | { type: "unsnoozeTask"; projectId: string; taskId: string }
  | { type: "unlockBadge"; badgeId: string }
  | { type: "moveTask"; taskId: string; fromProjectId: string; toProjectId: string }
  | { type: "pullEmail"; candidates: CandidateTask[] }
  | { type: "fileCandidate"; candidateId: string; projectId: string }
  | { type: "dismissCandidate"; candidateId: string }
  | { type: "replaceState"; state: AppState }
  | { type: "clearBoard" }
  | { type: "reset" };

function mapProject(state: AppState, projectId: string, fn: (p: Project) => Project): AppState {
  return { ...state, projects: state.projects.map((p) => (p.id === projectId ? fn(p) : p)) };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "addProject": {
      const color = PALETTE[state.projects.length % PALETTE.length];
      const project: Project = {
        id: uid("proj"),
        name: action.name.trim() || "Untitled project",
        color,
        capacity: Math.max(1, action.capacity),
        tasks: [],
      };
      return { ...state, projects: [...state.projects, project] };
    }
    case "renameProject":
      return mapProject(state, action.projectId, (p) => ({ ...p, name: action.name.trim() || p.name }));
    case "setCapacity":
      return mapProject(state, action.projectId, (p) => ({ ...p, capacity: Math.max(1, action.capacity) }));
    case "deleteProject":
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.projectId || p.isAdmin),
      };
    case "setBoardCapacity":
      return { ...state, boardCapacity: Math.max(1, action.capacity) };
    case "addTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: [
          ...p.tasks,
          makeTask(action.title, {
            urgency: action.urgency ?? "normal",
            due: action.due,
            estimateMinutes: action.estimateMinutes,
          }),
        ],
      }));
    case "toggleTask": {
      const project = state.projects.find((p) => p.id === action.projectId);
      const task = project?.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      const willBeDone = !task.done;
      const next = mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, done: willBeDone } : t)),
      }));
      if (!willBeDone) return next; // un-completing: keep points, no claw-back
      const isFrog = dayFrogId(state) === task.id;
      const overdue = !!task.due && task.due < today();
      const { game, awarded } = completeTask(withGame(state.game), task, { isFrog, overdue });
      let result: AppState = { ...next, game: { ...game, lastAward: { points: awarded, at: Date.now() } } };
      // Clean Sweep: nothing pressing left after clearing at least one task today.
      if (buildDailyPlan(result).length === 0 && (result.game?.tasksToday ?? 0) >= 1) {
        result = { ...result, game: addBadges(result.game!, ["sweep"]) };
      }
      return result;
    }
    case "setHeavy": {
      // Once the day is started, a locked-heavy task can't be un-flagged.
      if (!action.heavy && isDayStarted(state) && (state.day?.lockedHeavy ?? []).includes(action.taskId)) {
        return state;
      }
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, heavy: action.heavy } : t)),
      }));
    }
    case "chooseFrog": {
      const date = today();
      const sameDay = state.day?.date === date;
      const cur = sameDay ? state.day! : { date, started: false, frogTaskId: undefined, lockedHeavy: [] };
      // Toggle: tapping the current frog clears it. The heavy lock is untouched.
      const frogTaskId = cur.frogTaskId === action.taskId ? undefined : action.taskId;
      return { ...state, day: { ...cur, date, frogTaskId } };
    }
    case "startDay": {
      const date = today();
      const sameDay = state.day?.date === date;
      const frogTaskId = sameDay && state.day?.frogTaskId ? state.day.frogTaskId : autoFrogId(state);
      const lockedHeavy = state.projects.flatMap((p) =>
        p.tasks.filter((t) => t.heavy && !t.done).map((t) => t.id),
      );
      return { ...state, day: { date, started: true, frogTaskId, lockedHeavy } };
    }
    case "resetDay":
      return { ...state, day: undefined };
    case "setDayCapacity": {
      const date = action.date ?? today();
      const minutes = Math.max(0, action.minutes);
      const caps = { ...(state.dayCapacities ?? {}) };
      if (minutes > 0) caps[date] = minutes;
      else delete caps[date];
      let next: AppState = { ...state, dayCapacities: caps };
      if (date === today()) {
        // Mirror into the legacy field so older saves/clients stay coherent.
        // 0 means "unset" — store undefined so the input can go back to empty.
        const base = state.day && state.day.date === date ? state.day : { date, started: false, lockedHeavy: [] as string[] };
        next = { ...next, day: { ...base, date, capacityMinutes: minutes > 0 ? minutes : undefined } };
      }
      return next;
    }
    case "scheduleTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, scheduledFor: action.date, snoozeUntil: action.date ? undefined : t.snoozeUntil }
            : t,
        ),
      }));
    case "reorderToday": {
      const date = today();
      const base = state.day && state.day.date === date ? state.day : { date, started: false, lockedHeavy: [] as string[] };
      return { ...state, day: { ...base, date, order: action.ids } };
    }
    case "snoozeTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, snoozeUntil: action.until } : t)),
      }));
    case "snoozeMany": {
      const ids = new Set(action.ids);
      return {
        ...state,
        projects: state.projects.map((p) => ({
          ...p,
          tasks: p.tasks.map((t) => (ids.has(t.id) ? { ...t, snoozeUntil: action.until } : t)),
        })),
      };
    }
    case "unsnoozeTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, snoozeUntil: undefined } : t)),
      }));
    case "setFirstStep":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, firstStep: action.firstStep } : t)),
      }));
    case "focusComplete": {
      const { game, awarded } = completeFocus(withGame(state.game));
      return { ...state, game: { ...game, lastAward: { points: awarded, at: Date.now() } } };
    }
    case "redeemCredit": {
      const game = withGame(state.game);
      if (availableCredits(game) < 1) return state;
      return { ...state, game: addBadges({ ...game, creditsRedeemed: game.creditsRedeemed + 1 }, ["maker"]) };
    }
    case "unlockBadge":
      return { ...state, game: addBadges(withGame(state.game), [action.badgeId]) };
    case "updateTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, ...action.patch } : t)),
      }));
    case "deleteTask":
      return mapProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.filter((t) => t.id !== action.taskId),
      }));
    case "moveTask": {
      const from = state.projects.find((p) => p.id === action.fromProjectId);
      const task = from?.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id === action.fromProjectId) return { ...p, tasks: p.tasks.filter((t) => t.id !== action.taskId) };
          if (p.id === action.toProjectId) return { ...p, tasks: [...p.tasks, task] };
          return p;
        }),
      };
    }
    case "pullEmail": {
      const existing = new Set(state.inbox.map((c) => c.id));
      const seen = new Set(state.seenCandidateIds ?? []);
      const fresh = action.candidates.filter((c) => !existing.has(c.id) && !seen.has(c.id));
      if (fresh.length === 0) return state;
      // Remember ingested ids (capped) so the same batch never imports twice.
      const seenCandidateIds = [...(state.seenCandidateIds ?? []), ...fresh.map((c) => c.id)].slice(-500);
      return { ...state, inbox: [...state.inbox, ...fresh], seenCandidateIds };
    }
    case "fileCandidate": {
      const candidate = state.inbox.find((c) => c.id === action.candidateId);
      if (!candidate) return state;
      const task = makeTask(candidate.title, {
        notes: candidate.notes,
        urgency: candidate.urgency,
        due: candidate.due,
        estimateMinutes: candidate.estimateMinutes,
        link: candidate.link,
        source: "email",
      });
      return {
        ...state,
        inbox: state.inbox.filter((c) => c.id !== action.candidateId),
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, tasks: [...p.tasks, task] } : p,
        ),
      };
    }
    case "dismissCandidate":
      return { ...state, inbox: state.inbox.filter((c) => c.id !== action.candidateId) };
    case "replaceState":
      return normalizeState(action.state);
    case "clearBoard":
      return emptyState();
    case "reset":
      return resetState();
    default:
      return state;
  }
}

// --- Email intake ---------------------------------------------------------
// Candidate tasks arrive from the user's real mailbox via the #capture URL
// (the bookmarklet) or via an import code pasted into Email Intake — e.g.
// action items distilled from email in a Claude chat.

/**
 * Decode an import code into candidate tasks. Accepts either a base64-encoded
 * JSON blob (the standard share format) or raw JSON. Used to bring in real
 * action items prepared elsewhere (e.g. pulled from a mailbox in a chat).
 * Throws if the input can't be parsed.
 */
export function decodeCandidates(input: string): CandidateTask[] {
  const text = input.trim();
  if (!text) return [];
  let json = text;
  // Try base64 first; fall back to treating the input as raw JSON.
  try {
    const bin = atob(text.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes).trim();
    if (decoded.startsWith("[") || decoded.startsWith("{")) json = decoded;
  } catch {
    /* not base64 — treat as raw JSON below */
  }
  const parsed = JSON.parse(json);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const urgencies = new Set<Urgency>(["low", "normal", "high", "urgent"]);
  return arr
    .filter((c) => c && typeof c.title === "string" && c.title.trim())
    .map((c) => ({
      id: typeof c.id === "string" ? c.id : uid("cand"),
      title: String(c.title).trim(),
      notes: typeof c.notes === "string" ? c.notes : undefined,
      urgency: urgencies.has(c.urgency) ? (c.urgency as Urgency) : "normal",
      due: typeof c.due === "string" ? c.due : undefined,
      estimateMinutes:
        typeof c.estimateMinutes === "number"
          ? c.estimateMinutes
          : typeof c.estimate === "number"
            ? c.estimate
            : undefined,
      link: typeof c.link === "string" ? c.link : undefined,
      from: typeof c.from === "string" ? c.from : "Imported",
    }));
}

// --- Backup / transfer between devices -----------------------------------
// The app stores its data only in this browser. To move a board to another
// device, export it to a code here and paste it in there. Same base64-of-JSON
// format as the task import, but it carries the whole board.

export function exportBoard(state: AppState): string {
  const json = JSON.stringify({ v: 1, state });
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** Decode a backup code into a full board state. Throws if it can't be read. */
export function importBoard(code: string): AppState {
  const text = code.trim().replace(/\s+/g, "");
  const bin = atob(text);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  const state = parsed && parsed.state ? parsed.state : parsed;
  if (!state || !Array.isArray(state.projects)) {
    throw new Error("Not a valid board backup code");
  }
  if (typeof state.boardCapacity !== "number") state.boardCapacity = 32;
  if (!Array.isArray(state.inbox)) state.inbox = [];
  if (!state.projects.some((p: Project) => p.isAdmin)) {
    state.projects.push({ id: uid("proj"), name: "Admin", color: "#64748b", capacity: 3, isAdmin: true, tasks: [] });
  }
  return state as AppState;
}

// --- Day plan (the committed frog + heavy picks) -------------------------

export function isDayStarted(state: AppState): boolean {
  return !!state.day && state.day.started && state.day.date === today();
}

/** The chosen frog task id for today, if any. */
export function dayFrogId(state: AppState): string | undefined {
  return state.day && state.day.date === today() ? state.day.frogTaskId : undefined;
}

/** Heavy task ids locked for today (can't be un-flagged). */
export function lockedHeavyIds(state: AppState): string[] {
  return isDayStarted(state) ? state.day?.lockedHeavy ?? [] : [];
}

/** Hours-as-minutes the user can work on a given day (defaults to today). */
export function dayCapacityMinutes(state: AppState, date?: string): number | undefined {
  const d = date ?? today();
  const v = state.dayCapacities?.[d];
  if (typeof v === "number" && v > 0) return v;
  // Legacy location: today's capacity used to live on the day plan.
  if (state.day && state.day.date === d && typeof state.day.capacityMinutes === "number" && state.day.capacityMinutes > 0) {
    return state.day.capacityMinutes;
  }
  return undefined;
}

/** Tasks snoozed out of Today (snoozeUntil is in the future). */
export function snoozedForToday(state: AppState): PlanItem[] {
  const t = today();
  const items: PlanItem[] = [];
  for (const project of state.projects) {
    for (const task of project.tasks) {
      if (!task.done && task.snoozeUntil && task.snoozeUntil > t) items.push({ task, project });
    }
  }
  return items;
}

/** Find a task + its project anywhere on the board. */
export function findTaskItem(state: AppState, taskId: string): PlanItem | null {
  for (const project of state.projects) {
    const task = project.tasks.find((t) => t.id === taskId);
    if (task) return { task, project };
  }
  return null;
}

/** Auto-pick a frog: the heaviest (or otherwise highest-value) pressing task. */
function autoFrogId(state: AppState): string | undefined {
  const plan = buildDailyPlan(state);
  if (plan.length === 0) return undefined;
  const heavy = plan.filter((i) => i.task.heavy);
  const pool = heavy.length ? heavy : plan;
  return [...pool].sort((a, b) => taskPoints(b.task) - taskPoints(a.task))[0]?.task.id;
}

// --- Daily plan ----------------------------------------------------------

export interface PlanItem {
  task: Task;
  project: Project;
}

const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * Build today's plan: open tasks that are overdue, due soon, urgent, or
 * explicitly scheduled for today — pulled from every project (including
 * admin), ordered by what needs attention first. A task scheduled to a
 * *future* day is excluded (it lives in that day's box), and any manual
 * drag-to-reorder order for today is applied last.
 */
export function buildDailyPlan(state: AppState): PlanItem[] {
  const horizon = today(); // overdue or due today — deferring to tomorrow drops it off Today
  const items: PlanItem[] = [];
  for (const project of state.projects) {
    for (const task of project.tasks) {
      if (task.done) continue;
      if (task.scheduledFor && task.scheduledFor > horizon) continue; // planned for a later day
      if (task.snoozeUntil && task.snoozeUntil > horizon) continue; // snoozed out of Today
      const dueSoon = task.due ? task.due <= horizon : false;
      const pressing = task.urgency === "urgent" || task.urgency === "high";
      const plannedToday = !!task.scheduledFor && task.scheduledFor <= horizon;
      if (dueSoon || pressing || plannedToday) items.push({ task, project });
    }
  }
  items.sort((a, b) => {
    const ad = a.task.due ?? "9999-99-99";
    const bd = b.task.due ?? "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return URGENCY_RANK[a.task.urgency] - URGENCY_RANK[b.task.urgency];
  });
  const order = state.day?.date === horizon ? state.day.order : undefined;
  if (order && order.length) {
    const idx = new Map(order.map((id, i) => [id, i] as const));
    // Stable sort: dragged tasks keep their chosen spots, the rest keep the
    // default urgency/due order after them.
    items.sort(
      (a, b) =>
        (idx.get(a.task.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.task.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return items;
}

// --- Week strip (day boxes) -----------------------------------------------

export type DayBoxReason = "scheduled" | "snoozed" | "due";

export interface DayBoxItem extends PlanItem {
  /** Why the task appears in this day's box. */
  reason: DayBoxReason;
}

/**
 * Open tasks that belong to a given future day's box: explicitly scheduled
 * there, snoozed until then, or due that day (shown as a ghost so the load is
 * honest even before you've planned it).
 */
export function tasksForDay(state: AppState, date: string): DayBoxItem[] {
  const items: DayBoxItem[] = [];
  for (const project of state.projects) {
    for (const task of project.tasks) {
      if (task.done) continue;
      let reason: DayBoxReason | null = null;
      if (task.scheduledFor === date) reason = "scheduled";
      else if (!task.scheduledFor && task.snoozeUntil === date) reason = "snoozed";
      else if (!task.scheduledFor && task.due === date && (!task.snoozeUntil || task.snoozeUntil <= date)) reason = "due";
      if (reason) items.push({ task, project, reason });
    }
  }
  const rank: Record<DayBoxReason, number> = { scheduled: 0, snoozed: 1, due: 2 };
  items.sort((a, b) => rank[a.reason] - rank[b.reason]);
  return items;
}

// --- React context -------------------------------------------------------

export interface StoreContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
}

export const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
