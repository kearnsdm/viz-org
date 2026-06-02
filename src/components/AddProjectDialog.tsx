import { useState } from "react";
import { freeSlots, useStore } from "../store";

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(4);
  const free = freeSlots(state);

  const submit = () => {
    if (!name.trim()) return;
    dispatch({ type: "addProject", name, capacity });
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New project</h2>
        <p className="muted">
          Claim some of your board. You have <strong>{free}</strong> unallocated slot(s) — but you can
          always grow the board later.
        </p>
        <label className="field">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Annual Planning"
          />
        </label>
        <label className="field">
          Allocated space (slots)
          <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </label>
        <div className="dialog__actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
