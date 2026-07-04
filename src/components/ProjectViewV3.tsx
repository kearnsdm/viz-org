import { formatDuration, taskMinutes, useStore } from "../store";
import { headerText, InlineHours } from "./BoardV3";
import { useStreams } from "../streams";

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
    if (done) {
      dispatch({ type: "undoComplete", projectId, taskId });
      return;
    }
    dispatch({ type: "toggleTask", projectId, taskId });
    notify(`✓ ${title}`, () => dispatch({ type: "undoComplete", projectId, taskId }));
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
          {project.tasks.map((t) => {
            const pressing = t.urgency === "urgent" || t.urgency === "high";
            return (
              <div key={t.id} className={`row3 ${t.done ? "dn" : ""} ${pressing && !t.done ? "ur" : ""}`}>
                <input type="checkbox" checked={t.done} onChange={() => toggle(t.id, t.done, t.title)} />
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
              Nothing here yet — file something from Intake.
            </div>
          )}
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
