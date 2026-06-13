import { useEffect, useState } from "react";
import {
  buildDailyPlan,
  dayCapacityMinutes,
  formatDuration,
  isoDate,
  tasksForDay,
  useStore,
  type DayBoxReason,
  type PlanItem,
} from "../store";
import { TaskEditDialog } from "./TaskEditDialog";

/** Read a dragged task payload written by a plan row or day block. */
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

/** A full workday assumed for days where no hours have been set. */
const DEFAULT_DAY_MINUTES = 8 * 60;
/** Unestimated tasks block out a half hour on the grid. */
const FALLBACK_ESTIMATE = 30;

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

type BlockItem = PlanItem & { reason?: DayBoxReason };

/**
 * The rolling 7-day strip as a map of time: each day's box is sized in
 * proportion to the time actually available that day (set hours, or an
 * assumed 8h workday — and for today, never more than what's left of the day,
 * so a mostly-spent day looks mostly spent). Tasks render as blocks sized by
 * their estimates, stacked into the day's grid; blocks that don't fit the
 * available time show as overflowing. Drag any task onto a day to plan it
 * there; drag back to Today to reclaim it.
 */
export function WeekStrip() {
  const { state, dispatch } = useStore();
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [edit, setEdit] = useState<BlockItem | null>(null);

  // Re-render every minute so today's remaining time stays honest.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = Array.from({ length: 7 }, (_, i) => shiftDay(i));
  const todayPlan = buildDailyPlan(state);

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
        const items: BlockItem[] = isToday ? todayPlan : tasksForDay(state, iso);
        const cap = dayCapacityMinutes(state, iso);
        const base = cap ?? DEFAULT_DAY_MINUTES;
        const avail = isToday ? Math.max(0, Math.min(base, minutesLeftToday(now))) : base;
        const setCap = (minutes: number) =>
          dispatch({ type: "setDayCapacity", date: iso, minutes: Math.max(0, minutes) });

        // Stack blocks into the grid; once the cumulative estimate exceeds
        // what's available, the rest visibly don't fit.
        let used = 0;
        const blocks = items.map((it) => {
          const est = it.task.estimateMinutes ?? FALLBACK_ESTIMATE;
          const fits = used + est <= avail;
          used += est;
          return { it, est, fits };
        });
        const planned = used;
        const over = planned > avail;
        const free = Math.max(0, avail - planned);

        return (
          <div
            key={iso}
            className={`day-box ${isToday ? "is-today" : ""} ${dropDate === iso ? "is-drop" : ""} ${
              avail === 0 ? "is-spent" : ""
            }`}
            style={{ flexGrow: Math.max(avail, 45), flexBasis: 0 }}
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
              <button className="cap-step" title="Half hour less" onClick={() => setCap((cap ?? DEFAULT_DAY_MINUTES) - 30)}>
                −
              </button>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder={String(DEFAULT_DAY_MINUTES / 60)}
                title={cap ? "Hours available this day" : `No hours set — assuming a ${DEFAULT_DAY_MINUTES / 60}h workday`}
                value={cap != null ? +(cap / 60).toFixed(1) : ""}
                onChange={(e) => setCap(e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 60))}
              />
              <button className="cap-step" title="Half hour more" onClick={() => setCap((cap ?? DEFAULT_DAY_MINUTES) + 30)}>
                +
              </button>
              <span className={`day-box__free muted ${over ? "overdue" : ""}`}>
                {avail === 0
                  ? "day spent"
                  : over
                    ? `${formatDuration(planned - avail)} over`
                    : `${cap ? "" : "~"}${formatDuration(free) || "0m"} free`}
              </span>
            </div>
            <div
              className="day-grid"
              title={
                isToday
                  ? `${formatDuration(avail) || "0m"} left today · ${formatDuration(planned) || "0m"} planned`
                  : `${formatDuration(avail)} available · ${formatDuration(planned) || "0m"} planned`
              }
            >
              {blocks.map(({ it, est, fits }) => (
                <div
                  key={it.task.id}
                  className={`time-block ${fits ? "" : "is-over"} ${it.reason === "due" ? "is-ghost" : ""}`}
                  style={{
                    height: `${Math.max(9, Math.round((est / Math.max(avail, 60)) * 100))}%`,
                    ["--accent" as string]: it.project.color,
                  }}
                  draggable
                  onDragStart={(e) => setTaskDrag(e, it.task.id, it.project.id)}
                  onClick={() => setEdit(it)}
                  title={`${it.task.title} — ${it.task.estimateMinutes ? "" : "no estimate, assuming "}${formatDuration(est)}${
                    fits ? "" : " · DOESN'T FIT"
                  }${it.reason === "due" ? " · due this day (not yet planned)" : ""} — drag to move, click to edit`}
                >
                  <span className="time-block__title">
                    {it.reason === "snoozed" ? "💤 " : ""}
                    {it.task.title}
                  </span>
                  <span className="time-block__est">
                    {it.task.estimateMinutes ? formatDuration(est) : `~${formatDuration(est)}`}
                  </span>
                </div>
              ))}
              {items.length === 0 && (
                <div className="day-grid__empty muted">{avail === 0 ? "out of time" : "open time — drop tasks here"}</div>
              )}
            </div>
          </div>
        );
      })}
      {edit && <TaskEditDialog projectId={edit.project.id} task={edit.task} onClose={() => setEdit(null)} />}
    </div>
  );
}
