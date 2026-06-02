import { useEffect, useReducer, useState } from "react";
import { Board } from "./components/Board";
import { DailyPlan } from "./components/DailyPlan";
import { EmailIntake } from "./components/EmailIntake";
import { ProjectPanel } from "./components/ProjectPanel";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { SyncDialog } from "./components/SyncDialog";
import { StoreContext, loadState, reducer, saveState, useStore } from "./store";

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

  useEffect(() => {
    saveState(state);
  }, [state]);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      <Workspace />
    </StoreContext.Provider>
  );
}
