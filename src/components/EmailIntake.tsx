import { useEffect, useRef, useState } from "react";
import { decodeCandidates, formatDuration, useStore } from "../store";

/** The one-click capture bookmarklet, targeting this running copy of the app. */
function bookmarkletCode(): string {
  const app = window.location.origin + window.location.pathname + window.location.search;
  return (
    "javascript:(function(){" +
    "var s=window.getSelection?String(window.getSelection()).trim():'';" +
    "var t=prompt('Task title:',s||document.title.replace(/\\s*[-\\u2013|]\\s*(Outlook|Gmail|Mail\\b).*$/i,''));" +
    "if(!t)return;" +
    `window.open(${JSON.stringify(app)}+'#capture?title='+encodeURIComponent(t)` +
    "+'&link='+encodeURIComponent(location.href)" +
    "+'&from='+encodeURIComponent(document.title),'_blank');" +
    "})()"
  );
}

export function EmailIntake() {
  const { state, dispatch } = useStore();
  const [showImport, setShowImport] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const bmRef = useRef<HTMLAnchorElement | null>(null);

  // Set the javascript: href imperatively — React warns on javascript: URLs.
  useEffect(() => {
    if (showCapture) bmRef.current?.setAttribute("href", bookmarkletCode());
  }, [showCapture]);

  const adminId = state.projects.find((p) => p.isAdmin)?.id;

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
          <button className="btn btn-sm btn-ghost" onClick={() => setShowCapture((v) => !v)}>
            ✉ Capture setup
          </button>
          <button className="btn btn-sm" onClick={() => setShowImport((v) => !v)}>
            Import
          </button>
        </div>
      </div>
      <p className="muted card__subtitle">
        Candidate tasks from your real inbox — via the capture bookmarklet or a pasted import code. File each
        into a project or admin.
      </p>
      {showCapture && (
        <div className="import-box">
          <p className="muted">
            <strong>One-click capture from Outlook (web) or Gmail.</strong> Drag this button to your browser's
            bookmarks bar:
          </p>
          <a ref={bmRef} className="bookmarklet" draggable onClick={(e) => e.preventDefault()}>
            ✉ → viz-org
          </a>
          <p className="muted" style={{ marginTop: 8 }}>
            With an email open, click it — the subject and a link back to the message land here as a candidate
            task. Select text in the email first to use that as the title instead.
          </p>
          <div className="import-actions">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                navigator.clipboard?.writeText(bookmarkletCode()).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? "Copied ✓" : "Copy code instead"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowCapture(false)}>
              Close
            </button>
          </div>
        </div>
      )}
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
          Inbox clear. Capture an open email with the bookmarklet (<em>✉ Capture setup</em>), or paste an
          import code from a Claude email scan.
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
                  {c.estimateMinutes ? (
                    <span className="pill pill-time">⏱ {formatDuration(c.estimateMinutes)}</span>
                  ) : null}
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
