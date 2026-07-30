import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  defaultDate: string;
  onClose: () => void;
  onAdd: (input: { title: string; start: string }) => void;
}

export function AddMilestoneDialog({
  open,
  defaultDate,
  onClose,
  onAdd,
}: Props) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultDate);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setStart(defaultDate);
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = !!title.trim() && !!start;

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal"
        role="dialog"
        aria-labelledby="add-ms-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-ms-title">Add milestone</h2>
        <p className="pg-modal-sub">
          Adds a top-level red star on the timeline (separate from epics). Saved
          locally only — never synced to Jira.
        </p>
        <label className="pg-modal-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. M3 complete / Go-live"
            autoFocus
          />
        </label>
        <label className="pg-modal-field">
          Date
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onAdd({ title: title.trim(), start });
              onClose();
            }}
          >
            Add milestone
          </button>
        </div>
      </div>
    </div>
  );
}
