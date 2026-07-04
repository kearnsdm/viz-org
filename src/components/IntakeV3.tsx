import { useState } from "react";
import { useStore } from "../store";
import { useSync } from "../sync";

// v3 Intake (formerly "Email Intake" — it holds jotted items, not just email).
// A triage pen: every candidate gets processed — edit + file into a box, or
// delete. Nothing skips triage, nothing auto-files.

export function IntakeV3() {
  const { state, dispatch } = useStore();
  const { config, checkInbox } = useSync();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const admin = state.projects.find((p) => p.isAdmin) ?? state.projects[0];

  const check = () => {
    if (!config || checking) return;
    setChecking(true);
    setCheckNote(null);
    checkInbox()
      .then((n) => setCheckNote(n > 0 ? `${n} new task${n === 1 ? "" : "s"} arrived.` : "Nothing new in the drop box."))
      .catch(() => setCheckNote("Couldn't reach the drop box — try again."))
      .finally(() => setChecking(false));
  };

  return (
    <div className="view3">
      <div className="cap">
        <b>Intake</b>
        <span>every candidate gets processed: edit + file, or delete — nothing skips triage</span>
        <span className="sp" />
        {config && (
          <button className="btn" onClick={check} disabled={checking}>
            {checking ? "Checking…" : "Check for new tasks"}
          </button>
        )}
      </div>
      {checkNote && <div className="hint">{checkNote}</div>}
      <div style={{ marginTop: 10 }}>
        {state.inbox.length ? (
          state.inbox.map((c) => {
            const suggested =
              (c.suggestedProjectId && state.projects.find((p) => p.id === c.suggestedProjectId)?.id) ?? admin?.id ?? "";
            const pick = picks[c.id] ?? suggested;
            const pressing = c.urgency === "urgent" || c.urgency === "high";
            return (
              <div key={c.id} className="cand">
                <div className="t">{c.title}</div>
                <div className="meta">
                  {pressing && <span className="pill3">{c.urgency.toUpperCase()}</span>}
                  {c.from}
                  {c.due ? ` · due ${c.due}` : ""}
                  {c.estimateMinutes ? ` · ~${c.estimateMinutes}m` : ""}
                </div>
                <select value={pick} onChange={(e) => setPicks((m) => ({ ...m, [c.id]: e.target.value }))}>
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn pri"
                  onClick={() => dispatch({ type: "fileCandidate", candidateId: c.id, projectId: pick })}
                >
                  → File
                </button>{" "}
                <button className="btn" onClick={() => dispatch({ type: "dismissCandidate", candidateId: c.id })}>
                  ✕ Not a task
                </button>
              </div>
            );
          })
        ) : (
          <div className="hint">Intake is clear. Jot "add X to viz-org" in chat and it lands here.</div>
        )}
      </div>
    </div>
  );
}
