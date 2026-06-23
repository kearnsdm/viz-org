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
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    // Measure immediately (and next frame) rather than waiting on the first
    // ResizeObserver callback, which can be skipped on initial mount.
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return { ref, size };
}

const FREE_ID = "__free__";

/** Reserved for the name/time header inside a box, in px. */
const HEADER_PX = 26;
/** A stripe needs at least this many px of height before it shows its label. */
const LABEL_MIN_PX = 15;

/** A project box on the time board: sized by work-minutes, filled with one
 * stripe per open task (stripe height ∝ that task's time). Detail is adaptive
 * to the box's size — a header with the name and total time, plus a label on
 * each stripe that has room for it; small boxes stay clean with just the name.
 * Everything still has a hover tooltip. */
function ProjectBox({ project, w, h, onOpen }: { project: Project; w: number; h: number; onOpen: () => void }) {
  const mins = projectWorkMinutes(project);
  const open = project.tasks.filter((t) => !t.done);
  const urgent = open.filter((t) => t.urgency === "urgent" || t.urgency === "high").length;
  const summary = `${project.name} — ${formatDuration(mins) || "0m"} of work · ${open.length} open${
    urgent ? ` · ${urgent} pressing` : ""
  } · click to open`;

  const showTime = w >= 92 && mins > 0;
  const bandsArea = Math.max(0, h - HEADER_PX);

  return (
    <button className="tboard-box" style={{ ["--accent" as string]: project.color }} onClick={onOpen} title={summary}>
      <span className="tboard-box__header">
        {project.isAdmin && <span className="pill pill-admin">admin</span>}
        <span className="tboard-box__nametext">{project.name}</span>
        {showTime && <span className="tboard-box__time">{formatDuration(mins)}</span>}
      </span>
      <span className="tboard-box__bands">
        {open.map((t, i) => {
          const m = taskMinutes(t);
          const bandPx = mins > 0 ? (m / mins) * bandsArea : 0;
          const pressing = t.urgency === "urgent" || t.urgency === "high";
          return (
            <span
              key={t.id}
              className={`tboard-band ${pressing ? "is-pressing" : ""}`}
              style={{
                flexGrow: m,
                background: `color-mix(in srgb, var(--accent) ${i % 2 ? 30 : 18}%, transparent)`,
              }}
              title={`${t.title} · ${formatDuration(m)}${t.estimateMinutes ? "" : " (est.)"}`}
            >
              {bandPx >= LABEL_MIN_PX && w >= 92 && <span className="tboard-band__label">{t.title}</span>}
            </span>
          );
        })}
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
              <ProjectBox project={project} w={stylePos.width} h={stylePos.height} onOpen={() => onOpenProject(project.id)} />
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
