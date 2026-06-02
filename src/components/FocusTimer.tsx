import { useEffect, useRef, useState } from "react";
import { FOCUS_POINTS } from "../game";
import { useStore } from "../store";

const DURATIONS = [10, 15, 25];

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function FocusTimer({ title, onClose }: { title?: string; onClose: () => void }) {
  const { dispatch } = useStore();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const tick = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          window.clearInterval(tick.current!);
          setRunning(false);
          setDone(true);
          dispatch({ type: "focusComplete" });
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [running, dispatch]);

  const start = (m: number) => {
    setMinutes(m);
    setLeft(m * 60);
    setRunning(true);
    setDone(false);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog focus-timer" onClick={(e) => e.stopPropagation()}>
        <h2>Just start</h2>
        {title && <p className="muted">{title}</p>}

        {minutes === null ? (
          <>
            <p className="muted">Pick a sprint. You don't have to finish the task — just work until the timer ends.</p>
            <div className="dialog__actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              {DURATIONS.map((m) => (
                <button key={m} className="btn btn-primary" onClick={() => start(m)}>
                  {m} min
                </button>
              ))}
            </div>
          </>
        ) : done ? (
          <>
            <div className="focus-clock">✅</div>
            <p>
              Nice — that's a real start. <strong>+{FOCUS_POINTS} pts</strong> for showing up.
            </p>
            <div className="dialog__actions">
              <button className="btn btn-ghost" onClick={() => setMinutes(null)}>
                Another sprint
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="focus-clock">{fmt(left)}</div>
            <div className="dialog__actions">
              <button className="btn btn-ghost" onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : "Resume"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Stop (no points)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
