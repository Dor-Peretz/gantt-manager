import { useEffect, useState } from "react";
import type { CustomNonWorkingDay } from "../lib/types";

interface Props {
  open: boolean;
  projectStart: string;
  showHolidays: boolean;
  showDeps: boolean;
  customNonWorkingDays: CustomNonWorkingDay[];
  onClose: () => void;
  onProjectStartChange: (value: string) => void;
  onShowHolidaysChange: (value: boolean) => void;
  onShowDepsChange: (value: boolean) => void;
  onAddOffDay: (date: string, name?: string) => void;
  onRemoveOffDay: (date: string) => void;
}

export function ProjectOptionsPanel({
  open,
  projectStart,
  showHolidays,
  showDeps,
  customNonWorkingDays,
  onClose,
  onProjectStartChange,
  onShowHolidaysChange,
  onShowDepsChange,
  onAddOffDay,
  onRemoveOffDay,
}: Props) {
  const [offDayDate, setOffDayDate] = useState("");
  const [offDayName, setOffDayName] = useState("");

  useEffect(() => {
    if (!open) return;
    setOffDayDate("");
    setOffDayName("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function submitOffDay() {
    const date = offDayDate.trim();
    if (!date) return;
    onAddOffDay(date, offDayName.trim() || undefined);
    setOffDayDate("");
    setOffDayName("");
  }

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal pg-options-modal"
        role="dialog"
        aria-labelledby="project-options-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="project-options-title">Project options</h2>
        <p className="pg-modal-sub">
          Timeline settings — saved to preferences as you change them.
        </p>

        <label className="pg-modal-field">
          Project start
          <input
            type="date"
            value={projectStart}
            onChange={(e) => onProjectStartChange(e.target.value)}
          />
        </label>

        <div className="pg-options-section">
          <label className="pg-modal-check" title="Israeli public holidays (0 hours when on)">
            <input
              type="checkbox"
              checked={showHolidays}
              onChange={(e) => onShowHolidaysChange(e.target.checked)}
            />
            <span>IL holidays</span>
          </label>
          <label
            className="pg-modal-check"
            title="Prerequisite arrows from Jira Blocks links"
          >
            <input
              type="checkbox"
              checked={showDeps}
              onChange={(e) => onShowDepsChange(e.target.checked)}
            />
            <span>Prerequisites</span>
          </label>
        </div>

        <div className="pg-options-section">
          <div className="pg-options-section-title">Off days</div>
          <p className="pg-options-hint">Manual non-working days — always apply.</p>
          <div className="pg-options-off-add">
            <input
              type="date"
              value={offDayDate}
              onChange={(e) => setOffDayDate(e.target.value)}
              aria-label="Off day date"
            />
            <input
              type="text"
              value={offDayName}
              onChange={(e) => setOffDayName(e.target.value)}
              placeholder="Label (optional)"
              maxLength={40}
              aria-label="Off day label"
            />
            <button
              type="button"
              className="gantt-btn"
              disabled={!offDayDate}
              onClick={submitOffDay}
            >
              Add
            </button>
          </div>
          {customNonWorkingDays.length > 0 && (
            <div className="pg-off-day-list pg-off-day-list-modal">
              {customNonWorkingDays.map((d) => (
                <span key={d.date} className="pg-off-day-chip" title={d.name || "Off day"}>
                  <span className="pg-off-day-chip-text">
                    {d.date}
                    {d.name ? ` · ${d.name}` : ""}
                  </span>
                  <button
                    type="button"
                    className="pg-off-day-remove"
                    onClick={() => onRemoveOffDay(d.date)}
                    aria-label={`Remove off day ${d.date}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
