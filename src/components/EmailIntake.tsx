import { useEffect, useRef, useState } from "react";
import { formatDuration, useStore } from "../store";
import { useSync } from "../sync";

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
  const { config, checkInbox } = useSync();
  const [showCapture, setShowCapture] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const bmRef = useRef<HTMLAnchorElement | null>(null);

  // Set the javascript: href imperatively — React warns on javascript: URLs.
  useEffect(() => {
    if (showCapture) bmRef.current?.setAttribute("href", bookmarkletCode());
  }, [showCapture]);

  const adminId = state.projects.find((p) => p.isAdmin)?.id;

  const check = async () => {
    setChecking(true);
    setCheckMsg(null);
    try {
      const n = await checkInbox();
      setCheckMsg(n > 0 ? `${n} new task${n === 1 ? "" : "s"} ✓` : "Nothing new");
    } catch {
      setCheckMsg("Couldn't reach sync — try again");
    } finally {
      setChecking(false);
      setTimeout(() => setCheckMsg(null), 4000);
    }
  };

  return (
    <div className="card email-intake">
      <div className="card__header">
        <h2>Email Intake</h2>
        <div className="header-buttons">
          <button className="btn btn-sm btn-ghost" onClick={() => setShowCapture((v) => !v)}>
            ✉ Bookmarklet
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={check}
            disabled={checking || !config}
            title={config ? "Pull anything a Claude email scan has dropped off" : "Connect Backup / Sync first"}
          >
            {checking ? "Checking…" : "Check for new tasks"}
          </button>
        </div>
      </div>
      <p className="muted card__subtitle">
        Tasks from your real inbox land here — automatically after a Claude email scan, or one at a time with
        the bookmarklet. {checkMsg && <strong>{checkMsg}</strong>}
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
      {state.inbox.length === 0 ? (
        <p className="muted empty-hint">
          Inbox clear. Ask Claude to <em>scan my email</em>, then hit <em>Check for new tasks</em> — or capture
          an open email with the bookmarklet.
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
                  {c.link && (
                    <a className="pill pill-link" href={c.link} target="_blank" rel="noopener noreferrer">
                      ✉ open
                    </a>
                  )}
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
