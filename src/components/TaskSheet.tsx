import { useState } from "react";
import { isoDate, taskMinutes, useStore } from "../store";
import { taskPoints, COMPONENT_POINTS } from "../game";
import { useStreams } from "../streams";
import type { Task, Urgency } from "../types";

// The unified Task Sheet — ONE surface per task, opened from every surface
// (board stripe, week chip, Other row, project list, archive). Leads with a
// large completion checkbox and an inline-editable title; then the imported
// checklist (with light provenance); then details edited in place — no edit
// mode, no Save button. ▶ Sprint lives in the header; Delete at the bottom.

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

export function TaskSheet({
  projectId,
  taskId,
  onClose,
  onSprint,
  onMoved,
  notify,
}: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  onSprint: () => void;
  onMoved?: (newProjectId: string) => void;
  notify: (msg: string, undo?: () => void) => void;
}) {
  const { state, dispatch } = useStore();
  const { streams, dispatch: dispatchStreams } = useStreams();
  const [holdDate, setHoldDate] = useState("");

  const project = state.projects.find((p) => p.id === projectId);
  const task = project?.tasks.find((t) => t.id === taskId);
  if (!project || !task) return null;

  const otherProjects = state.projects.filter((p) => p.id !== projectId);
  const moveToProject = (toProjectId: string) => {
    if (!toProjectId || toProjectId === projectId) return;
    dispatch({ type: "moveTask", taskId, fromProjectId: projectId, toProjectId });
    const dest = state.projects.find((p) => p.id === toProjectId);
    notify(`Moved to ${dest?.name ?? "project"}`);
    onMoved?.(toProjectId);
  };

  const stream = streams.find((s) => s.taskId === task.id);
  const comps = stream ? stream.items.filter((i) => i.state !== "dropped") : [];
  const compsDone = comps.filter((i) => i.state === "done").length;

  const patch = (p: Partial<Task>) => dispatch({ type: "updateTask", projectId, taskId, patch: p });

  const complete = () => {
    dispatch({ type: "toggleTask", projectId, taskId });
    notify(`✓ ${task.title}`, () => dispatch({ type: "undoComplete", projectId, taskId }));
  };

  const toggleDone = () => {
    if (task.done) dispatch({ type: "undoComplete", projectId, taskId });
    else complete();
  };

  const toggleComp = (itemId: string, text: string, isDone: boolean) => {
    if (!stream) return;
    if (isDone) {
      dispatchStreams({ type: "uncheck", streamId: stream.streamId, itemId });
      dispatch({ type: "componentUnchecked", projectId, taskId, label: text });
      return;
    }
    dispatchStreams({ type: "check", streamId: stream.streamId, itemId });
    dispatch({ type: "componentChecked", projectId, taskId, label: text });
    const remainingOpen = comps.filter((i) => i.state === "open" && i.id !== itemId).length;
    notify(`+${COMPONENT_POINTS} ⚡ · ${compsDone + 1} of ${comps.length} steps done`);
    // Checking the last open component completes the task itself.
    if (remainingOpen === 0 && !task.done) complete();
  };

  const quickDue = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    patch({ due: isoDate(d) });
  };

  const del = () => {
    if (confirm(`Delete "${task.title}"?`)) {
      dispatch({ type: "deleteTask", projectId, taskId });
      onClose();
    }
  };

  return (
    <div
      className="modal3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dlg">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <input type="checkbox" className="sheet-done" checked={task.done} onChange={toggleDone} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              className="dlg-title"
              defaultValue={task.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== task.title) patch({ title: v });
              }}
            />
            <div className="dlg-meta">
              {project.name} · {taskMinutes(task)}m
              {task.urgency === "urgent" ? " · urgent" : task.urgency === "high" ? " · high" : ""}
              {task.heavy ? " · 🔥" : ""}
              {task.held ? ` · ⏸ held — returns ${task.scheduledFor ?? "?"}` : ""}
              {task.done ? " · ✓ done" : ` · worth +${taskPoints(task)} ⚡`}
            </div>
          </div>
          <button
            className="btn pri"
            style={{ flex: "none" }}
            onClick={() => {
              onSprint();
            }}
          >
            ▶ Sprint
          </button>
        </div>

        {stream && comps.length > 0 && (
          <>
            <div className="sec">
              Checklist{" "}
              <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--lo)" }}>
                · from Claude ({stream.codename})
              </span>
            </div>
            {comps.map((item) => (
              <div key={item.id} className={`row3 ${item.state === "done" ? "dn" : ""}`}>
                <input
                  type="checkbox"
                  checked={item.state === "done"}
                  onChange={() => toggleComp(item.id, item.text, item.state === "done")}
                />
                <label onClick={() => toggleComp(item.id, item.text, item.state === "done")}>{item.text}</label>
              </div>
            ))}
          </>
        )}

        <div className="sec">Details — edit in place, saves as you go</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className="fld" style={{ flex: 1, minWidth: 118 }}>
            Due
            <input type="date" value={task.due ?? ""} onChange={(e) => patch({ due: e.target.value || undefined })} />
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 118 }}>
            Planned day
            <input
              type="date"
              value={task.scheduledFor ?? ""}
              onChange={(e) =>
                dispatch({ type: "scheduleTask", projectId, taskId, date: e.target.value || undefined })
              }
            />
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 96 }}>
            Priority
            <select value={task.urgency} onChange={(e) => patch({ urgency: e.target.value as Urgency })}>
              {URGENCIES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 84 }}>
            Time
            <select
              value={String(task.estimateMinutes ?? 30)}
              onChange={(e) => patch({ estimateMinutes: Number(e.target.value) })}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d >= 60 ? `${d / 60}h` : `${d}m`}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 140 }}>
            Project
            <select value={projectId} onChange={(e) => moveToProject(e.target.value)}>
              <option value={projectId}>{project.name}</option>
              {otherProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qk">
          <button className="btn" onClick={() => quickDue(0)}>
            Due today
          </button>
          <button className="btn" onClick={() => quickDue(1)}>
            Tomorrow
          </button>
          <button className="btn" onClick={() => quickDue(7)}>
            +1 week
          </button>
        </div>
        <label className="fld">
          Notes
          <textarea
            rows={2}
            defaultValue={task.notes ?? ""}
            onBlur={(e) => patch({ notes: e.target.value || undefined })}
          />
        </label>
        <label className="heavy-row">
          <input
            type="checkbox"
            checked={!!task.heavy}
            onChange={(e) => dispatch({ type: "setHeavy", projectId, taskId, heavy: e.target.checked })}
          />{" "}
          🔥 Heavy / aversive — the frog (bonus points)
        </label>
        {!task.done && (
          <div className="hold-row">
            {task.held ? (
              <>
                <span className="hold-status">⏸ Held — off the board until {task.scheduledFor ?? "?"}</span>
                <button
                  className="btn"
                  onClick={() => {
                    dispatch({ type: "releaseTask", projectId, taskId });
                    notify(`↩ ${task.title} is back on the board`);
                  }}
                >
                  ↩ Return to board now
                </button>
              </>
            ) : (
              (() => {
                // A hold needs a FUTURE return date — holding "until" today or a
                // past date would resurface immediately. Prefill only a planned
                // day that's already in the future; otherwise require a pick.
                const tomorrow = (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  return isoDate(d);
                })();
                const futurePlanned = task.scheduledFor && task.scheduledFor >= tomorrow ? task.scheduledFor : "";
                const until = holdDate || futurePlanned;
                return (
                  <>
                    <span className="hold-status">⏸ Hold — park it off the board until</span>
                    <input
                      type="date"
                      min={tomorrow}
                      value={until}
                      onChange={(e) => setHoldDate(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={!until || until < tomorrow}
                      title="A hold always needs a future return date"
                      onClick={() => {
                        if (!until || until < tomorrow) return;
                        dispatch({ type: "holdTask", projectId, taskId, until });
                        notify(`⏸ Held until ${until}`, () => dispatch({ type: "releaseTask", projectId, taskId }));
                      }}
                    >
                      ⏸ Hold
                    </button>
                  </>
                );
              })()
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button className="btn danger" onClick={del}>
            Delete
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
