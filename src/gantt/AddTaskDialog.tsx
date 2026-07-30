import { useEffect, useState } from "react";
import type { Milestone } from "../lib/types";

interface Props {
  open: boolean;
  epics: Milestone[];
  defaultDate: string;
  onClose: () => void;
  onAdd: (input: {
    epicId: string;
    title: string;
    start: string;
    durationDays: number;
  }) => void;
}

export function AddTaskDialog({
  open,
  epics,
  defaultDate,
  onClose,
  onAdd,
}: Props) {
  const [epicId, setEpicId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultDate);
  const [durationDays, setDurationDays] = useState(1);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setStart(defaultDate);
    setDurationDays(1);
    setEpicId(epics[0]?.id || "");
  }, [open, epics, defaultDate]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit =
    !!epicId && !!title.trim() && !!start && durationDays >= 1;

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal"
        role="dialog"
        aria-labelledby="add-task-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-task-title">Add task</h2>
        <p className="pg-modal-sub">
          Creates a draft under the selected epic. Click <strong>Push</strong> to
          create it in Jira and write Start / Due dates.
        </p>
        <label className="pg-modal-field">
          Epic
          <select
            value={epicId}
            onChange={(e) => setEpicId(e.target.value)}
            disabled={!epics.length}
          >
            {!epics.length && <option value="">Pull epics first</option>}
            {epics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} — {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-modal-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Implement offer validation"
            autoFocus
          />
        </label>
        <label className="pg-modal-field">
          Start
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="pg-modal-field">
          Duration (workdays)
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) =>
              setDurationDays(Math.max(1, Number(e.target.value) || 1))
            }
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
              onAdd({
                epicId,
                title: title.trim(),
                start,
                durationDays,
              });
              onClose();
            }}
          >
            Add draft
          </button>
        </div>
      </div>
    </div>
  );
}
