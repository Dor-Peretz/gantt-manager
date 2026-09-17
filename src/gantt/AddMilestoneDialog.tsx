import { useEffect, useMemo, useState } from "react";
import type { LocalMarker } from "../lib/types";

export interface MilestoneEpicOption {
  id: string;
  title: string;
}

interface Props {
  open: boolean;
  defaultDate: string;
  epics: MilestoneEpicOption[];
  editing?: LocalMarker | null;
  onClose: () => void;
  onDelete?: (milestoneId: string) => void;
  onSave: (input: {
    id?: string;
    title: string;
    start: string;
    linkedEpicKeys: string[];
  }) => void;
}

export function AddMilestoneDialog({
  open,
  defaultDate,
  epics,
  editing = null,
  onClose,
  onDelete,
  onSave,
}: Props) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultDate);
  const [linked, setLinked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || "");
    setStart(editing?.start || defaultDate);
    setLinked(editing?.linkedEpicKeys || []);
    setFilter("");
  }, [open, defaultDate, editing]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredEpics = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return epics;
    return epics.filter(
      (epic) =>
        epic.id.toLowerCase().includes(query) ||
        epic.title.toLowerCase().includes(query),
    );
  }, [epics, filter]);

  if (!open) return null;

  const canSubmit = !!title.trim() && !!start && linked.length > 0;

  function toggleLinked(id: string) {
    setLinked((previous) =>
      previous.includes(id)
        ? previous.filter((key) => key !== id)
        : [...previous, id],
    );
  }

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal pg-modal-wide"
        role="dialog"
        aria-labelledby="add-ms-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-ms-title">{editing ? "Edit milestone" : "Add milestone"}</h2>
        <p className="pg-modal-sub">
          Adds a top-level red star linked to one or more Jira epics. The
          milestone and its links are saved locally only.
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
        <label className="pg-modal-field">
          Linked Jira epics (required)
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by epic key or title…"
          />
        </label>
        <div className="pg-qa-link-list" role="listbox" aria-multiselectable="true">
          {filteredEpics.length === 0 ? (
            <p className="pg-modal-sub">No Jira epics on the board match.</p>
          ) : (
            filteredEpics.map((epic) => {
              const checked = linked.includes(epic.id);
              return (
                <label
                  key={epic.id}
                  className={`pg-qa-link-item pg-ms-epic-link-item${checked ? " selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLinked(epic.id)}
                  />
                  <span className="pg-qa-link-key">{epic.id}</span>
                  <span className="pg-qa-link-title">{epic.title}</span>
                </label>
              );
            })
          )}
        </div>
        <div className="pg-modal-actions">
          {editing && onDelete ? (
            <button
              type="button"
              className="gantt-btn danger pg-modal-delete"
              onClick={() => {
                onDelete(editing.id);
                onClose();
              }}
            >
              Delete milestone
            </button>
          ) : null}
          <button type="button" className="gantt-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onSave({
                id: editing?.id,
                title: title.trim(),
                start,
                linkedEpicKeys: linked,
              });
              onClose();
            }}
          >
            {editing ? "Save milestone" : "Add milestone"}
          </button>
        </div>
      </div>
    </div>
  );
}
