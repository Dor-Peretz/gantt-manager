import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  defaultName: string;
  jqlPreview: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function SaveJqlDialog({
  open,
  defaultName,
  jqlPreview,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
  }, [open, defaultName]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = !!name.trim();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  }

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal"
        role="dialog"
        aria-labelledby="save-jql-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="save-jql-title">Save JQL</h2>
        <p className="pg-modal-sub">
          Name this query so you can reuse it from the Saved JQL list.
        </p>
        <label className="pg-modal-field">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Platform board"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        {jqlPreview.trim() ? (
          <p className="pg-modal-sub pg-save-jql-preview" title={jqlPreview}>
            {jqlPreview}
          </p>
        ) : null}
        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
