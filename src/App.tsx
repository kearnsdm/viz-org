import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Board } from "./components/Board";
import { EmailIntake } from "./components/EmailIntake";
import { ProjectPanel } from "./components/ProjectPanel";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { SyncDialog } from "./components/SyncDialog";
import { TodayView } from "./components/TodayView";
import { STORAGE_KEY, StoreContext, decodeCandidates, loadState, reducer, saveState, uid, useStore } from "./store";
import type { Urgency } from "./types";
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

function Header({ onAddProject, onSync }: { onAddProject: () => void; onSync: () => void }) {
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
        <span className="board-meter" title="Allocated vs. total available time">
          {state.projects.reduce((s, p) => s + Math.max(p.capacity, p.tasks.length, 1), 0)} / {state.boardCapacity} slots
        </span>
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

function Workspace() {
  const { dispatch } = useStore();
  const [tab, setTab] = useState<"today" | "board">("today");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  // Capture URL: opening …/#capture?title=…&link=…(&due=&notes=&from=&urgency=&estimate=)
  // drops a pre-filled candidate into Email Intake. This is what the email
  // bookmarklet targets, but any tool can construct the link.
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
      setTab("board"); // Email Intake lives on the Board tab — show the arrival
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [dispatch]);

  return (
    <div className="app">
      <Header onAddProject={() => setAddOpen(true)} onSync={() => setSyncOpen(true)} />
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
      {activeProjectId && (
        <ProjectPanel projectId={activeProjectId} onClose={() => setActiveProjectId(null)} />
      )}
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

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      <SyncContext.Provider value={{ config, status, connect, disconnect, syncNow, checkInbox: ingestInbox }}>
        <Workspace />
      </SyncContext.Provider>
    </StoreContext.Provider>
  );
}
