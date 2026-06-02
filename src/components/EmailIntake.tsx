import { useState } from "react";
import { decodeCandidates, fetchEmailCandidates, useStore } from "../store";

export function EmailIntake() {
  const { state, dispatch } = useStore();
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [code, setCode] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const adminId = state.projects.find((p) => p.isAdmin)?.id;

  const pull = () => {
    setLoading(true);
    // Simulate a short round-trip to the mailbox.
    setTimeout(() => {
      dispatch({ type: "pullEmail", candidates: fetchEmailCandidates() });
      setLoading(false);
    }, 450);
  };

  const runImport = () => {
    setImportError(null);
    try {
      const candidates = decodeCandidates(code);
      if (candidates.length === 0) {
        setImportError("No tasks found in that code.");
        return;
      }
      dispatch({ type: "pullEmail", candidates });
      setCode("");
      setShowImport(false);
    } catch {
      setImportError("That code couldn't be read. Paste the whole thing and try again.");
    }
  };

  return (
    <div className="card email-intake">
      <div className="card__header">
        <h2>Email Intake</h2>
        <div className="header-buttons">
          <button className="btn btn-sm btn-ghost" onClick={() => setShowImport((v) => !v)}>
            Import
          </button>
          <button className="btn btn-sm" onClick={pull} disabled={loading}>
            {loading ? "Scanning…" : "Pull from email"}
          </button>
        </div>
      </div>
      <p className="muted card__subtitle">
        Candidate tasks distilled from your inbox. File each into a project or admin.
      </p>
      {showImport && (
        <div className="import-box">
          <p className="muted">Paste an import code (e.g. real tasks pulled from your mailbox):</p>
          <textarea
            className="import-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste code here…"
            rows={3}
          />
          {importError && <p className="import-error">{importError}</p>}
          <div className="import-actions">
            <button className="btn btn-sm btn-ghost" onClick={() => setShowImport(false)}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={runImport} disabled={!code.trim()}>
              Load tasks
            </button>
          </div>
        </div>
      )}
      {state.inbox.length === 0 ? (
        <p className="muted empty-hint">
          Inbox clear. Hit <em>Pull from email</em> to scan for action items.
        </p>
      ) : (
        <ul className="candidate-list">
          {state.inbox.map((c) => (
            <li key={c.id} className="candidate">
              <div className="candidate__main">
                <span className="candidate__title">{c.title}</span>
                <span className="candidate__from muted">{c.from}</span>
                <span className="candidate__tags">
                  <span className={`pill pill-${c.urgency}`}>{c.urgency}</span>
                  {c.due && <span className="muted">due {c.due}</span>}
                </span>
              </div>
              <div className="candidate__actions">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) dispatch({ type: "fileCandidate", candidateId: c.id, projectId: e.target.value });
                  }}
                >
                  <option value="" disabled>
                    file into…
                  </option>
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isAdmin ? " (admin)" : ""}
                    </option>
                  ))}
                </select>
                {adminId && (
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Drop into Admin"
                    onClick={() => dispatch({ type: "fileCandidate", candidateId: c.id, projectId: adminId })}
                  >
                    → Admin
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="Dismiss"
                  onClick={() => dispatch({ type: "dismissCandidate", candidateId: c.id })}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
