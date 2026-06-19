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
/** Tallest a day column gets, in px — the busiest day's time fills this. */
const GRID_PX = 230;
/** Floor for the shared scale so a light week doesn't balloon each task. */
const SCALE_FLOOR_MIN = 4 * 60;
/** Smallest block height so even a 5-minute task stays clickable. */
const MIN_BLOCK_PX = 20;

type BlockItem = PlanItem & { reason?: DayBoxReason };

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

/**
 * The rolling 7-day strip as a shared map of time. Every day uses the SAME
 * vertical scale (pixels per minute), so a 30-minute task is the same height
 * on Monday as on Saturday and days are directly comparable. Each day shows a
 * shaded "available time" zone (set hours, or an assumed 8h workday — and for
 * today, never more than the hours actually left); tasks stack as blocks sized
 * by their estimate, and anything past the capacity line visibly doesn't fit.
 * Drag a task onto a day to plan it there, or use × to remove it.
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

  const todayPlan = buildDailyPlan(state);

  // First pass: gather each day's available minutes and its task blocks.
  const days = Array.from({ length: 7 }, (_, i) => {
    const { iso, label, sub } = shiftDay(i);
    const isToday = i === 0;
    const items: BlockItem[] = isToday ? todayPlan : tasksForDay(state, iso);
    const cap = dayCapacityMinutes(state, iso);
    const baseAvail = cap ?? DEFAULT_DAY_MINUTES;
    const avail = isToday ? Math.max(0, Math.min(baseAvail, minutesLeftToday(now))) : baseAvail;

    let used = 0;
    const blocks = items.map((it) => {
      const est = it.task.estimateMinutes ?? FALLBACK_ESTIMATE;
      const fits = used + est <= avail;
      used += est;
      return { it, est, fits };
    });
    return { iso, label, sub, isToday, cap, avail, blocks, planned: used };
  });

  // Shared scale: the day needing the most vertical room fills GRID_PX.
  const scaleMax = Math.max(SCALE_FLOOR_MIN, ...days.map((d) => Math.max(d.avail, d.planned)));
  const pxPerMin = GRID_PX / scaleMax;

  const onDrop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setDropDate(null);
    const drag = readTaskDrag(e);
    if (drag) dispatch({ type: "scheduleTask", projectId: drag.projectId, taskId: drag.taskId, date });
  };

  return (
    <div className="week-strip">
      {days.map(({ iso, label, sub, isToday, cap, avail, blocks, planned }) => {
        const over = planned > avail;
        const free = Math.max(0, avail - planned);
        const setCap = (minutes: number) =>
          dispatch({ type: "setDayCapacity", date: iso, minutes: Math.max(0, minutes) });
        const availPx = Math.round(avail * pxPerMin);

        return (
          <div
            key={iso}
            className={`day-box ${isToday ? "is-today" : ""} ${dropDate === iso ? "is-drop" : ""} ${
              avail === 0 ? "is-spent" : ""
            }`}
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
            </div>
            <div className={`day-box__free muted ${over ? "overdue" : ""}`}>
              {avail === 0
                ? "day spent"
                : over
                  ? `${formatDuration(planned - avail)} over`
                  : `${cap ? "" : "~"}${formatDuration(free) || "0m"} free of ${formatDuration(avail)}`}
            </div>

            <div className="day-grid" style={{ height: GRID_PX }}>
              {/* Shaded available-time zone, with the capacity line at its base. */}
              {avail > 0 && <div className="day-grid__avail" style={{ height: Math.max(2, availPx) }} aria-hidden />}
              <div className="day-grid__stack">
                {blocks.map(({ it, est, fits }) => {
                  const px = Math.max(MIN_BLOCK_PX, Math.round(est * pxPerMin));
                  return (
                    <div
                      key={it.task.id}
                      className={`time-block ${fits ? "" : "is-over"} ${it.reason === "due" ? "is-ghost" : ""}`}
                      style={{ height: px, ["--accent" as string]: it.project.color }}
                      draggable
                      onDragStart={(e) => setTaskDrag(e, it.task.id, it.project.id)}
                      onClick={() => setEdit(it)}
                      title={`${it.task.title} — ${it.task.estimateMinutes ? "" : "no estimate, assuming "}${formatDuration(
                        est,
                      )}${fits ? "" : " · doesn't fit the day"}${
                        it.reason === "due" ? " · due this day (not yet planned)" : ""
                      } — click to edit, drag to move`}
                    >
                      <span className="time-block__main">
                        <span className="time-block__title">
                          {it.reason === "snoozed" ? "💤 " : ""}
                          {it.task.title}
                        </span>
                        {px >= 30 && (
                          <span className="time-block__est">
                            {it.task.estimateMinutes ? formatDuration(est) : `~${formatDuration(est)}`}
                          </span>
                        )}
                      </span>
                      <button
                        className="time-block__del"
                        title="Remove this task"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${it.task.title}"?`)) {
                            dispatch({ type: "deleteTask", projectId: it.project.id, taskId: it.task.id });
                          }
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {blocks.length === 0 && (
                  <div className="day-grid__empty muted">{avail === 0 ? "out of time" : "open — drop tasks here"}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {edit && <TaskEditDialog projectId={edit.project.id} task={edit.task} onClose={() => setEdit(null)} />}
    </div>
  );
}
