import { useEffect, useState } from "react";
import { useStore } from "../store";
import { taskPoints } from "../game";
import type { Task } from "../types";

const FEELINGS: { id: string; label: string; reframe: string }[] = [
  {
    id: "late",
    label: "Behind / late",
    reframe:
      "Being late feels heavy, but the dread is costing you more than the task will. One reply ends it. Start the clock and let it be imperfect.",
  },
  {
    id: "shame",
    label: "Shame",
    reframe:
      "A missed thing isn't a verdict on you. The fastest way out of the feeling is one small action. Talk to yourself like you would a friend in the same spot.",
  },
  {
    id: "embarrassment",
    label: "Embarrassment",
    reframe:
      "Most people barely remember the delay — they'll remember that you followed through. A short, plain message is more than enough.",
  },
  {
    id: "overwhelm",
    label: "Overwhelm",
    reframe:
      "You don't have to do all of it — just the next 2 minutes. Shrink the first step until it's almost too small to refuse.",
  },
  {
    id: "boring",
    label: "Boredom",
    reframe: "Boring isn't hard. Set 10 minutes, make it a sprint, and you're free when it dings.",
  },
  {
    id: "unsure",
    label: "Don't know how",
    reframe:
      "Not knowing is itself the first task: open it and write one question. Clarity comes from contact, not from staring.",
  },
];

export function UnstickPanel({
  projectId,
  task,
  onClose,
  onStartTimer,
}: {
  projectId: string;
  task: Task;
  onClose: () => void;
  onStartTimer: () => void;
}) {
  const { dispatch } = useStore();
  const [feeling, setFeeling] = useState<string | null>(null);
  const [step, setStep] = useState(task.firstStep ?? "");

  // Reaching for "I'm stuck" means it's a heavy one — flag it for the bonus.
  useEffect(() => {
    if (!task.heavy) dispatch({ type: "setHeavy", projectId, taskId: task.id, heavy: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = FEELINGS.find((f) => f.id === feeling);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog unstick" onClick={(e) => e.stopPropagation()}>
        <h2>Let's get unstuck</h2>
        <p className="muted unstick-task">
          🔥 {task.title} <span className="pill pill-time">+{taskPoints({ ...task, heavy: true })} pts</span>
        </p>

        <div className="unstick-step">
          <div className="unstick-step__n">1 · Name what's heavy</div>
          <div className="feeling-grid">
            {FEELINGS.map((f) => (
              <button
                key={f.id}
                className={`btn btn-sm ${feeling === f.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setFeeling(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {chosen && <p className="reframe">{chosen.reframe}</p>}
        </div>

        <div className="unstick-step">
          <div className="unstick-step__n">2 · Shrink it to one 2-minute move</div>
          <div className="add-task" style={{ marginBottom: 0 }}>
            <input
              placeholder="e.g. open the doc and write one sentence"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              onBlur={() => dispatch({ type: "setFirstStep", projectId, taskId: task.id, firstStep: step })}
            />
          </div>
          {task.firstStep && <p className="muted" style={{ marginTop: 6 }}>First move saved ✓</p>}
        </div>

        <div className="unstick-step">
          <div className="unstick-step__n">3 · Just start — 10 minutes</div>
          <button className="btn btn-primary" onClick={onStartTimer}>
            Start a focus sprint
          </button>
        </div>

        <div className="dialog__actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
