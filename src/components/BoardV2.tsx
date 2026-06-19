import { useEffect, useRef, useState } from "react";
import {
  FALLBACK_TASK_MINUTES,
  formatDuration,
  projectWorkMinutes,
  taskMinutes,
  totalWorkMinutes,
  weeklyBudgetMinutes,
  useStore,
} from "../store";
import { squarify, type TreemapItem } from "../treemap";
import type { Project } from "../types";

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

const FREE_ID = "__free__";

/** A project box on the time board: sized by work-minutes, filled with one
 * subtle band per open task (band height ∝ that task's time). */
function ProjectBox({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const mins = projectWorkMinutes(project);
  const open = project.tasks.filter((t) => !t.done);
  const urgent = open.filter((t) => t.urgency === "urgent" || t.urgency === "high").length;

  return (
    <button
      className="tboard-box"
      style={{ ["--accent" as string]: project.color }}
      onClick={onOpen}
      title={`${project.name} — ${formatDuration(mins) || "0m"} of work · click to open`}
    >
      {/* Per-task bands: a quiet stripe per task, sized by its time. */}
      <span className="tboard-box__bands" aria-hidden>
        {open.map((t, i) => (
          <span
            key={t.id}
            className="tboard-band"
            style={{
              flexGrow: taskMinutes(t),
              background: `color-mix(in srgb, var(--accent) ${i % 2 ? 30 : 20}%, transparent)`,
            }}
            title={`${t.title} · ${formatDuration(taskMinutes(t))}${t.estimateMinutes ? "" : " (est.)"}`}
          >
            <span className="tboard-band__label">{t.title}</span>
          </span>
        ))}
      </span>
      <span className="tboard-box__body">
        <span className="tboard-box__name">
          {project.isAdmin && <span className="pill pill-admin">admin</span>}
          {project.name}
        </span>
        <span className="tboard-box__meta">
          <span className="pill pill-time">⏱ {formatDuration(mins) || "0m"}</span>
          <span className="muted">{open.length} open</span>
          {urgent > 0 && <span className="pill pill-urgent">{urgent} pressing</span>}
        </span>
      </span>
    </button>
  );
}

export function BoardV2({
  onOpenProject,
  onAddProject,
}: {
  onOpenProject: (id: string) => void;
  onAddProject: () => void;
}) {
  const { state, dispatch } = useStore();
  const { ref, size } = useMeasure<HTMLDivElement>();

  const budget = weeklyBudgetMinutes(state);
  const work = totalWorkMinutes(state);
  const over = work > budget;
  const free = Math.max(0, budget - work);
  const pct = Math.min(100, Math.round((work / Math.max(1, budget)) * 100));
  const hours = state.weeklyHours ?? 40;

  const items: TreemapItem[] = state.projects
    .map((p) => ({ id: p.id, weight: Math.max(1, projectWorkMinutes(p)) }))
    .filter((i) => i.weight > 0);
  if (free > 0) items.push({ id: FREE_ID, weight: free });

  const rects = size.w > 0 && size.h > 0 ? squarify(items, { x: 0, y: 0, w: size.w, h: size.h }) : [];

  return (
    <div className="board-panel">
      <div className="board-heading">
        <h2>The Board — your work time</h2>
        <p className="muted">
          Boxes are sized by the hours of work they hold; each stripe is one task. Empty space is unbooked time.
        </p>
        <div className="tboard-budget">
          <div className="tboard-meter">
            <div
              className={`tboard-meter__fill ${over ? "is-over" : ""}`}
              style={{ width: `${over ? 100 : pct}%` }}
            />
          </div>
          <div className="tboard-budget__row">
            <span className={over ? "overdue" : "muted"}>
              <strong>{formatDuration(work) || "0m"}</strong> of work
              {over ? (
                <> · {formatDuration(work - budget)} over budget</>
              ) : (
                <> · {formatDuration(free) || "0m"} free</>
              )}
            </span>
            <label className="cap-control">
              weekly budget
              <button className="cap-step" title="−1h" onClick={() => dispatch({ type: "setWeeklyHours", hours: hours - 1 })}>
                −
              </button>
              <input
                type="number"
                min={1}
                value={hours}
                onChange={(e) => dispatch({ type: "setWeeklyHours", hours: Number(e.target.value) })}
              />
              <button className="cap-step" title="+1h" onClick={() => dispatch({ type: "setWeeklyHours", hours: hours + 1 })}>
                +
              </button>
              h/wk
            </label>
          </div>
        </div>
      </div>

      {over && (
        <div className="tboard-overflow">
          ⚠ You've booked <strong>{formatDuration(work - budget)}</strong> more work than your {hours}h week holds.
          Trim, delegate, or push some of it to next week.
        </div>
      )}

      <div className="board-canvas tboard-canvas" ref={ref}>
        {rects.map((r) => {
          const stylePos = { left: r.x, top: r.y, width: Math.max(0, r.w - 6), height: Math.max(0, r.h - 6) };
          if (r.id === FREE_ID) {
            return (
              <div key={r.id} className="free-box" style={stylePos}>
                <button className="free-box__btn" onClick={onAddProject}>
                  <span className="free-box__plus">+</span>
                  <span>Unbooked time</span>
                  <span className="muted">{formatDuration(free)} free — add a project</span>
                </button>
              </div>
            );
          }
          const project = state.projects.find((p) => p.id === r.id);
          if (!project) return null;
          return (
            <div key={r.id} className="box-slot" style={stylePos}>
              <ProjectBox project={project} onOpen={() => onOpenProject(project.id)} />
            </div>
          );
        })}
        {rects.length === 0 && (
          <div className="board-empty muted">
            No work booked yet. Add a project, or assume {FALLBACK_TASK_MINUTES}m per unestimated task.
          </div>
        )}
      </div>
    </div>
  );
}
