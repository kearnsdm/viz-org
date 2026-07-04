import { useRef, useState } from "react";
import {
  assignedToDay,
  dayCapacityMinutes,
  formatDuration,
  isoDate,
  taskMinutes,
  unassignedTasks,
  useStore,
  weekDates,
} from "../store";
import type { Task } from "../types";

// The v3 week — the near slice of the same landscape, zoomed in. Day columns
// hold individual tasks at true height on a shared minutes-per-pixel scale.
// Each day has a dashed capacity line; everything stacked past it renders in
// the red hatch while the column keeps extending — the visible "not possible
// as planned". Unplaced tasks sit in a pool below with one-tap day buttons;
// placement is the user's choice — a due date is only a flag, never a rule.

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Shared vertical scale: pixels per minute. */
const PXM = 0.5;

function DueFlag({ task }: { task: Task }) {
  if (!task.due) return null;
  const late = task.due < isoDate(new Date());
  return <span className={`dueflag ${late ? "late" : "soon"}`}> {late ? "OVERDUE" : `due ${task.due.slice(5)}`}</span>;
}

export function WeekV3({
  onOpenTask,
}: {
  onOpenTask: (projectId: string, taskId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const drag = useRef<{ projectId: string; taskId: string } | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [poolOk, setPoolOk] = useState(false);

  const dates = weekDates();
  const today = isoDate(new Date());
  const pool = unassignedTasks(state);

  const place = (projectId: string, taskId: string, date?: string) =>
    dispatch({ type: "scheduleTask", projectId, taskId, date });

  return (
    <div className="view3">
      <div className="cap">
        <b>The near slice — zoomed in</b>
        <span>same tiles, same language, scoped to seven days</span>
      </div>
      <div className="wk">
        {dates.map((date, di) => {
          const cap = dayCapacityMinutes(state, date) ?? 0;
          const items = assignedToDay(state, date, date === today);
          const sum = items.reduce((s, it) => s + taskMinutes(it.task), 0);
          let acc = 0;
          return (
            <div
              key={date}
              className={`day3 ${date === today ? "today" : ""} ${dropDay === date ? "dropok" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropDay(date);
              }}
              onDragLeave={() => setDropDay((d) => (d === date ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDropDay(null);
                if (drag.current) {
                  place(drag.current.projectId, drag.current.taskId, date);
                  drag.current = null;
                }
              }}
            >
              <h4>
                {DAY_NAMES[di]}
                {date === today ? " · today" : ""}
                <b>
                  {sum ? formatDuration(sum) : "—"} / {cap ? formatDuration(cap) : "—"}
                </b>
              </h4>
              <div
                className="dcol"
                style={{ minHeight: Math.max(cap * PXM + 10, sum * PXM + 24) }}
              >
                {items.map(({ task, project }) => {
                  const startsOver = cap > 0 && acc >= cap;
                  acc += taskMinutes(task);
                  const crosses = cap > 0 && !startsOver && acc > cap;
                  const pressing = task.urgency === "urgent" || task.urgency === "high";
                  return (
                    <div
                      key={task.id}
                      className={`chip3 ${pressing ? "ur" : ""} ${startsOver || crosses ? "ovch" : ""}`}
                      style={{ ["--c" as string]: project.color, height: Math.max(22, taskMinutes(task) * PXM) }}
                      draggable
                      onDragStart={() => {
                        drag.current = { projectId: project.id, taskId: task.id };
                      }}
                      onClick={() => onOpenTask(project.id, task.id)}
                    >
                      <span className="ttl">
                        {task.heavy ? "🔥 " : ""}
                        {task.title}
                        <DueFlag task={task} />
                      </span>
                      <button
                        className="unp"
                        title="Back to the pool"
                        onClick={(e) => {
                          e.stopPropagation();
                          place(project.id, task.id, undefined);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {cap > 0 && (
                  <div className="capline" style={{ top: cap * PXM + 4 }}>
                    <span>cap {formatDuration(cap)}</span>
                  </div>
                )}
                {cap > 0 && sum > cap && (
                  <div className="ovlbl">+{formatDuration(sum - cap)} over — not possible as planned</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className={`pool3 ${poolOk ? "dropok" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setPoolOk(true);
        }}
        onDragLeave={() => setPoolOk(false)}
        onDrop={(e) => {
          e.preventDefault();
          setPoolOk(false);
          if (drag.current) {
            place(drag.current.projectId, drag.current.taskId, undefined);
            drag.current = null;
          }
        }}
      >
        <div className="sec">Unplanned — pull a task into a day (due date is a flag, not a placement rule)</div>
        {pool.length ? (
          pool.map(({ task, project }) => (
            <div
              key={task.id}
              className="prow"
              draggable
              onDragStart={() => {
                drag.current = { projectId: project.id, taskId: task.id };
              }}
            >
              <span className="swatch" style={{ background: project.color }} />
              <span className="ptt" title="Open task" onClick={() => onOpenTask(project.id, task.id)}>
                {task.heavy ? "🔥 " : ""}
                {task.title}
                <DueFlag task={task} />
              </span>
              <span className="pm">{taskMinutes(task)}m</span>
              <span className="dbs">
                {dates.map((d, di) => (
                  <button key={d} className="dbtn" title={DAY_NAMES[di]} onClick={() => place(project.id, task.id, d)}>
                    {DAY_NAMES[di][0]}
                  </button>
                ))}
              </span>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 12, color: "var(--lo)", padding: "8px 0" }}>Everything open is placed.</div>
        )}
      </div>
      <div className="hint">
        Drag a task from the pool into a day (letter buttons do the same on touch). The dashed red line is that day's
        capacity — everything past it is the visible "not possible as planned." Drag a chip back to the pool or tap ✕ to
        unplan; click opens its sheet.
      </div>
    </div>
  );
}
