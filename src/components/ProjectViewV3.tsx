import { useState } from "react";
import { formatDuration, sortTasksForDisplay, taskMinutes, useStore } from "../store";
import { headerText, InlineHours } from "./BoardV3";
import { useStreams } from "../streams";
import { useReinforcement } from "../reinforcement";

/** Curated box hues — spaced so no two confusables sit together. Hue stays
 * the category channel; picking a color here recolors the whole box family
 * (board tile, stripes, week chips) at once. */
export const COLOR_CHOICES = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#64748b", // slate
];

// The v3 project screen — the box, zoomed all the way in. The surface you
// entered through is the exit: clicking the header (or the app logo) returns
// to the board. Task rows open the unified Task Sheet; the checkbox completes
// (guarded by the Undo toast).

export function ProjectViewV3({
  projectId,
  onBack,
  onWeek,
  onOpenTask,
  onSprint,
  notify,
}: {
  projectId: string;
  onBack: () => void;
  onWeek: () => void;
  onOpenTask: (taskId: string) => void;
  onSprint: () => void;
  notify: (msg: string, undo?: () => void) => void;
}) {
  const { state, dispatch } = useStore();
  const { streams } = useStreams();
  const { dispatchR } = useReinforcement();
  const [showDone, setShowDone] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;

  const taskIds = new Set(project.tasks.map((t) => t.id));
  const stream =
    streams.find((s) => s.taskId && taskIds.has(s.taskId)) ??
    streams.find((s) => s.category.trim().toLowerCase() === project.name.trim().toLowerCase());
  const checkEvents = stream ? stream.history.filter((e) => e.kind === "check").length : 0;
  const doneCount = project.tasks.filter((t) => t.done).length;
  const ct = headerText(project.color);

  const toggle = (taskId: string, done: boolean, title: string) => {
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (done) {
      dispatch({ type: "undoComplete", projectId, taskId });
      dispatchR({ type: "unclose", task });
      return;
    }
    const stream = streams.find((s) => s.taskId === taskId);
    dispatch({ type: "toggleTask", projectId, taskId });
    dispatchR({ type: "close", task, stream });
    notify(`✓ ${title}`, () => {
      dispatch({ type: "undoComplete", projectId, taskId });
      dispatchR({ type: "unclose", task });
    });
  };

  return (
    <div className="view3">
      <div className="tk">
        <div
          className="tkh"
          style={{ ["--c" as string]: project.color, ["--ct" as string]: ct }}
          title="Zoom out to the board"
          onClick={onBack}
        >
          {stream && <span className="gl">{stream.glyph}</span>}
          <div>
            <div className="nm">{project.name}</div>
            <div className="cd">
              {stream ? `stream · codename ${stream.codename}` : "no stream bound — say “start a stream” in chat"}
            </div>
          </div>
          <div className="sp" />
          <span className="tkhours" onClick={(e) => e.stopPropagation()}>
            intended{" "}
            <InlineHours
              capacity={project.capacity}
              stop
              onSave={(hours) => dispatch({ type: "setCapacity", projectId, capacity: hours })}
            />
          </span>
          <button
            className="btn pri"
            onClick={(e) => {
              e.stopPropagation();
              onSprint();
            }}
          >
            ▶ Just start
          </button>
        </div>
        <div className="tkb" style={{ ["--c" as string]: project.color }}>
          <div className="sec">Checklist — each stripe is one task</div>
          {sortTasksForDisplay(project.tasks.filter((t) => !t.held && !t.done)).map((t) => {
            const pressing = t.urgency === "urgent" || t.urgency === "high";
            return (
              <div key={t.id} className={`row3 ${pressing ? "ur" : ""}`}>
                <input type="checkbox" checked={false} onChange={() => toggle(t.id, false, t.title)} />
                <label title="Open task" onClick={() => onOpenTask(t.id)}>
                  {t.heavy ? "🔥 " : ""}
                  {t.title}
                </label>
                <span className="m">
                  {formatDuration(taskMinutes(t))}
                  {t.urgency === "urgent" ? " · urgent" : ""}
                </span>
              </div>
            );
          })}
          {project.tasks.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--lo)", padding: "8px 0" }}>
              Nothing here yet — file something from Intake, or add one below.
            </div>
          )}
          {/* Add a task in place — Enter files it into this box (normal, 30m
              defaults; open its sheet to set due/urgency/estimate). */}
          <div className="addrow3">
            <span className="addplus">+</span>
            <input
              value={newTitle}
              placeholder="Add a task to this box…"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const title = newTitle.trim();
                  if (!title) return;
                  dispatch({ type: "addTask", projectId, title });
                  setNewTitle("");
                  notify(`+ ${title}`);
                }
              }}
            />
          </div>
          {/* Finished work folds away — the count stays, the noise goes. */}
          {project.tasks.some((t) => t.done) && (
            <>
              <div className="sec donesec" onClick={() => setShowDone((v) => !v)} title="Show / hide finished tasks">
                {showDone ? "▾" : "▸"} ✓ Done ({project.tasks.filter((t) => t.done).length}) — cleared from the live
                list; also in the Archive
              </div>
              {showDone &&
                project.tasks
                  .filter((t) => t.done)
                  .map((t) => (
                    <div key={t.id} className="row3 dn">
                      <input type="checkbox" checked onChange={() => toggle(t.id, true, t.title)} />
                      <label title="Open task" onClick={() => onOpenTask(t.id)}>
                        {t.heavy ? "🔥 " : ""}
                        {t.title}
                      </label>
                      <span className="m">{formatDuration(taskMinutes(t))}</span>
                    </div>
                  ))}
            </>
          )}
          {/* Held tasks are parked off the active list; a muted footnote keeps
              them findable here (they live in the board's Holding mode). */}
          {project.tasks.some((t) => t.held && !t.done) && (
            <>
              <div className="sec">⏸ On hold — off the board until their return date</div>
              {project.tasks
                .filter((t) => t.held && !t.done)
                .map((t) => (
                  <div key={t.id} className="row3 heldrow">
                    <label title="Open task" onClick={() => onOpenTask(t.id)}>
                      {t.heavy ? "🔥 " : ""}
                      {t.title}
                    </label>
                    <span className="m">
                      {formatDuration(taskMinutes(t))} · ↩ {t.scheduledFor?.slice(5) ?? "—"}
                    </span>
                  </div>
                ))}
            </>
          )}
          <div className="sec">Box color — hue is this box's identity everywhere</div>
          <div className="swrow">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                className={`sw ${project.color.toLowerCase() === c ? "on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => dispatch({ type: "setColor", projectId, color: c })}
              />
            ))}
          </div>
          <div className="sec">History (append-only — nothing is ever destroyed)</div>
          <div className="hist">
            {stream ? `create → bind → ${checkEvents} check event(s)` : `${doneCount} completion(s) on this box`}. Replans
            fold removed items in as <i>dropped</i>.
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn" onClick={onBack}>
              ‹ zoom out to landscape
            </button>
            <button className="btn" onClick={onWeek}>
              ‹ zoom to week
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
