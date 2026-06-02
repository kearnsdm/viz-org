import { useState } from "react";
import { projectWeight, useStore } from "../store";
import type { Task, Urgency } from "../types";

const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

function TaskRow({ projectId, task }: { projectId: string; task: Task }) {
  const { dispatch, state } = useStore();
  const overdue = task.due && !task.done && task.due < new Date().toISOString().slice(0, 10);

  return (
    <li className={`task-row ${task.done ? "is-done" : ""}`}>
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => dispatch({ type: "toggleTask", projectId, taskId: task.id })}
        aria-label={task.done ? "Mark not done" : "Mark done"}
      />
      <div className="task-row__main">
        <span className="task-row__title">{task.title}</span>
        <span className="task-row__sub">
          <span className={`pill pill-${task.urgency}`}>{task.urgency}</span>
          {task.due && (
            <span className={`muted ${overdue ? "overdue" : ""}`}>
              due {task.due}
              {overdue ? " · overdue" : ""}
            </span>
          )}
          {task.source === "email" && <span className="pill pill-email">from email</span>}
        </span>
      </div>
      <div className="task-row__actions">
        <select
          value={task.urgency}
          onChange={(e) =>
            dispatch({ type: "updateTask", projectId, taskId: task.id, patch: { urgency: e.target.value as Urgency } })
          }
          title="Urgency"
        >
          {URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select
          value=""
          title="Move to another project"
          onChange={(e) => {
            if (e.target.value) {
              dispatch({ type: "moveTask", taskId: task.id, fromProjectId: projectId, toProjectId: e.target.value });
            }
          }}
        >
          <option value="">move…</option>
          {state.projects
            .filter((p) => p.id !== projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          className="icon-btn"
          title="Delete task"
          onClick={() => dispatch({ type: "deleteTask", projectId, taskId: task.id })}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export function ProjectPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const project = state.projects.find((p) => p.id === projectId);
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [due, setDue] = useState("");

  if (!project) return null;

  const weight = projectWeight(project);
  const openTasks = project.tasks.filter((t) => !t.done);
  const doneTasks = project.tasks.filter((t) => t.done);
  const freeInProject = Math.max(0, project.capacity - project.tasks.length);

  const addTask = () => {
    if (!title.trim()) return;
    dispatch({ type: "addTask", projectId, title, urgency, due: due || undefined });
    setTitle("");
    setUrgency("normal");
    setDue("");
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" style={{ ["--accent" as string]: project.color }} onClick={(e) => e.stopPropagation()}>
        <div className="panel__header">
          <input
            className="panel__title"
            value={project.name}
            onChange={(e) => dispatch({ type: "renameProject", projectId, name: e.target.value })}
          />
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="panel__stats">
          <span>{openTasks.length} open</span>
          <span className="muted">{doneTasks.length} done</span>
          <span className="muted">·</span>
          <label className="cap-control">
            allocated space
            <input
              type="number"
              min={Math.max(1, project.tasks.length)}
              value={project.capacity}
              onChange={(e) => dispatch({ type: "setCapacity", projectId, capacity: Number(e.target.value) })}
            />
          </label>
          {freeInProject > 0 && <span className="muted">{freeInProject} slot(s) reserved & empty</span>}
        </div>

        <div className="add-task">
          <input
            placeholder="Add a task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            autoFocus
          />
          <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
          <button className="btn btn-primary" onClick={addTask}>
            Add
          </button>
        </div>

        <div className="panel__tasks">
          {project.tasks.length === 0 && (
            <p className="muted empty-hint">No tasks yet — this whole box is open, plannable space.</p>
          )}
          {openTasks.length > 0 && (
            <ul className="task-list">
              {openTasks.map((t) => (
                <TaskRow key={t.id} projectId={projectId} task={t} />
              ))}
            </ul>
          )}
          {Array.from({ length: freeInProject }).map((_, i) => (
            <div key={`free-${i}`} className="empty-slot muted">
              reserved space — room to plan
            </div>
          ))}
          {doneTasks.length > 0 && (
            <details className="done-section">
              <summary>{doneTasks.length} completed</summary>
              <ul className="task-list">
                {doneTasks.map((t) => (
                  <TaskRow key={t.id} projectId={projectId} task={t} />
                ))}
              </ul>
            </details>
          )}
        </div>

        {!project.isAdmin && (
          <div className="panel__footer">
            <span className="muted">Board weight: {weight} slot(s)</span>
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                if (confirm(`Delete project "${project.name}" and its tasks?`)) {
                  dispatch({ type: "deleteProject", projectId });
                  onClose();
                }
              }}
            >
              Delete project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
