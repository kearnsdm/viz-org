import { useState } from "react";
import {
  buildDailyPlan,
  dayCapacityMinutes,
  dayFrogId,
  formatDuration,
  isDayStarted,
  isoDate,
  lockedHeavyIds,
  snoozedForToday,
  useStore,
  type PlanItem,
} from "../store";
import {
  BADGES,
  POINTS_PER_CREDIT,
  availableCredits,
  level,
  pointsToNextCredit,
  taskPoints,
  withGame,
} from "../game";
import { FocusTimer } from "./FocusTimer";
import { UnstickPanel } from "./UnstickPanel";
import { TaskEditDialog } from "./TaskEditDialog";
import { WeekStrip, readTaskDrag, setTaskDrag } from "./WeekStrip";

function pickFrog(plan: PlanItem[]): PlanItem | null {
  if (plan.length === 0) return null;
  const heavy = plan.filter((i) => i.task.heavy);
  const pool = heavy.length ? heavy : plan;
  return [...pool].sort((a, b) => taskPoints(b.task) - taskPoints(a.task))[0];
}

export function TodayView({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const game = withGame(state.game);
  const plan = buildDailyPlan(state);
  const todayStr = isoDate(new Date());
  const credits = availableCredits(game);
  const pct = Math.round(((POINTS_PER_CREDIT - pointsToNextCredit(game)) / POINTS_PER_CREDIT) * 100);
  const totalMinutes = plan.reduce((s, { task }) => s + (task.estimateMinutes ?? 0), 0);

  const started = isDayStarted(state);
  const locked = lockedHeavyIds(state);
  const frogId = dayFrogId(state);
  // The frog must be something still on today's plate; if it's deferred out,
  // fall back to a suggestion. (findTaskItem kept for callers elsewhere.)
  const chosenFrog = frogId ? plan.find((i) => i.task.id === frogId) : undefined;
  const frog = chosenFrog ?? pickFrog(plan);
  const frogIsChosen = !!chosenFrog;

  const [timer, setTimer] = useState<{ title: string } | null>(null);
  const [stuck, setStuck] = useState<PlanItem | null>(null);
  const [edit, setEdit] = useState<PlanItem | null>(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [overTaskId, setOverTaskId] = useState<string | null>(null);

  // Drop the dragged task just above the target row and persist the order.
  const dropBefore = (dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    const ids = plan.map((i) => i.task.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    dispatch({ type: "reorderToday", ids });
  };

  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  })();
  const cap = dayCapacityMinutes(state);
  const planned = totalMinutes;
  const overMin = cap ? Math.max(0, planned - cap) : 0;
  const snoozed = snoozedForToday(state);

  // Keep the most important tasks that fit in today's capacity; snooze the rest.
  const autoFit = () => {
    if (!cap) return;
    const rank = (t: PlanItem["task"]) =>
      t.urgency === "urgent" ? 0 : t.urgency === "high" ? 1 : t.due && t.due <= todayStr ? 1 : 2;
    const ordered = [...plan].sort((a, b) => {
      if (frogId) {
        if (a.task.id === frogId) return -1;
        if (b.task.id === frogId) return 1;
      }
      const ra = rank(a.task);
      const rb = rank(b.task);
      if (ra !== rb) return ra - rb;
      const ad = a.task.due ?? "9999-99-99";
      const bd = b.task.due ?? "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      if (!!b.task.heavy !== !!a.task.heavy) return (b.task.heavy ? 1 : 0) - (a.task.heavy ? 1 : 0);
      return taskPoints(b.task) - taskPoints(a.task);
    });
    const keep = new Set<string>();
    let used = 0;
    for (const it of ordered) {
      const m = it.task.estimateMinutes ?? 30;
      if (keep.size === 0 || used + m <= cap) {
        keep.add(it.task.id);
        used += m;
      }
    }
    const overflow = plan.filter((i) => !keep.has(i.task.id)).map((i) => i.task.id);
    if (overflow.length) dispatch({ type: "snoozeMany", ids: overflow, until: tomorrow });
  };

  const row = (item: PlanItem, isFrog = false) => {
    const { task, project } = item;
    const overdue = task.due && task.due < todayStr;
    const heavyLocked = started && locked.includes(task.id);
    const isChosenFrog = frogId === task.id;
    const draggable = !isFrog;
    return (
      <li
        key={task.id}
        className={`plan-item ${isFrog ? "is-frog" : ""} ${dragTaskId === task.id ? "is-dragging" : ""} ${
          draggable && overTaskId === task.id && dragTaskId ? "is-drop-before" : ""
        }`}
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                setTaskDrag(e, task.id, project.id);
                setDragTaskId(task.id);
              }
            : undefined
        }
        onDragEnd={() => {
          setDragTaskId(null);
          setOverTaskId(null);
        }}
        onDragOver={
          draggable
            ? (e) => {
                if (dragTaskId === task.id) return;
                e.preventDefault();
                if (overTaskId !== task.id) setOverTaskId(task.id);
              }
            : undefined
        }
        onDrop={
          draggable
            ? (e) => {
                e.preventDefault();
                const drag = readTaskDrag(e);
                if (drag) dropBefore(drag.taskId, task.id);
                setOverTaskId(null);
              }
            : undefined
        }
      >
        {draggable && (
          <span className="drag-handle" title="Drag to reorder, or onto a day box above">
            ⋮⋮
          </span>
        )}
        <input
          type="checkbox"
          checked={task.done}
          onChange={() => dispatch({ type: "toggleTask", projectId: project.id, taskId: task.id })}
          aria-label="Complete"
        />
        <div className="plan-item__main">
          <span className="plan-item__title">
            {task.heavy && <span title="Heavy">🔥 </span>}
            {task.title}
          </span>
          <span className="plan-item__sub">
            <button className="link-chip" style={{ ["--accent" as string]: project.color }} onClick={() => onOpenProject(project.id)}>
              {project.name}
            </button>
            <span className={`pill pill-${task.urgency}`}>{task.urgency}</span>
            {task.estimateMinutes ? <span className="pill pill-time">⏱ {formatDuration(task.estimateMinutes)}</span> : null}
            <span className="pill pill-points">+{taskPoints(task)} pts</span>
            {task.link && (
              <a
                className="pill pill-link"
                href={task.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                ✉ open
              </a>
            )}
            {task.due && (
              <span className={`muted ${overdue ? "overdue" : ""}`}>
                {overdue ? "overdue · " : "due "}
                {task.due}
              </span>
            )}
          </span>
          {task.firstStep && <span className="first-step muted">▶ first move: {task.firstStep}</span>}
        </div>
        <div className="plan-item__actions">
          <button
            className={`icon-btn ${isChosenFrog ? "is-on" : ""}`}
            title={isChosenFrog ? "Your frog — tap to unfrog" : "Make this the frog"}
            onClick={() => dispatch({ type: "chooseFrog", taskId: task.id })}
          >
            🐸
          </button>
          <button
            className={`icon-btn ${task.heavy ? "is-on" : ""}`}
            title={heavyLocked ? "Heavy — locked for today" : task.heavy ? "Heavy (bonus points)" : "Mark heavy"}
            disabled={heavyLocked}
            onClick={() => dispatch({ type: "setHeavy", projectId: project.id, taskId: task.id, heavy: !task.heavy })}
          >
            🔥
          </button>
          <button className="icon-btn" title="Edit / postpone" onClick={() => setEdit(item)}>
            ✏️
          </button>
          <button
            className="btn btn-sm btn-ghost"
            title="Not today — snooze to tomorrow (keeps the real due date)"
            onClick={() => dispatch({ type: "snoozeTask", projectId: project.id, taskId: task.id, until: tomorrow })}
          >
            Not today
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setStuck(item)}>
            Stuck
          </button>
          <button className="btn btn-sm" onClick={() => setTimer({ title: task.title })}>
            Start
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="today">
      {/* Day commitment bar */}
      <div className={`card day-bar ${started ? "is-locked" : ""}`}>
        {started ? (
          <>
            <div>
              <strong>🔒 Heavy picks locked.</strong>{" "}
              <span className="muted">The hard stuff stays flagged — no pretending it's easy. (You can still re-point the 🐸 frog or defer dates.)</span>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => dispatch({ type: "resetDay" })}>
              Re-plan day
            </button>
          </>
        ) : (
          <>
            <div>
              <strong>Set up your day.</strong>{" "}
              <span className="muted">Flag what's truly heavy (🔥), pick your frog (🐸), adjust dates/priority — then lock in the heavy list.</span>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => dispatch({ type: "startDay" })}>
              Start my day 🔒
            </button>
          </>
        )}
      </div>

      {/* Week strip: the next 7 days as boxes of time */}
      <WeekStrip />

      {/* Frog */}
      {frog && (
        <div className="card frog-card">
          <div className="card__header">
            <h2>🐸 {frogIsChosen ? "Today's frog" : "Frog (suggested)"}</h2>
            <span className="muted">{frogIsChosen ? "do this first · tap 🐸 to change or unfrog" : "tap 🐸 on any task to pick your own"}</span>
          </div>
          <ul className="plan-list">{row(frog, true)}</ul>
        </div>
      )}

      {/* The day */}
      <div className="card">
        <div className="card__header">
          <h2>Today</h2>
          <span className="muted">{todayStr}</span>
        </div>

        <div className="capacity-row">
          <span className="muted">Time I have today:</span>
          {[2, 4, 6, 8].map((h) => (
            <button
              key={h}
              className={`btn btn-sm ${cap === h * 60 ? "btn-primary" : "btn-ghost"}`}
              onClick={() => dispatch({ type: "setDayCapacity", minutes: h * 60 })}
            >
              {h}h
            </button>
          ))}
          <input
            className="cap-hours"
            type="number"
            min={0}
            step={0.5}
            value={cap != null ? +(cap / 60).toFixed(1) : ""}
            placeholder="hrs"
            onChange={(e) => dispatch({ type: "setDayCapacity", minutes: Math.round(Number(e.target.value) * 60) })}
          />
        </div>

        {cap != null && cap > 0 && (
          <>
            <div className="credit-bar">
              <div
                className="credit-bar__fill"
                style={{
                  width: `${Math.min(100, Math.round((planned / cap) * 100))}%`,
                  ...(overMin > 0 ? { background: "linear-gradient(90deg,#ef4444,#f59e0b)" } : {}),
                }}
              />
            </div>
            <div className="credit-row">
              <span className="muted">
                Planned <strong>{formatDuration(planned) || "0m"}</strong> of {formatDuration(cap)}
              </span>
              {overMin > 0 ? (
                <>
                  <span className="overdue">{formatDuration(overMin)} over</span>
                  <button className="btn btn-sm btn-primary" onClick={autoFit}>
                    Trim to fit → snooze overflow
                  </button>
                </>
              ) : (
                <span className="credits-have">fits ✓</span>
              )}
            </div>
          </>
        )}

        <p className="muted card__subtitle">
          What's pressing{cap == null && totalMinutes > 0 ? <> · about <strong>{formatDuration(totalMinutes)}</strong> of work</> : null}.
        </p>
        {plan.length === 0 ? (
          <p className="muted empty-hint">Nothing left for today. 🌤️</p>
        ) : (
          <ul className="plan-list">{plan.map((i) => row(i))}</ul>
        )}

        {snoozed.length > 0 && (
          <div className="snoozed">
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSnoozed((v) => !v)}>
              💤 {snoozed.length} snoozed to tomorrow {showSnoozed ? "▲" : "▼"}
            </button>
            {showSnoozed && (
              <ul className="plan-list" style={{ marginTop: 8 }}>
                {snoozed.map(({ task, project }) => (
                  <li key={task.id} className="plan-item">
                    <div className="plan-item__main">
                      <span className="plan-item__title muted">{task.title}</span>
                    </div>
                    <div className="plan-item__actions">
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => dispatch({ type: "unsnoozeTask", projectId: project.id, taskId: task.id })}
                      >
                        Bring back
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Build Credits */}
      <div className="card credit-card">
        <div className="card__header">
          <h2>Build Bank</h2>
          <span className="muted">Lvl {level(game.points)} · {game.points} pts</span>
        </div>
        <p className="muted card__subtitle">
          Do the work, earn the right to keep building viz-org. {POINTS_PER_CREDIT} points = 1 build session.
        </p>
        <div className="credit-bar">
          <div className="credit-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="credit-row">
          <span className="muted">{pointsToNextCredit(game)} pts to next credit</span>
          <span className="credits-have">{credits} build credit{credits === 1 ? "" : "s"} ready</span>
          <button className="btn btn-sm btn-primary" disabled={credits < 1} onClick={() => dispatch({ type: "redeemCredit" })}>
            Redeem a build session
          </button>
        </div>
        {credits >= 1 && <p className="redeem-note">🛠️ You've earned it — bring a build session to our next chat.</p>}
      </div>

      {/* Badges */}
      <div className="card">
        <div className="card__header">
          <h2>Badges</h2>
          <span className="muted">{game.badges.length}/{BADGES.length}</span>
        </div>
        <div className="badge-grid">
          {BADGES.map((b) => {
            const earned = game.badges.includes(b.id);
            if (b.secret && !earned) {
              return (
                <div key={b.id} className="badge locked secret" title="Hidden — keep going to find it">
                  <span className="badge__emoji">❓</span>
                  <span className="badge__label">Secret</span>
                </div>
              );
            }
            return (
              <div key={b.id} className={`badge ${earned ? "earned" : "locked"}`} title={b.hint}>
                <span className="badge__emoji">{b.emoji}</span>
                <span className="badge__label">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {timer && <FocusTimer title={timer.title} onClose={() => setTimer(null)} />}
      {stuck && (
        <UnstickPanel
          projectId={stuck.project.id}
          task={stuck.task}
          onClose={() => setStuck(null)}
          onStartTimer={() => {
            setTimer({ title: stuck.task.title });
            setStuck(null);
          }}
        />
      )}
      {edit && <TaskEditDialog projectId={edit.project.id} task={edit.task} onClose={() => setEdit(null)} />}
    </div>
  );
}
