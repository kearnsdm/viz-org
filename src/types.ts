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
}
