import { useState } from "react";
import {
  buildDailyPlan,
  dayCapacityMinutes,
  formatDuration,
  isoDate,
  tasksForDay,
  useStore,
  type DayBoxItem,
} from "../store";
import { TaskEditDialog } from "./TaskEditDialog";

/** Read a dragged task payload written by a plan row or day chip. */
export function readTaskDrag(e: React.DragEvent): { taskId: string; projectId: string } | null {
  try {
    const data = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (data && typeof data.taskId === "string" && typeof data.projectId === "string") return data;
  } catch {
    /* not a task payload */
  }
  return null;
}

/** Write a dragged task payload onto a drag event. */
export function setTaskDrag(e: React.DragEvent, taskId: string, projectId: string): void {
  e.dataTransfer.setData("text/plain", JSON.stringify({ taskId, projectId }));
  e.dataTransfer.effectAllowed = "move";
}

function shiftDay(days: number): { iso: string; label: string; sub: string } {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const iso = isoDate(d);
  const label =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
  const sub = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { iso, label, sub };
}

/**
 * The rolling 7-day strip: one box per day showing its capacity (hours you've
 * given it), the time already planned into it, and the tasks scheduled there.
 * Drag any task onto a day to plan it for that day; drag back to Today to
 * reclaim it.
 */
export function WeekStrip() {
  const { state, dispatch } = useStore();
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [edit, setEdit] = useState<DayBoxItem | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => shiftDay(i));
  const todayPlan = buildDailyPlan(state);
  const todayMinutes = todayPlan.reduce((s, i) => s + (i.task.estimateMinutes ?? 0), 0);

  const onDrop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDropDate(null);
    const drag = readTaskDrag(e);
    if (drag) dispatch({ type: "scheduleTask", projectId: drag.projectId, taskId: drag.taskId, date });
  };

  return (
    <div className="week-strip">
      {days.map(({ iso, label, sub }, i) => {
        const isToday = i === 0;
        const items = isToday ? [] : tasksForDay(state, iso);
        const planned = isToday
          ? todayMinutes
          : items.reduce((s, it) => s + (it.task.estimateMinutes ?? 0), 0);
        const cap = dayCapacityMinutes(state, iso);
        const over = !!cap && planned > cap;
        const free = cap ? Math.max(0, cap - planned) : undefined;
        return (
          <div
            key={iso}
            className={`day-box ${isToday ? "is-today" : ""} ${dropDate === iso ? "is-drop" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (dropDate !== iso) setDropDate(iso);
            }}
            onDragLeave={() => setDropDate((d) => (d === iso ? null : d))}
            onDrop={(e) => onDrop(e, iso)}
          >
            <div className="day-box__head">
              <span className="day-box__name">{label}</span>
              <span className="day-box__date muted">{sub}</span>
            </div>
            <div className="day-box__cap">
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="hrs"
                title="Hours available this day"
                value={cap != null ? +(cap / 60).toFixed(1) : ""}
                onChange={(e) =>
                  dispatch({ type: "setDayCapacity", date: iso, minutes: Math.round(Number(e.target.value) * 60) })
                }
              />
              <span className={`muted ${over ? "overdue" : ""}`}>
                {cap
                  ? over
                    ? `${formatDuration(planned - cap)} over`
                    : `${formatDuration(free) || "0m"} free`
                  : "set hrs"}
              </span>
            </div>
            {!!cap && (
              <div className="day-box__bar">
                <div
                  className={`day-box__bar-fill ${over ? "is-over" : ""}`}
                  style={{ width: `${Math.min(100, Math.round((planned / cap) * 100))}%` }}
                />
              </div>
            )}
            {isToday ? (
              <div className="day-box__today muted">
                {todayPlan.length} task{todayPlan.length === 1 ? "" : "s"}
                {todayMinutes ? ` · ${formatDuration(todayMinutes)}` : ""} — the list below.
                <br />
                Drop here to bring a task back.
              </div>
            ) : (
              <ul className="day-box__list">
                {items.map((it) => (
                  <li
                    key={it.task.id}
                    className={`day-chip day-chip--${it.reason}`}
                    draggable
                    onDragStart={(e) => setTaskDrag(e, it.task.id, it.project.id)}
                    onClick={() => setEdit(it)}
                    title={`${it.task.title} (${it.reason}) — drag to another day, click to edit`}
                  >
                    <span className="day-chip__dot" style={{ background: it.project.color }} />
                    <span className="day-chip__title">
                      {it.reason === "snoozed" ? "💤 " : ""}
                      {it.task.title}
                    </span>
                    {it.task.estimateMinutes ? (
                      <span className="day-chip__est muted">{formatDuration(it.task.estimateMinutes)}</span>
                    ) : null}
                  </li>
                ))}
                {items.length === 0 && <li className="day-box__empty muted">drop tasks here</li>}
              </ul>
            )}
          </div>
        );
      })}
      {edit && <TaskEditDialog projectId={edit.project.id} task={edit.task} onClose={() => setEdit(null)} />}
    </div>
  );
}
