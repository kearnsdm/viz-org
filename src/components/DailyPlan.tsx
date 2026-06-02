import { buildDailyPlan, formatDuration, useStore } from "../store";

export function DailyPlan({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const plan = buildDailyPlan(state);
  const todayStr = new Date().toISOString().slice(0, 10);
  const totalMinutes = plan.reduce((s, { task }) => s + (task.estimateMinutes ?? 0), 0);

  return (
    <div className="card daily-plan">
      <div className="card__header">
        <h2>Daily Plan</h2>
        <span className="muted">{todayStr}</span>
      </div>
      <p className="muted card__subtitle">
        What's pressing today — pulled from every project and the admin box.
        {totalMinutes > 0 && (
          <>
            {" "}
            About <strong>{formatDuration(totalMinutes)}</strong> of work.
          </>
        )}
      </p>
      {plan.length === 0 ? (
        <p className="muted empty-hint">Nothing urgent. Your board is calm. 🌤️</p>
      ) : (
        <ul className="plan-list">
          {plan.map(({ task, project }) => {
            const overdue = task.due && task.due < todayStr;
            return (
              <li key={task.id} className="plan-item">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => dispatch({ type: "toggleTask", projectId: project.id, taskId: task.id })}
                  aria-label="Mark done"
                />
                <div className="plan-item__main">
                  <span className="plan-item__title">{task.title}</span>
                  <span className="plan-item__sub">
                    <button
                      className="link-chip"
                      style={{ ["--accent" as string]: project.color }}
                      onClick={() => onOpenProject(project.id)}
                    >
                      {project.name}
                    </button>
                    <span className={`pill pill-${task.urgency}`}>{task.urgency}</span>
                    {task.estimateMinutes ? (
                      <span className="pill pill-time">⏱ {formatDuration(task.estimateMinutes)}</span>
                    ) : null}
                    {task.due && (
                      <span className={`muted ${overdue ? "overdue" : ""}`}>
                        {overdue ? "overdue · " : "due "}
                        {task.due}
                      </span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
