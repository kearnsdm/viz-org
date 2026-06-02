import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Board } from "./components/Board";
import { DailyPlan } from "./components/DailyPlan";
import { EmailIntake } from "./components/EmailIntake";
import { ProjectPanel } from "./components/ProjectPanel";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { SyncDialog } from "./components/SyncDialog";
import { StoreContext, loadState, reducer, saveState, useStore } from "./store";
import {
  SyncContext,
  loadSyncConfig,
  pullRemote,
  pushRemote,
  saveSyncConfig,
  type SyncConfig,
  type SyncStatus,
} from "./sync";

function Header({ onAddProject, onSync }: { onAddProject: () => void; onSync: () => void }) {
  const { state, dispatch } = useStore();
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ▦
        </span>
        <div>
          <h1>viz-org</h1>
          <p className="tagline">Your work world, as a board of time.</p>
        </div>
      </div>
      <div className="header-actions">
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

function Workspace() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  return (
    <div className="app">
      <Header onAddProject={() => setAddOpen(true)} onSync={() => setSyncOpen(true)} />
      <main className="layout">
        <section className="board-column">
          <Board onOpenProject={setActiveProjectId} onAddProject={() => setAddOpen(true)} />
        </section>
        <aside className="side-column">
          <DailyPlan onOpenProject={setActiveProjectId} />
          <EmailIntake />
        </aside>
      </main>
      {activeProjectId && (
        <ProjectPanel projectId={activeProjectId} onClose={() => setActiveProjectId(null)} />
      )}
      {addOpen && <AddProjectDialog onClose={() => setAddOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
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
        const remote = await pullRemote(config);
        if (cancelled) return;
        if (remote) dispatch({ type: "replaceState", state: remote });
        else await pushRemote(config, latest.current);
        if (!cancelled) setStatus({ phase: "ok", at: Date.now() });
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

  // Push changes up (debounced) once the initial pull has settled.
  useEffect(() => {
    if (!config || !hydrated.current) return;
    const id = setTimeout(() => {
      setStatus({ phase: "syncing" });
      pushRemote(config, latest.current)
        .then(() => setStatus({ phase: "ok", at: Date.now() }))
        .catch((e) => setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" }));
    }, 1200);
    return () => clearTimeout(id);
  }, [state, config]);

  const connect = useCallback((cfg: SyncConfig) => {
    saveSyncConfig(cfg);
    setConfig(cfg);
  }, []);
  const disconnect = useCallback(() => {
    saveSyncConfig(null);
    setConfig(null);
    setStatus({ phase: "idle" });
  }, []);
  const syncNow = useCallback(() => {
    if (!config) return;
    setStatus({ phase: "syncing" });
    pushRemote(config, latest.current)
      .then(() => setStatus({ phase: "ok", at: Date.now() }))
      .catch((e) => setStatus({ phase: "error", message: e instanceof Error ? e.message : "Sync failed" }));
  }, [config]);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      <SyncContext.Provider value={{ config, status, connect, disconnect, syncNow }}>
        <Workspace />
      </SyncContext.Provider>
    </StoreContext.Provider>
  );
}
