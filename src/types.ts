// The domain model for viz-org.
//
// The central metaphor: the *board* is the user's entire available work time.
// It is filled with *projects* (boxes). A project's size on the board is driven
// by how much it holds — the number of tasks plus any extra space the user has
// chosen to *allocate* (reserve) for future planning. Empty allocated space is
// an invitation to plan.

export type Urgency = "low" | "normal" | "high" | "urgent";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  done: boolean;
  urgency: Urgency;
  /** ISO date string (yyyy-mm-dd) the task is due, if any. */
  due?: string;
  /** Estimated time to do this task, in minutes. */
  estimateMinutes?: number;
  /** Flagged as emotionally heavy / aversive — earns bonus points. */
  heavy?: boolean;
  /** The smallest 2-minute first move, captured to lower activation energy. */
  firstStep?: string;
  /** Deep link back to the source (e.g. the email this came from). */
  link?: string;
  /** Hidden from "Today" until this date (yyyy-mm-dd) — a soft snooze that
   * doesn't change the real due date. */
  snoozeUntil?: string;
  /** The day (yyyy-mm-dd) the user has planned to do this — places the task in
   * that day's box on the week strip. Independent of the due date. */
  scheduledFor?: string;
  createdAt: number;
  /** Where the task came from, e.g. "email", "manual". */
  source?: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  /**
   * Slots the user has allocated to this project on the board. The box area is
   * proportional to `max(capacity, tasks.length)`. Allocating more capacity
   * than there are tasks reserves empty, plannable space.
   */
  capacity: number;
  /** A project that cannot be deleted and receives loose/admin tasks. */
  isAdmin?: boolean;
  tasks: Task[];
}

export interface CandidateTask {
  id: string;
  title: string;
  notes?: string;
  /** A short hint about which project this might belong to. */
  suggestedProjectId?: string;
  urgency: Urgency;
  due?: string;
  /** Estimated time to do this task, in minutes. */
  estimateMinutes?: number;
  /** Deep link back to the source email. */
  link?: string;
  /** The email subject / sender this candidate was distilled from. */
  from: string;
}

export interface AppState {
  /**
   * Total slots the board represents — the ceiling of the user's available
   * work time. Unused slots show up as free/unallocated space on the board.
   */
  boardCapacity: number;
  projects: Project[];
  /** Candidate tasks pulled from email, awaiting filing into a project. */
  inbox: CandidateTask[];
  /** Token-economy / motivation state. Optional so older saves still load. */
  game?: GameState;
  /** Today's committed plan: the locked frog + heavy picks. */
  day?: DayPlan;
  /** Hours-as-minutes available per day (yyyy-mm-dd), for the week strip. */
  dayCapacities?: Record<string, number>;
  /** Candidate ids already ingested once — guards the gist drop box (and any
   * re-pasted import) against double-importing the same tasks. */
  seenCandidateIds?: string[];
  /** v2: total weekly work hours the board's time budget represents. */
  weeklyHours?: number;
}

export interface DayPlan {
  /** yyyy-mm-dd this plan is for. */
  date: string;
  /** Once started, the frog + heavy picks are locked for the day. */
  started: boolean;
  /** The chosen "frog" (do-first) task id. */
  frogTaskId?: string;
  /** Heavy task ids locked in at start — can't be un-flagged today. */
  lockedHeavy: string[];
  /** Hours-as-minutes the user says they can work today. */
  capacityMinutes?: number;
  /** Manual ordering of today's list (task ids, drag-to-reorder). */
  order?: string[];
}

export interface GameState {
  /** Lifetime points earned. */
  points: number;
  tasksCompleted: number;
  heavyCompleted: number;
  focusSessions: number;
  /** Build Credits already redeemed (spent on building viz-org). */
  creditsRedeemed: number;
  /** Consecutive active days. */
  streak: number;
  /** yyyy-mm-dd of the most recent activity. */
  lastActiveDate?: string;
  /** Points earned so far today, and the day they belong to. */
  pointsToday: number;
  todayDate?: string;
  /** Per-day counters (reset each day) for streaky / easter-egg badges. */
  tasksToday: number;
  heavyToday: number;
  focusToday: number;
  /** Best single-day point total. */
  bestDayPoints: number;
  /** Earned badge ids. */
  badges: string[];
  /** Task ids already counted, so re-checking doesn't double-award. */
  awardedTaskIds: string[];
  /** Transient: the most recent award, for showing a points toast. */
  lastAward?: { points: number; at: number };
  /** Transient: the most recently unlocked badge, for a celebratory toast. */
  lastBadge?: { id: string; at: number };
  // --- v2 reinforcement extras (optional; older saves backfill to 0/[]). ---
  /** Total estimated minutes of finished work. */
  minutesCompleted?: number;
  /** Lifetime points that came from surprise "lucky" drops. */
  luckyTotal?: number;
  /** Lifetime points that came from back-to-back combos. */
  comboTotal?: number;
  /** Current back-to-back combo length. */
  comboCount?: number;
  /** Longest combo ever reached. */
  comboBest?: number;
  /** Epoch ms of the last completion (drives the combo window). */
  lastCompleteAt?: number;
  /** A ledger of completed work: newest first, capped. */
  ledger?: LedgerEntry[];
  /** Transient: most recent lucky drop, for a special toast. */
  lastLucky?: { points: number; at: number };
  /** Transient: most recent combo bump, for a special toast. */
  lastCombo?: { count: number; bonus: number; at: number };
}

/** One completed task in the points ledger. */
export interface LedgerEntry {
  id: string;
  title: string;
  /** Total points awarded (base + bonuses). */
  points: number;
  /** Base points from effort/urgency/heavy. */
  base: number;
  /** Surprise lucky bonus, if any. */
  lucky: number;
  /** Combo bonus, if any. */
  combo: number;
  at: number;
}
