import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Board } from "./components/Board";
import { BoardV2 } from "./components/BoardV2";
import { EmailIntake } from "./components/EmailIntake";
import { ProjectPanel } from "./components/ProjectPanel";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { SyncDialog } from "./components/SyncDialog";
import { TodayView } from "./components/TodayView";
import { TodayV2 } from "./components/TodayV2";
import { Dashboard } from "./components/Dashboard";
import { BoardV3 } from "./components/BoardV3";
import { WeekV3 } from "./components/WeekV3";
import { TaskSheet } from "./components/TaskSheet";
import { ProjectViewV3 } from "./components/ProjectViewV3";
import { ArchiveV3 } from "./components/ArchiveV3";
import { AnalysisV3 } from "./components/AnalysisV3";
import { RewardsV3 } from "./components/RewardsV3";
import { IntakeV3 } from "./components/IntakeV3";
import { FocusV3 } from "./components/FocusV3";
import {
  STORAGE_KEY,
  StoreContext,
  decodeCandidates,
  dueHeldItems,
  findTaskItem,
  formatDuration,
  isoDate,
  loadState,
  normalizeState,
  reducer,
  saveState,
  taskMinutes,
  uid,
  useStore,
  type Action,
  type PlanItem,
} from "./store";
import { StreamsContext, loadStreams, saveStreams, streamsReducer } from "./streams";
import {
  REINF_STORAGE_KEY,
  ReinforcementContext,
  emptyReinforcement,
  loadReinforcement,
  reinforcementReducer,
  saveReinforcement,
} from "./reinforcement";
import { RankRail } from "./components/RankRail";
import type { AppState, Project, Urgency } from "./types";

const UI_VERSION_KEY = "viz-org-ui";
import { availableCredits, badgeById, level, withGame } from "./game";
import {
  DEFAULT_RELAY_URL,
  RelayAuthError,
  StaleWriteError,
  SyncBusyError,
  SyncContext,
  clearInbox,
  loadSyncConfig,
  pullBoard,
  pullBoardRetrying,
  pullInbox,
  pullReinforcement,
  pullRevs,
  pullStreams,
  pushDocs,
  saveSyncConfig,
  testRelay,
  useSync,
  type DocRevs,
  type SyncConfig,
  type SyncStatus,
} from "./sync";

function Header({
  onAddProject,
  onSync,
  version,
  onToggleVersion,
}: {
  onAddProject: () => void;
  onSync: () => void;
  version: UiVersion;
  onToggleVersion: () => void;
}) {
  const { state, dispatch } = useStore();
  const game = withGame(state.game);
  const pokes = useRef(0);
  const pokeLogo = () => {
    pokes.current += 1;
    if (pokes.current >= 5) {
      dispatch({ type: "unlockBadge", badgeId: "peekaboo" });
      pokes.current = 0;
    }
  };
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" onClick={pokeLogo} title="viz-org" style={{ cursor: "pointer" }}>
          ▦
        </span>
        <div>
          <h1>viz-org</h1>
          <p className="tagline">Your work world, as a board of time.</p>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="btn btn-ghost ver-toggle"
          onClick={onToggleVersion}
          title={version === "v2" ? "Switch back to the Classic interface" : "Try the new v2 interface"}
        >
          {version === "v2" ? "v2 ✦" : "Classic"}
        </button>
        <span className="game-chip" title="Points · level · build credits ready">
          ⚡ {game.points} · Lvl {level(game.points)} · {availableCredits(game)}🛠️
        </span>
        <button className="btn btn-primary" onClick={onAddProject}>
          + New project
        </button>
        <button
          className="btn btn-ghost"
          title="Remove all projects and tasks, leaving a blank board"
          onClick={() => {
            if (confirm("Clear the board? This removes every project and task (an empty Admin box stays). This can't be undone.")) {
              dispatch({ type: "clearBoard" });
            }
          }}
        >
          Clear board
        </button>
        <button className="btn btn-ghost" title="Back up or move your board to another device" onClick={onSync}>
          Backup / Sync
        </button>
      </div>
    </header>
  );
}

function PointsToast() {
  const { state } = useStore();
  const at = state.game?.lastAward?.at;
  const pts = state.game?.lastAward?.points ?? 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShow(true);
    const id = setTimeout(() => setShow(false), 2400);
    return () => clearTimeout(id);
  }, [at]);
  if (!show || !pts) return null;
  return <div className="toast">+{pts} pts ⚡</div>;
}

function BadgeToast() {
  const { state } = useStore();
  const at = state.game?.lastBadge?.at;
  const id = state.game?.lastBadge?.id;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 3600);
    return () => clearTimeout(t);
  }, [at]);
  const badge = id ? badgeById(id) : undefined;
  if (!show || !badge) return null;
  return (
    <div className="toast toast-badge">
      <span className="toast-badge__emoji">{badge.emoji}</span>
      <span>
        <strong>{badge.label}</strong> unlocked!
        <br />
        <span className="muted">{badge.hint}</span>
      </span>
    </div>
  );
}

const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

type UiVersion = "classic" | "v2" | "v3";

/** Shared #capture handler: drops a pre-filled candidate into Email Intake. */
function useCaptureUrl(onArrive: () => void) {
  const { dispatch } = useStore();
  useEffect(() => {
    const handle = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#capture")) return;
      const q = hash.indexOf("?");
      const params = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : "");
      history.replaceState(null, "", window.location.pathname + window.location.search);
      const title = params.get("title")?.trim();
      if (!title) return;
      const urgency = params.get("urgency") as Urgency | null;
      const due = params.get("due");
      const estimate = Number(params.get("estimate"));
      dispatch({
        type: "pullEmail",
        candidates: [
          {
            id: uid("cand"),
            title,
            notes: params.get("notes")?.trim() || undefined,
            urgency: urgency && URGENCIES.includes(urgency) ? urgency : "normal",
            due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined,
            estimateMinutes: Number.isFinite(estimate) && estimate > 0 ? estimate : undefined,
            link: params.get("link")?.trim() || undefined,
            from: params.get("from")?.trim() || "Captured from email",
          },
        ],
      });
      onArrive();
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);
}

function Workspace({ version, onToggleVersion }: { version: UiVersion; onToggleVersion: () => void }) {
  const [tab, setTab] = useState<"today" | "board">("today");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  useCaptureUrl(() => setTab("board"));

  return (
    <div className="app">
      <Header onAddProject={() => setAddOpen(true)} onSync={() => setSyncOpen(true)} version={version} onToggleVersion={onToggleVersion} />
      <nav className="tabbar">
        <button className={`tab ${tab === "today" ? "is-active" : ""}`} onClick={() => setTab("today")}>
          Today
        </button>
        <button className={`tab ${tab === "board" ? "is-active" : ""}`} onClick={() => setTab("board")}>
          Board
        </button>
      </nav>
      {tab === "board" ? (
        <main className="layout">
          <section className="board-column">
            <Board onOpenProject={setActiveProjectId} onAddProject={() => setAddOpen(true)} />
          </section>
          <aside className="side-column">
            <EmailIntake />
          </aside>
        </main>
      ) : (
        <main className="layout layout--single">
          <TodayView onOpenProject={setActiveProjectId} />
        </main>
      )}
      {activeProjectId && <ProjectPanel projectId={activeProjectId} onClose={() => setActiveProjectId(null)} />}
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      <PointsToast />
      <BadgeToast />
    </div>
  );
}

function WorkspaceV2({ version, onToggleVersion }: { version: UiVersion; onToggleVersion: () => void }) {
  const [tab, setTab] = useState<"board" | "week" | "rewards">("board");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  useCaptureUrl(() => setTab("board"));

  return (
    <div className="app">
      <Header onAddProject={() => setAddOpen(true)} onSync={() => setSyncOpen(true)} version={version} onToggleVersion={onToggleVersion} />
      <nav className="tabbar tabbar--v2">
        <button className={`tab ${tab === "board" ? "is-active" : ""}`} onClick={() => setTab("board")}>
          🗺️ Board
        </button>
        <button className={`tab ${tab === "week" ? "is-active" : ""}`} onClick={() => setTab("week")}>
          📅 Week
        </button>
        <button className={`tab ${tab === "rewards" ? "is-active" : ""}`} onClick={() => setTab("rewards")}>
          🏆 Rewards
        </button>
      </nav>
      {tab === "board" && (
        <main className="layout">
          <section className="board-column">
            <BoardV2 onOpenProject={setActiveProjectId} onAddProject={() => setAddOpen(true)} />
          </section>
          <aside className="side-column">
            <EmailIntake />
          </aside>
        </main>
      )}
      {tab === "week" && (
        <main className="layout layout--single">
          <TodayV2 onOpenProject={setActiveProjectId} />
        </main>
      )}
      {tab === "rewards" && (
        <main className="layout layout--single">
          <Dashboard />
        </main>
      )}
      {activeProjectId && <ProjectPanel projectId={activeProjectId} onClose={() => setActiveProjectId(null)} />}
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      <PointsToast />
      <BadgeToast />
    </div>
  );
}

// --- v3: the Continuous Landscape (docs/v3-ui-spec.html is the spec) --------

type V3Tab = "board" | "week" | "intake" | "archive" | "rewards" | "analysis";

const V3_TABS: Array<{ id: V3Tab; label: string }> = [
  { id: "board", label: "Board" },
  { id: "week", label: "Week" },
  { id: "intake", label: "Intake" },
  { id: "archive", label: "Archive" },
  { id: "rewards", label: "Rewards" },
  { id: "analysis", label: "Analysis" },
];

/** A live "mm:ss"/"about N min" helper for the pause countdown. */
function untilLabel(ms: number): { clock: string; approx: string } {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const clock = `${mm}:${String(ss).padStart(2, "0")}`;
  const approx = mm >= 1 ? `about ${mm} min` : "under a minute";
  return { clock, approx };
}

/** Compact header chip: at a glance, is my work reaching the cloud? Clicking
 * forces a sync. Quiet when synced; loud only when it matters. */
function SyncPill() {
  const { config, status, pausedUntil, hasUnsynced, syncNow } = useSync();
  const paused = pausedUntil > Date.now();
  if (!config) return <span className="syncpill local" title="Not connected — this device only. Open Backup / Sync to connect.">Local only</span>;
  let cls = "ok";
  let label = "Synced";
  if (paused) {
    cls = "warn";
    label = "Not syncing";
  } else if (status.phase === "error") {
    cls = "warn";
    label = "Not synced";
  } else if (status.phase === "syncing") {
    cls = "busy";
    label = "Saving…";
  } else if (hasUnsynced) {
    cls = "busy";
    label = "Unsaved";
  }
  return (
    <button className={`syncpill ${cls}`} onClick={syncNow} title="Sync now">
      <span className="syncdot" />
      {label}
    </button>
  );
}

/** The prominent warning. It exists because the board syncs whole-file
 * last-write-wins: while writes are paused, editing on a SECOND machine lets
 * that machine's older copy overwrite this device's unsynced work on the next
 * sync. So the banner's job is to say plainly: saved here, not elsewhere,
 * don't switch machines yet. */
function SyncBanner() {
  const { pausedUntil, status, hasUnsynced, syncNow } = useSync();
  const [now, setNow] = useState(Date.now());
  const paused = pausedUntil > now;
  useEffect(() => {
    if (!paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  if (paused) {
    const { clock, approx } = untilLabel(pausedUntil - now);
    const at = new Date(pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <div className="syncbanner warn" role="alert">
        <span className="sb-badge">⚠ Not syncing</span>
        <span className="sb-body">
          The sync service is temporarily busy. Your changes are <b>saved on this device</b> but aren't reaching your
          other machines yet — <b>don't edit on another device</b> until this clears, or its older copy can win. Writes
          resume ~{at} ({approx}).
        </span>
        <span className="sb-clock">{clock}</span>
        <button className="btn" onClick={syncNow}>
          Try now
        </button>
      </div>
    );
  }
  // A non-rate-limit failure that left changes stranded is dangerous too.
  if (hasUnsynced && status.phase === "error") {
    return (
      <div className="syncbanner warn" role="alert">
        <span className="sb-badge">⚠ Changes not synced</span>
        <span className="sb-body">
          The last sync didn't go through, so your recent changes are <b>saved on this device only</b>. Avoid switching
          machines until it succeeds.
        </span>
        <button className="btn" onClick={syncNow}>
          Try now
        </button>
      </div>
    );
  }
  return null;
}

function WorkspaceV3({ version, onToggleVersion }: { version: UiVersion; onToggleVersion: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<V3Tab>("board");
  const [projectView, setProjectView] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ projectId: string; taskId: string } | null>(null);
  const [focus, setFocus] = useState<{ title?: string; taskId?: string; preset?: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number | null>(null);
  useCaptureUrl(() => {
    setProjectView(null);
    setTab("intake");
  });

  const notify = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  // A board CAS conflict adopted the other device's newer copy (the board has
  // no field merge yet) — tell the user their very last edit may need redoing.
  useEffect(() => {
    const onConflict = () =>
      notify("Board updated from another device — showing the latest. Re-check your last change.");
    const onRestored = () => notify("This device had gone blank — restored your board from the server. ✓");
    window.addEventListener("viz-board-conflict", onConflict);
    window.addEventListener("viz-board-restored", onRestored);
    return () => {
      window.removeEventListener("viz-board-conflict", onConflict);
      window.removeEventListener("viz-board-restored", onRestored);
    };
  }, [notify]);

  // Holding pen resurfacing: when a held task's return date arrives, it comes
  // back onto the board — and because that means hours reappearing in the big
  // box, a warning dialog announces exactly what returned. Runs on load and on
  // any state change (so holds synced in from another device resurface too);
  // once resurfaceHeld clears the flags there's nothing due, so no loop.
  const [resurfaced, setResurfaced] = useState<PlanItem[] | null>(null);
  useEffect(() => {
    const today = isoDate(new Date());
    const due = dueHeldItems(state, today);
    if (due.length) {
      // Dedupe by task id: StrictMode double-invokes this in dev, and in prod a
      // render could slip between the append and resurfaceHeld clearing the
      // flags — either way a task must appear in the warning at most once.
      setResurfaced((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.task.id));
        const add = due.filter((i) => !seen.has(i.task.id));
        return add.length ? [...(prev ?? []), ...add] : prev;
      });
      dispatch({ type: "resurfaceHeld", date: today });
    }
  }, [state, dispatch]);

  const goTab = (t: V3Tab) => {
    setProjectView(null);
    setTab(t);
  };
  const openTask = (projectId: string, taskId: string) => setSheet({ projectId, taskId });
  const sprintOn = (projectId: string, taskId?: string) => {
    setProjectView(projectId);
    const title = taskId ? findTaskItem(state, taskId)?.task.title : undefined;
    setFocus({ title, taskId });
  };

  const sheetTitle = sheet ? findTaskItem(state, sheet.taskId)?.task.title : undefined;

  return (
    <div className="v3">
      <div className="top">
        <div className="logo" title="Board" onClick={() => goTab("board")}>
          ▦
        </div>
        <div style={{ cursor: "pointer" }} title="Board" onClick={() => goTab("board")}>
          <h1>viz-org v3 · Continuous Landscape</h1>
          <div className="sub">the week as one bounded field — boxes are hours, stripes are tasks</div>
        </div>
        <div className="sp" />
        <SyncPill />
        <RankRail />
        <button className="btn" onClick={() => setAddOpen(true)}>
          + New project
        </button>
        <button className="btn" title="Back up or move your board" onClick={() => setSyncOpen(true)}>
          Backup / Sync
        </button>
        <button className="btn" title="Switch interface version" onClick={onToggleVersion}>
          {version === "v3" ? "v3 ✦" : version}
        </button>
        <div className="tabs">
          {V3_TABS.map((t) => (
            <button key={t.id} className={tab === t.id && !projectView ? "on" : ""} onClick={() => goTab(t.id)}>
              {t.label}
              {t.id === "intake" && state.inbox.length > 0 ? ` (${state.inbox.length})` : ""}
            </button>
          ))}
        </div>
      </div>
      <SyncBanner />

      {projectView ? (
        <ProjectViewV3
          projectId={projectView}
          onBack={() => setProjectView(null)}
          onWeek={() => goTab("week")}
          onOpenTask={(taskId) => openTask(projectView, taskId)}
          onSprint={() => setFocus({})}
          notify={notify}
        />
      ) : tab === "board" ? (
        <BoardV3
          onOpenProject={setProjectView}
          onOpenTask={openTask}
          onStartSprint={sprintOn}
          onAddProject={() => setAddOpen(true)}
          notify={notify}
        />
      ) : tab === "week" ? (
        <WeekV3 onOpenTask={openTask} />
      ) : tab === "intake" ? (
        <IntakeV3 />
      ) : tab === "archive" ? (
        <ArchiveV3 onOpenProject={setProjectView} />
      ) : tab === "rewards" ? (
        <RewardsV3
          notify={notify}
          onOpenTask={openTask}
          onSprint={(opts) => {
            if (opts?.projectId) setProjectView(opts.projectId);
            setFocus({
              taskId: opts?.taskId,
              preset: opts?.preset,
              title: opts?.taskId ? findTaskItem(state, opts.taskId)?.task.title : undefined,
            });
          }}
        />
      ) : (
        <AnalysisV3 onOpenProject={setProjectView} onSprint={(pid) => sprintOn(pid)} />
      )}

      {sheet && (
        <TaskSheet
          projectId={sheet.projectId}
          taskId={sheet.taskId}
          onClose={() => setSheet(null)}
          onSprint={() => {
            const id = sheet.taskId;
            setSheet(null);
            setFocus({ title: sheetTitle, taskId: id });
          }}
          onMoved={(newProjectId) => setSheet({ projectId: newProjectId, taskId: sheet.taskId })}
          notify={notify}
        />
      )}
      {focus && (
        <FocusV3
          title={focus.title}
          taskId={focus.taskId}
          preset={focus.preset}
          onClose={() => setFocus(null)}
          notify={notify}
        />
      )}
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      {resurfaced && resurfaced.length > 0 && (
        <div className="modal3">
          <div className="dlg">
            <h3 style={{ margin: "0 0 6px", color: "var(--hi)" }}>↩ Back on the board</h3>
            <p style={{ fontSize: 12.5, color: "var(--lo)", margin: "0 0 10px" }}>
              {resurfaced.length === 1 ? "A held task reached its return date" : `${resurfaced.length} held tasks reached their return dates`}{" "}
              and just resurfaced — <b style={{ color: "var(--mid)" }}>{formatDuration(resurfaced.reduce((s, i) => s + taskMinutes(i.task), 0))}</b>{" "}
              is back in the big box.
            </p>
            {resurfaced.map(({ task, project }) => (
              <div key={task.id} className="row3">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: project.color, flex: "none" }} />
                <label
                  onClick={() => {
                    setResurfaced(null);
                    openTask(project.id, task.id);
                  }}
                >
                  {task.heavy ? "🔥 " : ""}
                  {task.title}
                </label>
                <span className="m">
                  {project.name} · {formatDuration(taskMinutes(task))} · planned {task.scheduledFor?.slice(5) ?? "today"}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => {
                  setResurfaced(null);
                  goTab("week");
                }}
              >
                Open the Week
              </button>
              <button className="btn pri" onClick={() => setResurfaced(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Legacy BadgeToast stays on v2/classic only — its lucky/combo popups
          have no place next to the ratified escutcheon roster. */}
      <div className={`toast3 ${toast ? "on" : ""}`}>
        {toast?.msg}
        {toast?.undo && (
          <button
            onClick={() => {
              toast.undo?.();
              setToast(null);
            }}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [config, setConfig] = useState<SyncConfig | null>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus>({ phase: "idle" });
  const hydrated = useRef(false);
  const latest = useRef(state);
  latest.current = state;

  // v3 checklist streams: their own reducer, storage key, and gist file.
  const [streams, dispatchStreams] = useReducer(streamsReducer, undefined, loadStreams);
  const streamsHydrated = useRef(false);
  const latestStreams = useRef(streams);
  latestStreams.current = streams;

  // The reinforcement layer: append-only event log, level, badges. Its gist
  // file merges by event id (never adopt-replace), so pulls can't destroy
  // locally logged events and two devices can't double-seed.
  const [rs, dispatchR] = useReducer(reinforcementReducer, undefined, () => loadReinforcement() ?? emptyReinforcement());
  const rsHydrated = useRef(false);
  const latestRs = useRef(rs);
  latestRs.current = rs;

  // Last-seen revision per relay document. Pushes send these as the CAS base;
  // a 409 means another device wrote first and we merge instead of clobbering.
  // Revisions are mirrored to localStorage so sibling tabs on the SAME machine
  // share them — otherwise each tab treats the other's writes as "another
  // device" and manufactures phantom conflicts.
  const revs = useRef<DocRevs>({ board: 0, streams: 0, reinforcement: 0 });
  const REVS_KEY = "viz-org-revs-v1";
  const persistRevs = () => {
    try {
      localStorage.setItem(REVS_KEY, JSON.stringify(revs.current));
    } catch {
      /* best-effort */
    }
  };

  // One human, one active seat: the board on the device they're ACTUALLY
  // editing wins. `lastServerBoard` is the board content the server is known
  // to hold (stringified state) — pushing identical content is an echo and is
  // skipped entirely, so background tabs stop bumping revisions. `lastBoardEditAt`
  // marks real user edits (sync adopts don't count); within this window a CAS
  // conflict resolves by RE-PUSHING our board on the fresh revision instead of
  // discarding what the user just did.
  const lastServerBoard = useRef<string>("");
  const lastServerStreams = useRef<string>("");
  const lastServerReinf = useRef<string>("");
  const lastBoardEditAt = useRef(0);
  const RECENT_EDIT_MS = 3 * 60 * 1000;

  // SAFETY NET: an empty board must NEVER overwrite a non-empty one. A local
  // board going to zero tasks is a symptom (a wiped/blank tab, a bad load) —
  // essentially never a deliberate act — so every write path below refuses to
  // sync or adopt it, and re-pulls the real board instead. This is the guard
  // against "woke up to an empty board".
  const boardTasks = (s: AppState) => s.projects.reduce((n, p) => n + (p.tasks?.length ?? 0), 0);
  const serverBoardTasks = () => {
    try {
      const p = JSON.parse(lastServerBoard.current || "{}") as AppState;
      return Array.isArray(p.projects) ? p.projects.reduce((n: number, pr: Project) => n + (pr.tasks?.length ?? 0), 0) : 0;
    } catch {
      return 0;
    }
  };

  // When the relay throttles (burst limit / host trouble), pause writers until
  // it clears. The ref drives flush scheduling; the mirrored STATE drives the
  // visible warning (a ref alone wouldn't re-render). `unsynced` is true
  // whenever local changes exist that haven't been confirmed pushed — the real
  // data-loss signal for multi-machine use.
  const writesPausedUntil = useRef(0);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [unsynced, setUnsynced] = useState(false);
  const noteRateLimit = (e: unknown) => {
    if (e instanceof SyncBusyError) {
      writesPausedUntil.current = e.resetAt;
      setPausedUntil(e.resetAt);
    }
  };

  // Auto-clear the pause banner the moment the bucket is due to refill.
  useEffect(() => {
    if (!pausedUntil) return;
    const ms = pausedUntil - Date.now();
    if (ms <= 0) {
      setPausedUntil(0);
      return;
    }
    const id = window.setTimeout(() => setPausedUntil(0), ms + 500);
    return () => window.clearTimeout(id);
  }, [pausedUntil]);

  // Persist locally on every change.
  useEffect(() => {
    saveState(state);
  }, [state]);
  useEffect(() => {
    saveStreams(streams);
  }, [streams]);
  useEffect(() => {
    saveReinforcement(rs);
  }, [rs]);

  // Pull the remote reinforcement file once sync is configured. If neither a
  // remote file nor local history exists, fold the legacy points in exactly
  // once (the seed is an event with a fixed id, so a double seed collapses in
  // any later merge). Without sync, seed locally.
  useEffect(() => {
    rsHydrated.current = false;
    if (!config) {
      if (latestRs.current.events.length === 0) {
        dispatchR({ type: "seed", legacy: withGame(latest.current.game) });
      }
      rsHydrated.current = true;
      return;
    }
    let cancelled = false;
    pullReinforcement(config)
      .then(({ rs: remote, rev }) => {
        if (cancelled) return;
        revs.current.reinforcement = rev;
        persistRevs();
        if (remote) {
          lastServerReinf.current = JSON.stringify(remote);
          dispatchR({ type: "ingest", remote });
        } else dispatchR({ type: "seed", legacy: withGame(latest.current.game) });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) rsHydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Re-evaluate computable badges whenever the earn history or streams move.
  // The reducer returns the same state when nothing changed, so no loop.
  useEffect(() => {
    dispatchR({ type: "evaluateBadges", board: latest.current, streams: latestStreams.current });
  }, [rs.events, streams]);

  // Pull remote streams once sync is configured; merge is LWW by updatedAt so
  // a chat-written checklist and a local check can't clobber each other.
  useEffect(() => {
    streamsHydrated.current = false;
    if (!config) {
      streamsHydrated.current = true;
      return;
    }
    let cancelled = false;
    pullStreams(config)
      .then(({ streams: remote, rev }) => {
        if (cancelled) return;
        revs.current.streams = rev;
        persistRevs();
        lastServerStreams.current = JSON.stringify(remote);
        if (remote.length) dispatchStreams({ type: "ingest", streams: remote });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) streamsHydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // --- the coalesced pusher --------------------------------------------------
  // One user action can dirty the board (done flag), the streams (item state),
  // AND the reinforcement log (step/close event) at once. GitHub meters gist
  // writes in one small per-user bucket, and a single gist PATCH can carry all
  // three files — so dirty files accumulate behind ONE debounce and ship
  // together: 3× the write budget's mileage, and stream-state/event pairs land
  // atomically. A rate-limit pause reschedules the flush instead of dropping it.
  const dirty = useRef({ board: false, streams: false, reinf: false });
  const flushTimer = useRef<number | null>(null);

  const flushDirty = useCallback(() => {
    if (!config) return;
    const wait = writesPausedUntil.current - Date.now();
    if (wait > 0) {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => flushDirty(), wait + 500);
      return;
    }
    const d = { ...dirty.current };
    // Echo suppression: if a document's content is exactly what the server
    // already holds, there is nothing to say — pushing it would only bump the
    // revision and manufacture conflicts for every other tab and machine.
    const boardSnap = d.board ? JSON.stringify(latest.current) : null;
    if (d.board && boardSnap === lastServerBoard.current) d.board = false;
    const streamsSnap = d.streams ? JSON.stringify(latestStreams.current) : null;
    if (d.streams && streamsSnap === lastServerStreams.current) d.streams = false;
    const reinfSnap = d.reinf ? JSON.stringify(latestRs.current) : null;
    if (d.reinf && reinfSnap === lastServerReinf.current) d.reinf = false;
    // Refuse to push an empty board over a non-empty server board; instead pull
    // the real one back onto this device (self-heals a gone-blank tab too).
    if (d.board && boardTasks(latest.current) === 0 && serverBoardTasks() > 0) {
      d.board = false;
      dirty.current.board = false;
      (async () => {
        try {
          const { state: remote, rev } = await pullBoard(config);
          if (remote && boardTasks(remote) > 0) {
            revs.current.board = rev;
            persistRevs();
            dispatch({ type: "replaceState", state: remote });
            lastServerBoard.current = JSON.stringify(normalizeState(remote));
            window.dispatchEvent(new CustomEvent("viz-board-restored"));
          }
        } catch {
          /* leave local as-is; the next flush re-guards */
        }
      })();
    }
    if (!d.board && !d.streams && !d.reinf) {
      dirty.current = { board: false, streams: false, reinf: false };
      setUnsynced(false);
      return;
    }
    dirty.current = { board: false, streams: false, reinf: false };
    setStatus({ phase: "syncing" });

    const remark = () => {
      dirty.current = {
        board: dirty.current.board || d.board,
        streams: dirty.current.streams || d.streams,
        reinf: dirty.current.reinf || d.reinf,
      };
    };
    const reschedule = (ms: number) => {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => flushDirty(), ms);
    };

    pushDocs(
      config,
      {
        board: d.board ? latest.current : undefined,
        streams: d.streams ? latestStreams.current : undefined,
        reinforcement: d.reinf ? latestRs.current : undefined,
      },
      revs.current,
    )
      .then((out) => {
        revs.current = { ...revs.current, ...out };
        if (out.board !== undefined && boardSnap !== null) lastServerBoard.current = boardSnap;
        if (out.streams !== undefined && streamsSnap !== null) lastServerStreams.current = streamsSnap;
        if (out.reinforcement !== undefined && reinfSnap !== null) lastServerReinf.current = reinfSnap;
        persistRevs();
        setStatus({ phase: "ok", at: Date.now() });
        setPausedUntil(0);
        // Only truly clean if nothing new was dirtied while the push flew.
        if (!dirty.current.board && !dirty.current.streams && !dirty.current.reinf) setUnsynced(false);
      })
      .catch(async (e) => {
        remark();
        // CAS miss: another device wrote first. Pull, reconcile, retry. (Docs
        // that landed before the stale one keep stale local revs — their next
        // push 409s once and self-heals through this same path.)
        if (e instanceof StaleWriteError) {
          // The 409's rev is authoritative (POST responses bypass any cache);
          // the re-pulls below then read fresh content at/after that rev.
          revs.current[e.doc] = e.rev;
          persistRevs();
          try {
            if (e.doc === "board") {
              const { state: remote, rev } = await pullBoard(config);
              revs.current.board = rev;
              persistRevs();
              const remoteStr = remote ? JSON.stringify(normalizeState(remote)) : "";
              const localStr = JSON.stringify(latest.current);
              const hadUnsyncedEdits = localStr !== lastServerBoard.current;
              const activelyEditing = Date.now() - lastBoardEditAt.current < RECENT_EDIT_MS;
              // An empty local board never wins, even mid-edit — that's the wipe
              // symptom, not a real edit worth preserving.
              const localEmptyOverFull = boardTasks(latest.current) === 0 && !!remote && boardTasks(remote) > 0;
              if (remote && remoteStr === localStr) {
                // Same content, newer number — a sibling's echo. Nothing to do.
                lastServerBoard.current = remoteStr;
                dirty.current.board = false;
              } else if (activelyEditing && hadUnsyncedEdits && !localEmptyOverFull) {
                // One human, one active seat: the board the user is EDITING
                // wins. Re-push ours on the fresh revision — never discard
                // the thing they just did.
                dirty.current.board = true;
              } else if (remote) {
                // We're a bystander (no fresh edits) — take the newer copy.
                dispatch({ type: "replaceState", state: remote });
                lastServerBoard.current = remoteStr;
                dirty.current.board = false;
                // Warn ONLY when real unsynced local edits were superseded;
                // a clean tab adopting quietly is just... syncing.
                if (hadUnsyncedEdits) window.dispatchEvent(new CustomEvent("viz-board-conflict"));
              }
            } else if (e.doc === "streams") {
              const { streams: remote, rev } = await pullStreams(config);
              revs.current.streams = rev;
              persistRevs();
              lastServerStreams.current = JSON.stringify(remote);
              if (remote.length) dispatchStreams({ type: "ingest", streams: remote });
              dirty.current.streams = true; // merged result still needs pushing
            } else if (e.doc === "reinforcement") {
              const { rs: remote, rev } = await pullReinforcement(config);
              revs.current.reinforcement = rev;
              persistRevs();
              if (remote) {
                lastServerReinf.current = JSON.stringify(remote);
                dispatchR({ type: "ingest", remote });
              }
              dirty.current.reinf = true;
            }
          } catch {
            /* pull failed — the retry below re-attempts the whole cycle */
          }
          setStatus({ phase: "syncing" });
          reschedule(400);
          return;
        }
        noteRateLimit(e);
        setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" });
        if (e instanceof RelayAuthError) return; // wrong key — retrying won't help
        reschedule(Math.max(writesPausedUntil.current - Date.now() + 500, 5000));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const scheduleFlush = useCallback(
    (delay = 1200) => {
      setUnsynced(true); // something local changed and isn't on the gist yet
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => flushDirty(), delay);
    },
    [flushDirty],
  );

  useEffect(() => {
    if (!config || !streamsHydrated.current) return;
    dirty.current.streams = true;
    scheduleFlush();
  }, [streams, config, scheduleFlush]);

  useEffect(() => {
    if (!config || !rsHydrated.current) return;
    dirty.current.reinf = true;
    scheduleFlush();
  }, [rs, config, scheduleFlush]);

  // Live-sync across tabs/windows on the same browser (same-computer screens).
  // The reinforcement key merges by event id instead of replacing, so two tabs
  // can't double-pay a doubler or lose each other's events. Revisions are
  // shared too (element-wise max — they only ever grow), so a sibling tab's
  // push doesn't read as a foreign device; and adopting a sibling's board also
  // adopts it as "what the server holds" so this tab won't echo-push it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        if (e.newValue === JSON.stringify(latest.current)) return;
        try {
          const incoming = JSON.parse(e.newValue) as AppState;
          // Don't let a blank sibling tab wipe a full one.
          if (boardTasks(incoming) === 0 && boardTasks(latest.current) > 0) return;
          dispatch({ type: "replaceState", state: incoming });
          lastServerBoard.current = JSON.stringify(normalizeState(incoming));
        } catch {
          /* ignore malformed */
        }
      }
      if (e.key === REINF_STORAGE_KEY && e.newValue) {
        try {
          dispatchR({ type: "ingest", remote: JSON.parse(e.newValue) });
          // As with the board above: the sibling that wrote this is the one
          // pushing it. Adopting it as "what the server holds" keeps this tab
          // from echo-pushing the identical merge result; if this tab holds
          // events the sibling lacks, the merged union still differs and
          // still pushes.
          lastServerReinf.current = e.newValue;
        } catch {
          /* ignore malformed */
        }
      }
      if (e.key === REVS_KEY && e.newValue) {
        try {
          const r = JSON.parse(e.newValue) as Partial<DocRevs>;
          revs.current = {
            board: Math.max(revs.current.board, r.board ?? 0),
            streams: Math.max(revs.current.streams, r.streams ?? 0),
            reinforcement: Math.max(revs.current.reinforcement, r.reinforcement ?? 0),
          };
        } catch {
          /* ignore malformed */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When sync is configured (or reconfigured), pull the remote board. If the
  // server has nothing yet, seed it with this device's board.
  useEffect(() => {
    hydrated.current = false;
    if (!config) {
      hydrated.current = true;
      return;
    }
    let cancelled = false;
    setStatus({ phase: "syncing" });
    (async () => {
      try {
        const { state: remote, rev } = await pullBoardRetrying(config);
        if (cancelled) return;
        revs.current.board = rev;
        if (remote) {
          dispatch({ type: "replaceState", state: remote });
          // Baseline what the reducer will actually store (normalized), so
          // the echo comparison is apples-to-apples.
          lastServerBoard.current = JSON.stringify(normalizeState(remote));
        } else {
          // Empty store — seed it with this device's board.
          const snap = latest.current;
          const out = await pushDocs(config, { board: snap }, revs.current);
          revs.current = { ...revs.current, ...out };
          lastServerBoard.current = JSON.stringify(snap);
        }
        persistRevs();
        if (!cancelled) {
          setStatus({ phase: "ok", at: Date.now() });
          ingestInbox().catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" });
      } finally {
        hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Drain the gist drop box: candidate tasks left there by an outside helper
  // (e.g. a Claude email scan) flow into Email Intake, then the box is
  // emptied. The seenCandidateIds guard in the reducer makes this idempotent,
  // so a failed clear just retries harmlessly on the next check. Returns how
  // many candidates were actually new; throws on network trouble so the
  // explicit "Check now" button can show an error.
  const ingestInbox = useCallback(async (): Promise<number> => {
    if (!config) return 0;
    const { raw, rev: inboxRev } = await pullInbox(config);
    if (!raw) return 0;
    let fresh = 0;
    try {
      // The box carries either a bare candidate array (legacy) or an envelope
      // { candidates?, dayCapacities? } — capacities come from calendar scans
      // and overwrite the named days' hours.
      let candidatesRaw = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (parsed.dayCapacities && typeof parsed.dayCapacities === "object") {
            dispatch({ type: "setDayCapacities", caps: parsed.dayCapacities });
          }
          candidatesRaw = JSON.stringify(parsed.candidates ?? []);
        }
      } catch {
        /* not plain JSON — decodeCandidates handles base64 below */
      }
      const candidates = decodeCandidates(candidatesRaw);
      const seen = new Set(latest.current.seenCandidateIds ?? []);
      const inInbox = new Set(latest.current.inbox.map((c) => c.id));
      fresh = candidates.filter((c) => !seen.has(c.id) && !inInbox.has(c.id)).length;
      if (candidates.length) dispatch({ type: "pullEmail", candidates });
    } finally {
      // CAS-guarded: if chat dropped new candidates between our pull and this
      // clear, the clear is skipped and the next drain picks them up.
      await clearInbox(config, inboxRev);
    }
    return fresh;
  }, [config]);

  // "Sync now" / "Try now" (and the recovery handler): a MANUAL attempt clears
  // the pause optimistically so the flush actually fires — if GitHub is still
  // rate-limited the failure path re-pauses it. Everything is treated as dirty
  // and flushed in one PATCH.
  const pushNow = useCallback(() => {
    if (!config) return;
    writesPausedUntil.current = 0;
    setPausedUntil(0);
    dirty.current = { board: true, streams: true, reinf: true };
    flushDirty();
  }, [config, flushDirty]);

  // Push board changes up (debounced) once the initial pull has settled.
  useEffect(() => {
    if (!config || !hydrated.current) return;
    dirty.current.board = true;
    scheduleFlush();
  }, [state, config, scheduleFlush]);

  // Catch up from the server: one cheap ping tells us which documents moved;
  // only those get pulled. A clean board (no unsynced local edits) adopts the
  // newer copy silently — this is how a woken laptop "hands control back"
  // without any conflict theater. A board with fresh local edits is left
  // alone; the CAS flow will arbitrate when it pushes.
  const refreshFromServer = useCallback(async () => {
    if (!config) return;
    try {
      const server = await pullRevs(config);
      if (!server) return;
      if ((server.board ?? 0) > revs.current.board) {
        const { state: remote, rev } = await pullBoard(config);
        revs.current.board = rev;
        const localClean = JSON.stringify(latest.current) === lastServerBoard.current;
        if (remote && localClean) {
          dispatch({ type: "replaceState", state: remote });
          lastServerBoard.current = JSON.stringify(normalizeState(remote));
        }
      }
      if ((server.streams ?? 0) > revs.current.streams) {
        const { streams: remote, rev } = await pullStreams(config);
        revs.current.streams = rev;
        lastServerStreams.current = JSON.stringify(remote);
        if (remote.length) dispatchStreams({ type: "ingest", streams: remote });
      }
      if ((server.reinforcement ?? 0) > revs.current.reinforcement) {
        const { rs: remote, rev } = await pullReinforcement(config);
        revs.current.reinforcement = rev;
        if (remote) {
          lastServerReinf.current = JSON.stringify(remote);
          dispatchR({ type: "ingest", remote });
        }
      }
      persistRevs();
    } catch {
      /* a failed refresh is harmless — the CAS flow still guards writes */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // When the connection comes back (or the window regains focus — i.e. the
  // user just sat down at THIS machine), refresh from the server FIRST, then
  // flush anything local, then drain the inbox.
  useEffect(() => {
    if (!config) return;
    const handler = () => {
      if (!hydrated.current) return;
      refreshFromServer().finally(() => {
        flushDirty();
        ingestInbox().catch(() => {});
      });
    };
    window.addEventListener("online", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("focus", handler);
    };
  }, [config, refreshFromServer, flushDirty, ingestInbox]);

  const connect = useCallback((key: string, url?: string) => {
    const relayUrl = (url ?? DEFAULT_RELAY_URL).trim();
    setStatus({ phase: "syncing" });
    testRelay(relayUrl, key)
      .then(() => {
        const cfg = { url: relayUrl, key };
        saveSyncConfig(cfg);
        setConfig(cfg);
      })
      .catch((e) => setStatus({ phase: "error", message: e instanceof Error ? e.message : "Couldn't reach the relay" }));
  }, []);
  const disconnect = useCallback(() => {
    saveSyncConfig(null);
    setConfig(null);
    setStatus({ phase: "idle" });
  }, []);
  const syncNow = pushNow;

  // Which interface to show. Per-device (localStorage), defaults to v3; the
  // toggle cycles v3 → v2 → classic, so the safety nets stay one click away.
  const [version, setVersion] = useState<UiVersion>(() => {
    try {
      const stored = localStorage.getItem(UI_VERSION_KEY);
      return stored === "classic" || stored === "v2" ? stored : "v3";
    } catch {
      return "v3";
    }
  });
  const toggleVersion = useCallback(() => {
    setVersion((v) => {
      const next: UiVersion = v === "v3" ? "v2" : v === "v2" ? "classic" : "v3";
      try {
        localStorage.setItem(UI_VERSION_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Components dispatch through this wrapper so real user edits stamp
  // lastBoardEditAt; the sync layer's own replaceState adoptions do not.
  const dispatchTracked = useCallback((action: Action) => {
    if (action.type !== "replaceState") lastBoardEditAt.current = Date.now();
    dispatch(action);
  }, []);

  return (
    <StoreContext.Provider value={{ state, dispatch: dispatchTracked }}>
      <StreamsContext.Provider value={{ streams, dispatch: dispatchStreams }}>
        <ReinforcementContext.Provider value={{ rs, dispatchR }}>
          <SyncContext.Provider
            value={{ config, status, pausedUntil, hasUnsynced: unsynced, connect, disconnect, syncNow, checkInbox: ingestInbox }}
          >
            {version === "v3" ? (
              <WorkspaceV3 version={version} onToggleVersion={toggleVersion} />
            ) : version === "v2" ? (
              <WorkspaceV2 version={version} onToggleVersion={toggleVersion} />
            ) : (
              <Workspace version={version} onToggleVersion={toggleVersion} />
            )}
          </SyncContext.Provider>
        </ReinforcementContext.Provider>
      </StreamsContext.Provider>
    </StoreContext.Provider>
  );
}
