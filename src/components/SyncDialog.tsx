import { useMemo, useState } from "react";
import { exportBoard, importBoard, useStore } from "../store";
import { useSync } from "../sync";

function statusText(phase: string, at?: number, message?: string): string {
  switch (phase) {
    case "syncing":
      return "Syncing…";
    case "ok":
      return at ? `Synced ✓ ${new Date(at).toLocaleTimeString()}` : "Synced ✓";
    case "error":
      return `Sync error: ${message ?? "failed"}`;
    default:
      return "Not connected";
  }
}

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { config, status, connect, disconnect, syncNow } = useSync();
  const code = useMemo(() => exportBoard(state), [state]);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const taskCount = state.projects.reduce((s, p) => s + p.tasks.length, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't auto-copy. Tap the code, select all, and copy manually.");
    }
  };

  const restore = () => {
    setError(null);
    try {
      const next = importBoard(paste);
      const incoming = next.projects.reduce((s, p) => s + p.tasks.length, 0);
      if (
        confirm(
          `Replace this device's board with the backup? This device has ${taskCount} task(s); the backup has ${incoming}. This overwrites what's here.`,
        )
      ) {
        dispatch({ type: "replaceState", state: next });
        onClose();
      }
    } catch {
      setError("That code couldn't be read. Make sure you pasted the whole thing.");
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Sync &amp; backup</h2>

        {/* Automatic cross-device sync via GitHub */}
        <p className="muted">
          <strong>Cross-device sync (GitHub).</strong> Connect each device with the same token and they all
          share one board automatically.
        </p>

        {config ? (
          <>
            <div className="sync-status muted">{statusText(status.phase, status.at, status.message)}</div>
            <p className="muted" style={{ fontSize: 12 }}>
              Connected ✓ — board stored in a private gist. Use the same token on your other devices.
            </p>
            <div className="dialog__actions" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={disconnect}>
                Disconnect
              </button>
              <button className="btn btn-primary" onClick={syncNow}>
                Sync now
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              GitHub token (with “gist” access)
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
              />
            </label>
            <div className="sync-status muted">{statusText(status.phase, status.at, status.message)}</div>
            <p className="muted" style={{ fontSize: 12 }}>
              Need one? github.com/settings/tokens → <em>Generate new token (classic)</em> → check only{" "}
              <strong>gist</strong> → generate → paste it here. It's free and stays on this device.
            </p>
            <div className="dialog__actions" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => connect(token.trim())} disabled={!token.trim()}>
                Connect
              </button>
            </div>
          </>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" }} />

        {/* Manual backup / transfer */}
        <p className="muted">
          <strong>Manual backup.</strong> No account needed — copy this code and paste it on another device.
        </p>
        <label className="field">
          This device's board ({taskCount} task{taskCount === 1 ? "" : "s"})
          <textarea className="import-textarea" readOnly rows={2} value={code} onFocus={(e) => e.target.select()} />
        </label>
        <div className="dialog__actions" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={copy}>
            {copied ? "Copied ✓" : "Copy code"}
          </button>
        </div>
        <label className="field">
          Restore from a code
          <textarea
            className="import-textarea"
            rows={2}
            value={paste}
            placeholder="Paste a backup code from another device…"
            onChange={(e) => setPaste(e.target.value)}
          />
        </label>
        {error && <p className="import-error">{error}</p>}
        <div className="dialog__actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={restore} disabled={!paste.trim()}>
            Restore board
          </button>
        </div>
      </div>
    </div>
  );
}
