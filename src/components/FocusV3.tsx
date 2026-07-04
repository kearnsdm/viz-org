import { useEffect, useRef, useState } from "react";
import { FIRST_SPRINT_POINTS, FOCUS_POINTS, withGame } from "../game";
import { isoDate, useStore } from "../store";

// The v3 "Just start" sprint. You don't have to finish the task — just work
// until the timer ends. Stopping early pays nothing; finishing the sprint
// pays +8, and the first completed sprint of the day pays double.

const DURATIONS = [10, 15, 25];

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function FocusV3({
  title,
  onClose,
  notify,
}: {
  title?: string;
  onClose: () => void;
  notify: (msg: string) => void;
}) {
  const { state, dispatch } = useStore();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const tick = useRef<number | null>(null);

  const g = withGame(state.game);
  const firstOfDay = g.todayDate === isoDate(new Date()) ? g.focusToday === 0 : true;

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          window.clearInterval(tick.current!);
          setRunning(false);
          const pay = firstOfDay ? FIRST_SPRINT_POINTS : FOCUS_POINTS;
          setDone(pay);
          dispatch({ type: "focusComplete" });
          notify(`+${pay} ⚡ sprint finished${pay === FIRST_SPRINT_POINTS ? " — first of the day pays double" : " — starting counts"}`);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = (m: number) => {
    setMinutes(m);
    setLeft(m * 60);
    setRunning(true);
    setDone(null);
  };

  return (
    <div
      className="modal3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dlg" style={{ width: "min(380px, 92vw)" }}>
        {minutes === null ? (
          <>
            <h3 style={{ margin: "0 0 6px", color: "var(--hi)" }}>Just start</h3>
            {title && <p style={{ fontSize: 12.5, color: "var(--mid)", margin: "0 0 8px" }}>{title}</p>}
            <p style={{ fontSize: 12.5, color: "var(--lo)", margin: "0 0 12px" }}>
              Pick a sprint. You don't have to finish the task — just work until the timer ends. Stopping early pays
              nothing; finishing the sprint pays +{FOCUS_POINTS}.
            </p>
            {DURATIONS.map((m) => (
              <button key={m} className="btn pri" style={{ marginRight: 8 }} onClick={() => start(m)}>
                {m} min
              </button>
            ))}
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : done !== null ? (
          <>
            <div className="fclock">✅</div>
            <p style={{ textAlign: "center", fontSize: 13 }}>
              That's a real start. <b>+{done} pts</b> for showing up
              {done === FIRST_SPRINT_POINTS ? " — first of the day pays double" : ""}.
            </p>
            <div style={{ textAlign: "center" }}>
              <button className="btn" onClick={() => setMinutes(null)}>
                Another sprint
              </button>{" "}
              <button className="btn pri" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fclock">{fmt(left)}</div>
            <div style={{ textAlign: "center" }}>
              <button className="btn" onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : "Resume"}
              </button>{" "}
              <button className="btn" onClick={onClose}>
                Stop (no points)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
