import { useMemo, useState } from "react";
import { exportBoard, importBoard, useStore } from "../store";

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const code = useMemo(() => exportBoard(state), [state]);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);

  const taskCount = state.projects.reduce((s, p) => s + p.tasks.length, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the textarea is selectable as a fallback.
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
          `Replace this device's board with the backup? This device currently has ${taskCount} task(s); the backup has ${incoming}. This overwrites what's here.`,
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
        <h2>Backup &amp; transfer</h2>
        <p className="muted">
          Your board is saved only in <em>this</em> browser. To move it to another device, copy the
          code below and paste it into the same screen there.
        </p>

        <label className="field">
          This device's board ({taskCount} task{taskCount === 1 ? "" : "s"})
          <textarea className="import-textarea" readOnly rows={3} value={code} onFocus={(e) => e.target.select()} />
        </label>
        <div className="dialog__actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={copy}>
            {copied ? "Copied ✓" : "Copy code"}
          </button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" }} />

        <label className="field">
          Restore from a code (paste here)
          <textarea
            className="import-textarea"
            rows={3}
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
