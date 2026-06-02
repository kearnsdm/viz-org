import { useState } from "react";
import { buildDailyPlan, formatDuration, useStore, type PlanItem } from "../store";
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
  const todayStr = new Date().toISOString().slice(0, 10);
  const frog = pickFrog(plan);
  const credits = availableCredits(game);
  const pct = Math.round(((POINTS_PER_CREDIT - pointsToNextCredit(game)) / POINTS_PER_CREDIT) * 100);
  const totalMinutes = plan.reduce((s, { task }) => s + (task.estimateMinutes ?? 0), 0);

  const [timer, setTimer] = useState<{ title: string } | null>(null);
  const [stuck, setStuck] = useState<PlanItem | null>(null);

  const row = (item: PlanItem, isFrog = false) => {
    const { task, project } = item;
    const overdue = task.due && task.due < todayStr;
    return (
      <li key={task.id} className={`plan-item ${isFrog ? "is-frog" : ""}`}>
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
            className={`icon-btn ${task.heavy ? "is-on" : ""}`}
            title={task.heavy ? "Heavy (bonus points)" : "Mark heavy"}
            onClick={() => dispatch({ type: "setHeavy", projectId: project.id, taskId: task.id, heavy: !task.heavy })}
          >
            🔥
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setStuck(item)}>
            I'm stuck
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
      {/* Build Credits — the reward */}
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

      {/* Today's frog */}
      {frog && (
        <div className="card frog-card">
          <div className="card__header">
            <h2>🐸 Today's frog</h2>
            <span className="muted">do the heaviest thing first</span>
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
        <p className="muted card__subtitle">
          What's pressing across every project{totalMinutes > 0 ? <> · about <strong>{formatDuration(totalMinutes)}</strong> of work</> : null}.
        </p>
        {plan.length === 0 ? (
          <p className="muted empty-hint">Nothing pressing. Your board is calm. 🌤️</p>
        ) : (
          <ul className="plan-list">{plan.map((i) => row(i))}</ul>
        )}
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
    </div>
  );
}
