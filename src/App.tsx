import { useEffect, useReducer, useState } from "react";
import { Board } from "./components/Board";
import { DailyPlan } from "./components/DailyPlan";
import { EmailIntake } from "./components/EmailIntake";
import { ProjectPanel } from "./components/ProjectPanel";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { StoreContext, loadState, reducer, saveState, useStore } from "./store";

function Header({ onAddProject }: { onAddProject: () => void }) {
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
          title="Clear all data and restore the demo board"
          onClick={() => {
            if (confirm("Reset the board to the demo data? This clears your saved work.")) {
              dispatch({ type: "reset" });
            }
          }}
        >
          Reset
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

  return (
    <div className="app">
      <Header onAddProject={() => setAddOpen(true)} />
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
