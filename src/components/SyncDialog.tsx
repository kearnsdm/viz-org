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

  const [url, setUrl] = useState(config?.url ?? "");
  const [key, setKey] = useState(config?.key ?? "");

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

  const doConnect = () => {
    const trimmed = url.trim();
    if (!trimmed || !key.trim()) return;
    if (!trimmed.startsWith("https://")) {
      if (!confirm("Your sync URL isn't https:// — most browsers will block it. Connect anyway?")) return;
    }
    connect({ url: trimmed, key: key.trim() });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Sync &amp; backup</h2>

        {/* Automatic sync */}
        <p className="muted">
          <strong>Automatic sync.</strong> Point this at the sync file on your own site and every device
          stays in step on its own.
        </p>
        <label className="field">
          Sync URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com/viz-sync.php"
          />
        </label>
        <label className="field">
          Passphrase
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="the secret you set in the PHP file" />
        </label>
        <div className="sync-status muted">{statusText(status.phase, status.at, status.message)}</div>
        <div className="dialog__actions" style={{ marginTop: 8 }}>
          {config ? (
            <>
              <button className="btn btn-ghost" onClick={disconnect}>
                Disconnect
              </button>
              <button className="btn btn-primary" onClick={syncNow}>
                Sync now
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={doConnect} disabled={!url.trim() || !key.trim()}>
              Connect
            </button>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" }} />

        {/* Manual backup / transfer */}
        <p className="muted">
          <strong>Manual backup.</strong> No server needed — copy this code and paste it on another device.
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
