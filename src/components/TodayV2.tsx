import { useEffect, useState } from "react";
import {
  assignedToDay,
  dayCapacityMinutes,
  dayFrogId,
  formatDuration,
  isoDate,
  taskMinutes,
  unassignedTasks,
  useStore,
  type PlanItem,
} from "../store";
import { TaskEditDialog } from "./TaskEditDialog";
import { readTaskDrag, setTaskDrag } from "./WeekStrip";

const DEFAULT_DAY_MINUTES = 8 * 60;
const GRID_PX = 230;
const SCALE_FLOOR_MIN = 4 * 60;
const MIN_BLOCK_PX = 20;

function shiftDay(days: number): { iso: string; label: string; sub: string } {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const iso = isoDate(d);
  const label =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
  const sub = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { iso, label, sub };
}

function minutesLeftToday(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 60000));
}

export function TodayV2({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [poolOver, setPoolOver] = useState(false);
  const [edit, setEdit] = useState<PlanItem | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayStr = isoDate(now);
  const frogId = dayFrogId(state);
  const pool = unassignedTasks(state);

  const days = Array.from({ length: 7 }, (_, i) => {
    const { iso, label, sub } = shiftDay(i);
    const isToday = i === 0;
    const items = assignedToDay(state, iso, isToday);
    const cap = dayCapacityMinutes(state, iso);
    const baseAvail = cap ?? DEFAULT_DAY_MINUTES;
    const avail = isToday ? Math.max(0, Math.min(baseAvail, minutesLeftToday(now))) : baseAvail;
    const planned = items.reduce((s, it) => s + taskMinutes(it.task), 0);
    return { iso, label, sub, isToday, cap, avail, items, planned };
  });

  const scaleMax = Math.max(SCALE_FLOOR_MIN, ...days.map((d) => Math.max(d.avail, d.planned)));
  const pxPerMin = GRID_PX / scaleMax;

  const schedule = (taskId: string, projectId: string, date: string | undefined) =>
    dispatch({ type: "scheduleTask", projectId, taskId, date });

  return (
    <div className="todayv2">
      <div className="todayv2__intro">
        <h2>The Week</h2>
        <p className="muted">
          Drag a task from the pool onto the day you'll do it. Each block is sized by its time, the shaded zone is
          the hours you have, and a day glows red when you've over-booked it.
        </p>
      </div>

      <div className="week-strip">
        {days.map(({ iso, label, sub, isToday, cap, avail, items, planned }) => {
          const over = planned > avail;
          const free = Math.max(0, avail - planned);
          const setCap = (m: number) => dispatch({ type: "setDayCapacity", date: iso, minutes: Math.max(0, m) });
          const availPx = Math.round(avail * pxPerMin);
          let used = 0;

          return (
            <div
              key={iso}
              className={`day-box ${isToday ? "is-today" : ""} ${dropDate === iso ? "is-drop" : ""} ${
                avail === 0 ? "is-spent" : ""
              } ${over ? "is-overbooked" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropDate !== iso) setDropDate(iso);
              }}
              onDragLeave={() => setDropDate((d) => (d === iso ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDropDate(null);
                const drag = readTaskDrag(e);
                if (drag) schedule(drag.taskId, drag.projectId, iso);
              }}
            >
              <div className="day-box__head">
                <span className="day-box__name">{label}</span>
                <span className="day-box__date muted">{sub}</span>
              </div>
              <div className="day-box__cap">
                <button className="cap-step" title="Half hour less" onClick={() => setCap((cap ?? DEFAULT_DAY_MINUTES) - 30)}>
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder={String(DEFAULT_DAY_MINUTES / 60)}
                  title={cap ? "Hours available" : `No hours set — assuming ${DEFAULT_DAY_MINUTES / 60}h`}
                  value={cap != null ? +(cap / 60).toFixed(1) : ""}
                  onChange={(e) => setCap(e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 60))}
                />
                <button className="cap-step" title="Half hour more" onClick={() => setCap((cap ?? DEFAULT_DAY_MINUTES) + 30)}>
                  +
                </button>
              </div>
              <div className={`day-box__free muted ${over ? "overdue" : ""}`}>
                {avail === 0 ? "day spent" : over ? `${formatDuration(planned - avail)} over` : `${cap ? "" : "~"}${formatDuration(free) || "0m"} free`}
              </div>

              <div className="day-grid" style={{ height: GRID_PX }}>
                {avail > 0 && <div className="day-grid__avail" style={{ height: Math.max(2, availPx) }} aria-hidden />}
                <div className="day-grid__stack">
                  {items.map((it) => {
                    const est = taskMinutes(it.task);
                    const fits = used + est <= avail;
                    used += est;
                    const px = Math.max(MIN_BLOCK_PX, Math.round(est * pxPerMin));
                    const isFrog = isToday && frogId === it.task.id;
                    return (
                      <div
                        key={it.task.id}
                        className={`time-block ${fits ? "" : "is-over"} ${isFrog ? "is-frog" : ""}`}
                        style={{ height: px, ["--accent" as string]: it.project.color }}
                        draggable
                        onDragStart={(e) => setTaskDrag(e, it.task.id, it.project.id)}
                        onClick={() => setEdit(it)}
                        title={`${it.task.title} · ${formatDuration(est)}${fits ? "" : " · doesn't fit"} — click to edit, drag to move`}
                      >
                        <span className="time-block__main">
                          <span className="time-block__title">
                            {isFrog ? "🐸 " : ""}
                            {it.task.heavy ? "🔥 " : ""}
                            {it.task.title}
                          </span>
                          {px >= 30 && <span className="time-block__est">{formatDuration(est)}</span>}
                        </span>
                        <span className="time-block__btns">
                          <button
                            className="time-block__done"
                            title="Mark done (earn points)"
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({ type: "toggleTask", projectId: it.project.id, taskId: it.task.id });
                            }}
                          >
                            ✓
                          </button>
                          {isToday && (
                            <button
                              className={`time-block__frog ${isFrog ? "is-on" : ""}`}
                              title={isFrog ? "Unfrog" : "Make this today's frog (do it first)"}
                              onClick={(e) => {
                                e.stopPropagation();
                                dispatch({ type: "chooseFrog", taskId: it.task.id });
                              }}
                            >
                              🐸
                            </button>
                          )}
                          <button
                            className="time-block__unassign"
                            title="Back to the pool (unassign)"
                            onClick={(e) => {
                              e.stopPropagation();
                              schedule(it.task.id, it.project.id, undefined);
                            }}
                          >
                            ↩
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="day-grid__empty muted">{avail === 0 ? "out of time" : "drop tasks here"}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* The pool: open tasks not yet assigned to a day. */}
      <div
        className={`pool ${poolOver ? "is-drop" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!poolOver) setPoolOver(true);
        }}
        onDragLeave={() => setPoolOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setPoolOver(false);
          const drag = readTaskDrag(e);
          if (drag) schedule(drag.taskId, drag.projectId, undefined);
        }}
      >
        <div className="pool__head">
          <h3>Unassigned ({pool.length})</h3>
          <span className="muted">
            {pool.length ? "Drag onto a day above to plan it. Overdue items wait here — they don't auto-schedule." : "All planned. 🎉"}
          </span>
        </div>
        <ul className="pool__list">
          {pool.map(({ task, project }) => {
            const overdue = task.due && task.due < todayStr;
            return (
              <li
                key={task.id}
                className="pool-chip"
                style={{ ["--accent" as string]: project.color }}
                draggable
                onDragStart={(e) => setTaskDrag(e, task.id, project.id)}
                onClick={() => setEdit({ task, project })}
                title={`${task.title} — drag to a day, click to edit`}
              >
                <span className="pool-chip__title">
                  {task.heavy ? "🔥 " : ""}
                  {task.title}
                </span>
                <span className="pool-chip__meta">
                  <button
                    className="link-chip"
                    style={{ ["--accent" as string]: project.color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenProject(project.id);
                    }}
                  >
                    {project.name}
                  </button>
                  <span className={`pill pill-${task.urgency}`}>{task.urgency}</span>
                  <span className="pill pill-time">⏱ {formatDuration(taskMinutes(task))}</span>
                  {task.due && <span className={`muted ${overdue ? "overdue" : ""}`}>{overdue ? "overdue " : "due "}{task.due}</span>}
                </span>
                <span className="pool-chip__quick">
                  <button
                    className="btn btn-sm btn-primary"
                    title="Mark done (earn points)"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "toggleTask", projectId: project.id, taskId: task.id });
                    }}
                  >
                    ✓ Done
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Plan for today"
                    onClick={(e) => {
                      e.stopPropagation();
                      schedule(task.id, project.id, todayStr);
                    }}
                  >
                    → Today
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete task"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${task.title}"?`)) dispatch({ type: "deleteTask", projectId: project.id, taskId: task.id });
                    }}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {edit && <TaskEditDialog projectId={edit.project.id} task={edit.task} onClose={() => setEdit(null)} />}
    </div>
  );
}
