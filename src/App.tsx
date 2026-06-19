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
import { STORAGE_KEY, StoreContext, decodeCandidates, loadState, reducer, saveState, uid, useStore } from "./store";
import type { Urgency } from "./types";

const UI_VERSION_KEY = "viz-org-ui";
import { availableCredits, badgeById, level, withGame } from "./game";
import {
  SyncContext,
  clearInbox,
  findOrCreateGist,
  loadSyncConfig,
  pullInbox,
  pullRemoteRetrying,
  pushRemoteRetrying,
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

type UiVersion = "classic" | "v2";

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

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [config, setConfig] = useState<SyncConfig | null>(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus>({ phase: "idle" });
  const hydrated = useRef(false);
  const latest = useRef(state);
  latest.current = state;

  // Persist locally on every change.
  useEffect(() => {
    saveState(state);
  }, [state]);

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
    setStatus({ phase: "syncing" });
    pushRemoteRetrying(config, latest.current)
      .then(() => setStatus({ phase: "ok", at: Date.now() }))
      .catch((e) => setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" }));
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

  // Which interface to show. Per-device (localStorage), defaults to v2 with an
  // always-available switch back to Classic — the safety net stays one click away.
  const [version, setVersion] = useState<UiVersion>(() => {
    try {
      return localStorage.getItem(UI_VERSION_KEY) === "classic" ? "classic" : "v2";
    } catch {
      return "v2";
    }
  });
  const toggleVersion = useCallback(() => {
    setVersion((v) => {
      const next: UiVersion = v === "v2" ? "classic" : "v2";
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
      <SyncContext.Provider value={{ config, status, connect, disconnect, syncNow, checkInbox: ingestInbox }}>
        {version === "v2" ? (
          <WorkspaceV2 version={version} onToggleVersion={toggleVersion} />
        ) : (
          <Workspace version={version} onToggleVersion={toggleVersion} />
        )}
      </SyncContext.Provider>
    </StoreContext.Provider>
  );
}
