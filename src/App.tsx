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
import { STORAGE_KEY, StoreContext, decodeCandidates, findTaskItem, loadState, reducer, saveState, uid, useStore } from "./store";
import { StreamsContext, loadStreams, saveStreams, streamsReducer } from "./streams";
import type { Urgency } from "./types";

const UI_VERSION_KEY = "viz-org-ui";
import { RANKS, availableCredits, badgeById, level, rankIndex, withGame } from "./game";
import {
  GistRateLimitError,
  SyncContext,
  clearInbox,
  findOrCreateGist,
  loadSyncConfig,
  pullInbox,
  pullRemoteRetrying,
  pullStreams,
  pushRemoteRetrying,
  pushStreams,
  saveSyncConfig,
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

function WorkspaceV3({ version, onToggleVersion }: { version: UiVersion; onToggleVersion: () => void }) {
  const { state } = useStore();
  const [tab, setTab] = useState<V3Tab>("board");
  const [projectView, setProjectView] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ projectId: string; taskId: string } | null>(null);
  const [focus, setFocus] = useState<{ title?: string } | null>(null);
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

  const goTab = (t: V3Tab) => {
    setProjectView(null);
    setTab(t);
  };
  const openTask = (projectId: string, taskId: string) => setSheet({ projectId, taskId });
  const sprintOn = (projectId: string, taskId?: string) => {
    setProjectView(projectId);
    const title = taskId ? findTaskItem(state, taskId)?.task.title : undefined;
    setFocus({ title });
  };

  const g = withGame(state.game);
  const rank = RANKS[rankIndex(g)];
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
        <div className="hud" title="Points · rank · build credits ready">
          ⚡ {g.points} · L{rankIndex(g) + 1} {rank.name} · 🛠️ {availableCredits(g)}
        </div>
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
        <BoardV3 onOpenProject={setProjectView} onOpenTask={openTask} onStartSprint={sprintOn} notify={notify} />
      ) : tab === "week" ? (
        <WeekV3 onOpenTask={openTask} />
      ) : tab === "intake" ? (
        <IntakeV3 />
      ) : tab === "archive" ? (
        <ArchiveV3 onOpenProject={setProjectView} />
      ) : tab === "rewards" ? (
        <RewardsV3 notify={notify} />
      ) : (
        <AnalysisV3 onOpenProject={setProjectView} onSprint={(pid) => sprintOn(pid)} />
      )}

      {sheet && (
        <TaskSheet
          projectId={sheet.projectId}
          taskId={sheet.taskId}
          onClose={() => setSheet(null)}
          onSprint={() => {
            setSheet(null);
            setFocus({ title: sheetTitle });
          }}
          onMoved={(newProjectId) => setSheet({ projectId: newProjectId, taskId: sheet.taskId })}
          notify={notify}
        />
      )}
      {focus && <FocusV3 title={focus.title} onClose={() => setFocus(null)} notify={notify} />}
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      <BadgeToast />
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

  // When a gist write hits GitHub's per-user gist_update rate limit, pause ALL
  // writers (board + streams) until the bucket refills — otherwise every change
  // keeps firing PATCHes that just re-pin the limit at zero. Epoch ms; 0 = open.
  const writesPausedUntil = useRef(0);
  const noteRateLimit = (e: unknown) => {
    if (e instanceof GistRateLimitError) {
      writesPausedUntil.current = (e.resetAt ?? Math.floor(Date.now() / 1000) + 60) * 1000;
    }
  };

  // Persist locally on every change.
  useEffect(() => {
    saveState(state);
  }, [state]);
  useEffect(() => {
    saveStreams(streams);
  }, [streams]);

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
      .then((remote) => {
        if (!cancelled && remote.length) dispatchStreams({ type: "ingest", streams: remote });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) streamsHydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Push stream changes up (debounced) once the initial pull has settled.
  useEffect(() => {
    if (!config || !streamsHydrated.current) return;
    const id = setTimeout(() => {
      if (Date.now() < writesPausedUntil.current) return; // rate-limit backoff
      pushStreams(config, latestStreams.current).catch(noteRateLimit);
    }, 1200);
    return () => clearTimeout(id);
  }, [streams, config]);

  // Live-sync across tabs/windows on the same browser (same-computer screens).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      if (e.newValue === JSON.stringify(latest.current)) return;
      try {
        dispatch({ type: "replaceState", state: JSON.parse(e.newValue) });
      } catch {
        /* ignore malformed */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
        const remote = await pullRemoteRetrying(config);
        if (cancelled) return;
        if (remote) dispatch({ type: "replaceState", state: remote });
        else await pushRemoteRetrying(config, latest.current);
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
    const raw = await pullInbox(config);
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
      await clearInbox(config);
    }
    return fresh;
  }, [config]);

  const pushNow = useCallback(() => {
    if (!config) return;
    if (Date.now() < writesPausedUntil.current) return; // paused until rate limit refills
    setStatus({ phase: "syncing" });
    pushRemoteRetrying(config, latest.current)
      .then(() => setStatus({ phase: "ok", at: Date.now() }))
      .catch((e) => {
        noteRateLimit(e);
        setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" });
      });
  }, [config]);

  // Push changes up (debounced) once the initial pull has settled.
  useEffect(() => {
    if (!config || !hydrated.current) return;
    const id = setTimeout(pushNow, 1200);
    return () => clearTimeout(id);
  }, [state, config, pushNow]);

  // When the connection comes back (or the tab regains focus), re-sync so a
  // stale "NetworkError" from a blip heals itself automatically.
  useEffect(() => {
    if (!config) return;
    const handler = () => {
      if (hydrated.current) {
        pushNow();
        ingestInbox().catch(() => {});
      }
    };
    window.addEventListener("online", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("focus", handler);
    };
  }, [config, pushNow, ingestInbox]);

  const connect = useCallback((token: string) => {
    setStatus({ phase: "syncing" });
    findOrCreateGist(token, latest.current)
      .then((cfg) => {
        saveSyncConfig(cfg);
        setConfig(cfg);
      })
      .catch((e) => setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" }));
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

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      <StreamsContext.Provider value={{ streams, dispatch: dispatchStreams }}>
        <SyncContext.Provider value={{ config, status, connect, disconnect, syncNow, checkInbox: ingestInbox }}>
          {version === "v3" ? (
            <WorkspaceV3 version={version} onToggleVersion={toggleVersion} />
          ) : version === "v2" ? (
            <WorkspaceV2 version={version} onToggleVersion={toggleVersion} />
          ) : (
            <Workspace version={version} onToggleVersion={toggleVersion} />
          )}
        </SyncContext.Provider>
      </StreamsContext.Provider>
    </StoreContext.Provider>
  );
}
