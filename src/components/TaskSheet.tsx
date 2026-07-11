import { useState } from "react";
import { isoDate, taskMinutes, useStore } from "../store";
import { useStreams } from "../streams";
import {
  closePaid,
  closePayFor,
  nextStepPay,
  paySplit,
  pointsAreOnlyGate,
  pointsToGo,
  taskWorth,
  useReinforcement,
} from "../reinforcement";
import type { Task, Urgency } from "../types";

// The unified Task Sheet — ONE surface per task, opened from every surface
// (board stripe, week chip, Other row, project list, archive). Leads with a
// large completion checkbox and an inline-editable title; then the imported
// checklist (with light provenance); then details edited in place — no edit
// mode, no Save button. ▶ Sprint lives in the header; Delete at the bottom.

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

/** Human label for a source deep-link, by host. */
export function linkLabel(url: string): string {
  try {
    const h = new URL(url).hostname;
    if (h.includes("mail.google")) return "Open the email (Gmail)";
    if (h.includes("outlook.office") || h.includes("outlook.live")) return "Open the email (Outlook)";
    if (h.includes("docs.google")) return "Open the Google Doc";
    if (h.includes("sheets.google")) return "Open the Google Sheet";
    if (h.includes("drive.google")) return "Open in Google Drive";
    if (h.includes("zoom.us")) return "Open the Zoom link";
    return `Open ${h.replace(/^www\./, "")}`;
  } catch {
    return "Open the source link";
  }
}

/** Pull anything actionable out of the notes: URLs and email addresses become
 * one-tap chips under the notes box, so "the doc link is buried in the notes"
 * stops being a thing. */
export function extractActionables(notes: string | undefined): Array<{ href: string; label: string }> {
  if (!notes) return [];
  const out: Array<{ href: string; label: string }> = [];
  const seen = new Set<string>();
  for (const m of notes.match(/https?:\/\/[^\s)>\]"']+/g) ?? []) {
    const href = m.replace(/[.,;:]+$/, "");
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: linkLabel(href) });
  }
  for (const m of notes.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    const href = `mailto:${m}`;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: `✉ ${m}` });
  }
  return out.slice(0, 6);
}

export function TaskSheet({
  projectId,
  taskId,
  onClose,
  onSprint,
  onMoved,
  notify,
}: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  onSprint: () => void;
  onMoved?: (newProjectId: string) => void;
  notify: (msg: string, undo?: () => void) => void;
}) {
  const { state, dispatch } = useStore();
  const { streams, dispatch: dispatchStreams } = useStreams();
  const { rs, dispatchR } = useReinforcement();
  const [holdDate, setHoldDate] = useState("");

  const project = state.projects.find((p) => p.id === projectId);
  const task = project?.tasks.find((t) => t.id === taskId);
  if (!project || !task) return null;

  const otherProjects = state.projects.filter((p) => p.id !== projectId);
  const moveToProject = (toProjectId: string) => {
    if (!toProjectId || toProjectId === projectId) return;
    dispatch({ type: "moveTask", taskId, fromProjectId: projectId, toProjectId });
    const dest = state.projects.find((p) => p.id === toProjectId);
    notify(`Moved to ${dest?.name ?? "project"}`);
    onMoved?.(toProjectId);
  };

  const stream = streams.find((s) => s.taskId === task.id);
  const comps = stream ? stream.items.filter((i) => i.state !== "dropped") : [];
  const compsDone = comps.filter((i) => i.state === "done").length;

  const patch = (p: Partial<Task>) => dispatch({ type: "updateTask", projectId, taskId, patch: p });

  const complete = () => {
    const closePay = closePaid(rs.events, task.id) ? 0 : closePayFor(task, stream, rs.events);
    dispatch({ type: "toggleTask", projectId, taskId });
    dispatchR({ type: "close", task, stream });
    notify(`✓ ${task.title}${closePay > 0 ? ` · +${closePay} ⚡` : ""}`, () => {
      dispatch({ type: "undoComplete", projectId, taskId });
      dispatchR({ type: "unclose", task });
    });
  };

  const toggleDone = () => {
    if (task.done) {
      dispatch({ type: "undoComplete", projectId, taskId });
      dispatchR({ type: "unclose", task });
    } else complete();
  };

  const toggleComp = (itemId: string, text: string, isDone: boolean) => {
    if (!stream) return;
    if (isDone) {
      dispatchStreams({ type: "uncheck", streamId: stream.streamId, itemId });
      dispatch({ type: "componentUnchecked", projectId, taskId, label: text });
      dispatchR({ type: "unstep", task, itemId });
      return;
    }
    const pay = nextStepPay(task, stream, rs.events);
    dispatchStreams({ type: "check", streamId: stream.streamId, itemId });
    dispatch({ type: "componentChecked", projectId, taskId, label: text });
    dispatchR({ type: "step", task, stream, itemId });
    const remainingOpen = comps.filter((i) => i.state === "open" && i.id !== itemId).length;
    notify(
      pay > 0
        ? `+${pay} ⚡ · ${compsDone + 1} of ${comps.length} steps done`
        : `✓ step · ${compsDone + 1} of ${comps.length} done`,
    );
    // Checking the last open component completes the task itself.
    if (remainingOpen === 0 && !task.done) complete();
  };

  const quickDue = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    patch({ due: isoDate(d) });
  };

  const del = () => {
    if (confirm(`Delete "${task.title}"?`)) {
      dispatch({ type: "deleteTask", projectId, taskId });
      onClose();
    }
  };

  return (
    <div
      className="modal3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dlg">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <input type="checkbox" className="sheet-done" checked={task.done} onChange={toggleDone} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              className="dlg-title"
              defaultValue={task.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== task.title) patch({ title: v });
              }}
            />
            <div className="dlg-meta">
              {project.name} · {taskMinutes(task)}m
              {task.urgency === "urgent" ? " · urgent" : task.urgency === "high" ? " · high" : ""}
              {task.heavy ? " · 🔥" : ""}
              {task.held ? ` · ⏸ held — returns ${task.scheduledFor ?? "?"}` : ""}
              {task.done ? (
                " · ✓ done"
              ) : (
                <>
                  {" · "}
                  {(() => {
                    // Canonical payout line (spec §4): the level-cross variant
                    // only when points are genuinely the last gate.
                    const w = taskWorth(task);
                    const toGo = pointsToGo(rs);
                    if (w >= toGo && toGo > 0 && pointsAreOnlyGate(rs))
                      return `Worth up to +${w} ⚡ — enough to reach ${rs.level.next}`;
                    const sp = paySplit(task, stream);
                    return sp.n > 0 ? `Worth up to +${w} ⚡ · each step pays +${sp.perStep}` : `Worth up to +${w} ⚡`;
                  })()}
                </>
              )}
            </div>
          </div>
          <button
            className="btn pri"
            style={{ flex: "none" }}
            onClick={() => {
              onSprint();
            }}
          >
            ▶ Sprint
          </button>
        </div>

        {/* Provenance — where this task came from, with the way back. */}
        {(task.link || task.from) && (
          <div className="srcrow">
            {task.link && (
              <a className="btn srcbtn" href={task.link} target="_blank" rel="noreferrer">
                ↗ {linkLabel(task.link)}
              </a>
            )}
            {task.from && <span className="srcfrom" title={task.from}>from {task.from}</span>}
          </div>
        )}

        {stream && comps.length > 0 && (
          <>
            <div className="sec">
              Checklist{" "}
              <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--lo)" }}>
                · from Claude ({stream.codename})
              </span>
            </div>
            {comps.map((item) => (
              <div key={item.id} className={`row3 ${item.state === "done" ? "dn" : ""}`}>
                <input
                  type="checkbox"
                  checked={item.state === "done"}
                  onChange={() => toggleComp(item.id, item.text, item.state === "done")}
                />
                <label onClick={() => toggleComp(item.id, item.text, item.state === "done")}>{item.text}</label>
              </div>
            ))}
          </>
        )}

        {!task.done && !stream && (task.estimateMinutes ?? 0) > 60 && (
          <div className="nudge">
            Big task, no steps yet — want to break it down?{" "}
            <span className="nudge-how">Ask Claude in chat to start a stream for it; each step then pays as you go.</span>
          </div>
        )}

        <div className="sec">Details — edit in place, saves as you go</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className="fld" style={{ flex: 1, minWidth: 118 }}>
            Due
            <input type="date" value={task.due ?? ""} onChange={(e) => patch({ due: e.target.value || undefined })} />
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 118 }}>
            Planned day
            <input
              type="date"
              value={task.scheduledFor ?? ""}
              onChange={(e) =>
                dispatch({ type: "scheduleTask", projectId, taskId, date: e.target.value || undefined })
              }
            />
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 96 }}>
            Priority
            <select value={task.urgency} onChange={(e) => patch({ urgency: e.target.value as Urgency })}>
              {URGENCIES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 84 }}>
            Time
            <select
              value={String(task.estimateMinutes ?? 30)}
              onChange={(e) => patch({ estimateMinutes: Number(e.target.value) })}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d >= 60 ? `${d / 60}h` : `${d}m`}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 140 }}>
            Project
            <select value={projectId} onChange={(e) => moveToProject(e.target.value)}>
              <option value={projectId}>{project.name}</option>
              {otherProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qk">
          <button className="btn" onClick={() => quickDue(0)}>
            Due today
          </button>
          <button className="btn" onClick={() => quickDue(1)}>
            Tomorrow
          </button>
          <button className="btn" onClick={() => quickDue(7)}>
            +1 week
          </button>
        </div>
        <label className="fld">
          Notes — clean and simple; Claude's context lands here too
          <textarea
            className="notes3"
            rows={6}
            defaultValue={task.notes ?? ""}
            onBlur={(e) => patch({ notes: e.target.value || undefined })}
          />
        </label>
        {extractActionables(task.notes).length > 0 && (
          <div className="notelinks">
            {extractActionables(task.notes).map((l) => (
              <a key={l.href} className="btn srcbtn" href={l.href} target="_blank" rel="noreferrer">
                ↗ {l.label}
              </a>
            ))}
          </div>
        )}
        <label className="heavy-row">
          <input
            type="checkbox"
            checked={!!task.heavy}
            onChange={(e) => dispatch({ type: "setHeavy", projectId, taskId, heavy: e.target.checked })}
          />{" "}
          🔥 Heavy / aversive — the frog (bonus points)
        </label>
        {!task.done && (
          <div className="hold-row">
            {task.held ? (
              <>
                <span className="hold-status">⏸ Held — off the board until {task.scheduledFor ?? "?"}</span>
                <button
                  className="btn"
                  onClick={() => {
                    dispatch({ type: "releaseTask", projectId, taskId });
                    notify(`↩ ${task.title} is back on the board`);
                  }}
                >
                  ↩ Return to board now
                </button>
              </>
            ) : (
              (() => {
                // A hold needs a FUTURE return date — holding "until" today or a
                // past date would resurface immediately. Prefill only a planned
                // day that's already in the future; otherwise require a pick.
                const tomorrow = (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  return isoDate(d);
                })();
                const futurePlanned = task.scheduledFor && task.scheduledFor >= tomorrow ? task.scheduledFor : "";
                const until = holdDate || futurePlanned;
                return (
                  <>
                    <span className="hold-status">⏸ Hold — park it off the board until</span>
                    <input
                      type="date"
                      min={tomorrow}
                      value={until}
                      onChange={(e) => setHoldDate(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={!until || until < tomorrow}
                      title="A hold always needs a future return date"
                      onClick={() => {
                        if (!until || until < tomorrow) return;
                        dispatch({ type: "holdTask", projectId, taskId, until });
                        notify(`⏸ Held until ${until}`, () => dispatch({ type: "releaseTask", projectId, taskId }));
                      }}
                    >
                      ⏸ Hold
                    </button>
                  </>
                );
              })()
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button className="btn danger" onClick={del}>
            Delete
          </button>
          {!task.done && (
            <button
              className="btn"
              title="It was finished before it ever hit the board (or it's gone stale) — mark it done with no points, so the record is right and the score stays honest"
              onClick={() => {
                // Straight patch, not toggleTask: no game award, no close
                // event. Backfilled completions must never pay.
                patch({ done: true });
                notify(`✓ ${task.title} — recorded as already done (no points)`, () =>
                  patch({ done: false }),
                );
                onClose();
              }}
            >
              ✓ Already done · no points
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
