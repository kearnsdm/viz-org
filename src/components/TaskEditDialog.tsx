import { useState } from "react";
import { lockedHeavyIds, useStore } from "../store";
import { DURATIONS } from "./ProjectPanel";
import type { Task, Urgency } from "../types";

const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

function isoShift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TaskEditDialog({
  projectId,
  task,
  onClose,
}: {
  projectId: string;
  task: Task;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [title, setTitle] = useState(task.title);
  const [urgency, setUrgency] = useState<Urgency>(task.urgency);
  const [due, setDue] = useState(task.due ?? "");
  const [est, setEst] = useState(task.estimateMinutes ? String(task.estimateMinutes) : "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const heavyLocked = lockedHeavyIds(state).includes(task.id);

  const save = () => {
    dispatch({
      type: "updateTask",
      projectId,
      taskId: task.id,
      patch: {
        title: title.trim() || task.title,
        urgency,
        due: due || undefined,
        estimateMinutes: est ? Number(est) : undefined,
        notes: notes.trim() || undefined,
      },
    });
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Edit task</h2>

        <label className="field">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="field">
          Due date
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <div className="quick-due">
          <button className="btn btn-sm btn-ghost" onClick={() => setDue(isoShift(0))}>Today</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDue(isoShift(1))}>Tomorrow</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDue(isoShift(7))}>+1 week</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDue("")}>Clear</button>
        </div>

        <div className="edit-row">
          <label className="field">
            Priority
            <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
              {URGENCIES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Estimated time
            <select value={est} onChange={(e) => setEst(e.target.value)}>
              <option value="">none</option>
              {DURATIONS.map((d) => (
                <option key={d.min} value={d.min}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          Notes / details
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="import-textarea" />
        </label>

        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={!!task.heavy}
            disabled={heavyLocked}
            onChange={(e) => dispatch({ type: "setHeavy", projectId, taskId: task.id, heavy: e.target.checked })}
          />
          🔥 Heavy / aversive (bonus points){heavyLocked ? " — locked for today" : ""}
        </label>

        <div className="dialog__actions" style={{ justifyContent: "space-between" }}>
          <button
            className="btn btn-danger-ghost"
            onClick={() => {
              if (confirm(`Delete "${task.title}"?`)) {
                dispatch({ type: "deleteTask", projectId, taskId: task.id });
                onClose();
              }
            }}
          >
            Delete
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
