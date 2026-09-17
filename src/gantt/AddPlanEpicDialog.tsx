import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  editingTitle?: string | null;
  onClose: () => void;
  onSave: (title: string) => void;
}

export function AddPlanEpicDialog({ open, editingTitle, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(editingTitle || "");
  }, [open, editingTitle]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = !!title.trim();
  const isEdit = !!editingTitle;

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal"
        role="dialog"
        aria-labelledby="add-plan-epic-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-plan-epic-title">{isEdit ? "Edit epic" : "Add epic"}</h2>
        <p className="pg-modal-sub">
          {isEdit
            ? "Rename this planned epic. Changes autosave to the draft ticket."
            : "Add a planned epic. It will be created in Jira when you publish."}
        </p>
        <label className="pg-modal-field">
          Epic title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. [M1] Platform rollout"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                onSave(title.trim());
                onClose();
              }
            }}
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
              onSave(title.trim());
              onClose();
            }}
          >
            {isEdit ? "Save" : "Add epic"}
          </button>
        </div>
      </div>
    </div>
  );
}
