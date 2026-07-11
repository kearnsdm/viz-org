import { useEffect, useRef, useState } from "react";
import { findTaskItem, formatDuration, taskMinutes, useStore } from "../store";
import { useStreams } from "../streams";
import { headerText } from "./BoardV3";
import { extractActionables, linkLabel } from "./TaskSheet";
import {
  DOUBLER_PAY,
  FROG_BONUS_PAY,
  SPRINT_PAY,
  closePaid,
  closePayFor,
  nextStepPay,
  oldestFrogId,
  sprintedToday,
  taskWorth,
  useReinforcement,
} from "../reinforcement";

// The v3 "Just start" sprint, on the ratified reinforcement engine. You don't
// have to finish the task — just work until the timer ends. Stopping early
// pays nothing; a finished sprint pays +8, the first of the day doubles, and
// a sprint on the oldest 🔥 pays +8 more (stacks). Whether THIS sprint is the
// oldest-frog sprint is decided at start time and can't change mid-sprint.
//
// The task rides along: title, due, notes, source link, and the live
// checklist stay on screen with the timer; steps checked mid-sprint pay on
// the spot.
//
// CHAIN MODE (installment 6): pass `queue` (ordered task ids) and the modal
// becomes a conveyor — one task card at a time, "✓ Done → next" completes the
// current task (normal pay, Undo offered) and advances, "Skip" advances
// without completing. The sprint timer is independent of the chain: sprints
// pay on completion as always, and the chain keeps going across sprints.
// Nothing is persisted — closing the modal ends the chain, tasks unaffected.

const DURATIONS = [10, 15, 25];

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function FocusV3({
  title,
  taskId,
  preset,
  queue,
  onClose,
  notify,
}: {
  title?: string;
  taskId?: string;
  preset?: number;
  /** Ordered task ids to chain through; overrides taskId when present. */
  queue?: string[];
  onClose: () => void;
  notify: (msg: string, undo?: () => void) => void;
}) {
  const { state, dispatch } = useStore();
  const { streams, dispatch: dispatchStreams } = useStreams();
  const { rs, dispatchR } = useReinforcement();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [qi, setQi] = useState(0);
  const [chainDone, setChainDone] = useState(0);
  const [chainSkipped, setChainSkipped] = useState(0);
  const tick = useRef<number | null>(null);
  // Captured at each sprint START (ratified: fixed for that sprint).
  const frogAtStart = useRef(false);
  const firstAtStart = useRef(false);

  const chain = queue && queue.length > 0 ? queue : null;
  const chainOver = !!chain && qi >= chain.length;
  const curId = chain ? (chainOver ? undefined : chain[qi]) : taskId;

  // What a sprint started RIGHT NOW would pay — shown in the picker.
  const liveFrog = !!curId && oldestFrogId(state) === curId;
  const liveFirst = !sprintedToday(rs);
  const previewPay = SPRINT_PAY + (liveFirst ? DOUBLER_PAY : 0) + (liveFrog ? FROG_BONUS_PAY : 0);

  // The task on screen — live from the store, so checks update in place.
  const item = curId ? findTaskItem(state, curId) : null;
  const stream = curId ? streams.find((s) => s.taskId === curId) : undefined;
  const comps = stream ? stream.items.filter((i) => i.state !== "dropped") : [];
  const compsDone = comps.filter((i) => i.state === "done").length;
  const actionables = extractActionables(item?.task.notes);

  const toggleStep = (itemId: string, text: string, isDone: boolean) => {
    if (!stream || !item) return;
    const { task, project } = item;
    if (isDone) {
      dispatchStreams({ type: "uncheck", streamId: stream.streamId, itemId });
      dispatch({ type: "componentUnchecked", projectId: project.id, taskId: task.id, label: text });
      dispatchR({ type: "unstep", task, itemId });
      return;
    }
    const pay = nextStepPay(task, stream, rs.events);
    dispatchStreams({ type: "check", streamId: stream.streamId, itemId });
    dispatch({ type: "componentChecked", projectId: project.id, taskId: task.id, label: text });
    dispatchR({ type: "step", task, stream, itemId });
    notify(pay > 0 ? `+${pay} ⚡ · ${compsDone + 1} of ${comps.length} steps` : `✓ step · ${compsDone + 1} of ${comps.length}`);
  };

  // --- chain controls ---------------------------------------------------------
  const advance = () => setQi((i) => i + 1);

  const skipCurrent = () => {
    setChainSkipped((n) => n + 1);
    advance();
  };

  const completeCurrent = () => {
    if (!item) {
      // Task vanished (deleted / synced away) — treat as a skip.
      skipCurrent();
      return;
    }
    const { task, project } = item;
    if (task.done) {
      // Already closed (e.g. by checking its last step) — just move on.
      setChainDone((n) => n + 1);
      advance();
      return;
    }
    const pay = closePaid(rs.events, task.id) ? 0 : closePayFor(task, stream, rs.events);
    dispatch({ type: "toggleTask", projectId: project.id, taskId: task.id });
    dispatchR({ type: "close", task, stream });
    notify(`✓ ${task.title}${pay > 0 ? ` · +${pay} ⚡` : ""}`, () => {
      dispatch({ type: "undoComplete", projectId: project.id, taskId: task.id });
      dispatchR({ type: "unclose", task });
      setChainDone((n) => Math.max(0, n - 1));
    });
    setChainDone((n) => n + 1);
    advance();
  };

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          window.clearInterval(tick.current!);
          setRunning(false);
          const pay =
            SPRINT_PAY + (firstAtStart.current ? DOUBLER_PAY : 0) + (frogAtStart.current ? FROG_BONUS_PAY : 0);
          setDone(pay);
          // The new engine is the point of record; the legacy dispatch keeps
          // the v2 interface coherent and costs nothing in v3 (not displayed).
          dispatchR({ type: "sprint", taskId: curId, oldestFrog: frogAtStart.current });
          dispatch({ type: "focusComplete" });
          const parts = [`+${pay} ⚡ sprint finished`];
          if (firstAtStart.current) parts.push("first of the day pays double");
          if (frogAtStart.current) parts.push("oldest frog +8");
          notify(parts.join(" — "));
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
    // Captured per sprint: the doubler state and whether the CURRENT task is
    // the oldest frog. "Another sprint" in the same modal must not display a
    // first-of-day double it won't be paid.
    firstAtStart.current = !sprintedToday(rs);
    frogAtStart.current = !!curId && oldestFrogId(state) === curId;
    setMinutes(m);
    setLeft(m * 60);
    setRunning(true);
    setDone(null);
  };

  // A preset (e.g. Quick hits' 10-minute row) starts immediately.
  useEffect(() => {
    if (preset && minutes === null) start(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Everything needed to remember what this sprint is FOR, kept on screen.
  const taskCard = item && (
    <div className="focustask">
      <div
        className="fth"
        style={{ ["--c" as string]: item.project.color, ["--ct" as string]: headerText(item.project.color) }}
      >
        {item.project.name}
        <span className="fthm">
          {formatDuration(taskMinutes(item.task))} · worth up to +{taskWorth(item.task)} ⚡
        </span>
      </div>
      <div className="ftt">
        {item.task.heavy ? "🔥 " : ""}
        {item.task.title}
      </div>
      <div className="ftm">
        {item.task.due ? `due ${item.task.due}` : "no due date"}
        {item.task.urgency === "urgent" ? " · urgent" : item.task.urgency === "high" ? " · high" : ""}
        {item.task.from ? ` · from ${item.task.from}` : ""}
      </div>
      {(item.task.link || actionables.length > 0) && (
        <div className="ftlinks">
          {item.task.link && (
            <a className="btn srcbtn" href={item.task.link} target="_blank" rel="noreferrer">
              ↗ {linkLabel(item.task.link)}
            </a>
          )}
          {actionables.map((l) => (
            <a key={l.href} className="btn srcbtn" href={l.href} target="_blank" rel="noreferrer">
              ↗ {l.label}
            </a>
          ))}
        </div>
      )}
      {comps.length > 0 && (
        <div className="ftsteps">
          {comps.map((c) => (
            <div key={c.id} className={`row3 ${c.state === "done" ? "dn" : ""}`}>
              <input
                type="checkbox"
                checked={c.state === "done"}
                onChange={() => toggleStep(c.id, c.text, c.state === "done")}
              />
              <label onClick={() => toggleStep(c.id, c.text, c.state === "done")}>{c.text}</label>
            </div>
          ))}
        </div>
      )}
      {item.task.notes && <div className="ftnotes">{item.task.notes}</div>}
    </div>
  );

  // Chain chrome: position line above the card, controls below it.
  const chainHead = chain && !chainOver && (
    <div className="chainbar">
      <span>
        ⛓ Chain · task {qi + 1} of {chain.length}
      </span>
      <span className="chainstat">
        {chainDone} done{chainSkipped ? ` · ${chainSkipped} skipped` : ""}
      </span>
    </div>
  );
  const chainControls = chain && !chainOver && (
    <div className="chainrow">
      <button className="btn pri" onClick={completeCurrent}>
        {item?.task.done ? "Next →" : "✓ Done → next"}
      </button>
      <button className="btn" onClick={skipCurrent}>
        Skip →
      </button>
      <button className="btn" onClick={onClose}>
        End chain
      </button>
    </div>
  );
  const chainSummary = chain && chainOver && (
    <div className="chainsum">
      <div className="fclock">⛓✅</div>
      <p>
        Chain finished — <b>{chainDone} completed</b>
        {chainSkipped ? ` · ${chainSkipped} skipped` : ""}. Every completion paid on the spot.
      </p>
      <div style={{ textAlign: "center" }}>
        <button className="btn pri" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="modal3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dlg" style={{ width: item || chain ? "min(560px, 94vw)" : "min(380px, 92vw)" }}>
        {chainSummary}
        {!chainOver && (minutes === null ? (
          <>
            <h3 style={{ margin: "0 0 6px", color: "var(--hi)" }}>{chain ? "Chain" : "Just start"}</h3>
            {!item && title && <p style={{ fontSize: 12.5, color: "var(--mid)", margin: "0 0 8px" }}>{title}</p>}
            {chainHead}
            {taskCard}
            {chainControls}
            <p style={{ fontSize: 12.5, color: "var(--lo)", margin: "8px 0 12px" }}>
              {chain
                ? `Work the card, ✓ it, the next appears. Add a timer if it helps — a finished sprint pays +${previewPay} ⚡ on top.`
                : `Pick a sprint. You don't have to finish the task — just work until the timer ends. Stopping early pays
              nothing; finishing pays +${previewPay} ⚡`}
              {!chain && liveFirst ? " (first of the day pays double)" : ""}
              {!chain && liveFrog ? " — and it's the oldest frog 🔥" : ""}
            </p>
            {DURATIONS.map((m) => (
              <button key={m} className="btn pri" style={{ marginRight: 8 }} onClick={() => start(m)}>
                {m} min
              </button>
            ))}
            {!chain && (
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            )}
          </>
        ) : done !== null ? (
          <>
            <div className="fclock">✅</div>
            <p style={{ textAlign: "center", fontSize: 13 }}>
              That's a real start. <b>+{done} ⚡</b> for showing up
              {firstAtStart.current ? " — first of the day pays double" : ""}.
            </p>
            {chainHead}
            {taskCard}
            {chainControls}
            <div style={{ textAlign: "center", marginTop: 8 }}>
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
            {chainHead}
            {taskCard}
            {chainControls}
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button className="btn" onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : "Resume"}
              </button>{" "}
              <button className="btn" onClick={onClose}>
                Stop (no points)
              </button>
            </div>
          </>
        ))}
      </div>
    </div>
  );
}
