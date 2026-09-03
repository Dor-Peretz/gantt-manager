import { useEffect, useMemo, useState } from "react";
import type { QaItem, QaKind } from "../lib/types";
import { qaKindLabel } from "../lib/qaItems";

export interface BoardTaskOption {
  id: string;
  title: string;
  epicTitle: string;
}

interface Props {
  open: boolean;
  kind: QaKind;
  defaultDate: string;
  tasks: BoardTaskOption[];
  editing?: QaItem | null;
  onClose: () => void;
  onSave: (input: {
    id?: string;
    kind: QaKind;
    title: string;
    start: string;
    durationDays: number;
    linkedIssueKeys: string[];
  }) => void;
}

export function AddQaItemDialog({
  open,
  kind,
  defaultDate,
  tasks,
  editing = null,
  onClose,
  onSave,
}: Props) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaultDate);
  const [durationDays, setDurationDays] = useState(1);
  const [linked, setLinked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || "");
    setStart(editing?.start || defaultDate);
    setDurationDays(editing?.durationDays || 1);
    setLinked(editing?.linkedIssueKeys || []);
    setFilter("");
  }, [open, editing, defaultDate]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredTasks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.epicTitle.toLowerCase().includes(q),
    );
  }, [tasks, filter]);

  if (!open) return null;

  const canSubmit = !!title.trim() && !!start && linked.length > 0 && durationDays >= 1;
  const kindLabel = qaKindLabel(kind);

  function toggleLinked(id: string) {
    setLinked((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
  }

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal pg-modal-wide"
        role="dialog"
        aria-labelledby="add-qa-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-qa-title">{editing ? `Edit ${kindLabel}` : `Add ${kindLabel}`}</h2>
        <p className="pg-modal-sub">
          Saved on linked Jira issues for everyone on the next Pull. The row only
          appears when at least one linked task is in the current JQL.
        </p>
        <label className="pg-modal-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "e2e" ? "e.g. Checkout happy path" : "e.g. Payment API contract tests"
            }
            autoFocus
          />
        </label>
        <div className="pg-modal-row">
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
              onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
        <label className="pg-modal-field">
          Linked Jira tasks (required)
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by key, title, or epic…"
          />
        </label>
        <div className="pg-qa-link-list" role="listbox" aria-multiselectable="true">
          {filteredTasks.length === 0 ? (
            <p className="pg-modal-sub">No tasks on the board match.</p>
          ) : (
            filteredTasks.map((t) => {
              const checked = linked.includes(t.id);
              return (
                <label key={t.id} className={`pg-qa-link-item${checked ? " selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLinked(t.id)}
                  />
                  <span className="pg-qa-link-key">{t.id}</span>
                  <span className="pg-qa-link-title">{t.title}</span>
                  <span className="pg-qa-link-epic">{t.epicTitle}</span>
                </label>
              );
            })
          )}
        </div>
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
              onSave({
                id: editing?.id,
                kind,
                title: title.trim(),
                start,
                durationDays: Math.max(1, durationDays),
                linkedIssueKeys: linked,
              });
              onClose();
            }}
          >
            {editing ? "Save" : `Add ${kindLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
