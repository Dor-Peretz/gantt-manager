import { useEffect, useState } from "react";
import type { CustomNonWorkingDay } from "../lib/types";
import { DEFAULT_WORKING_WEEKDAYS, WEEKDAY_SHORT } from "../lib/workdays";

interface Props {
  open: boolean;
  projectStart: string;
  showHolidays: boolean;
  showPolishHolidays: boolean;
  workingWeekdays: number[];
  showDeps: boolean;
  showSprints: boolean;
  /** Sprints only exist after a Pull — the toggle explains itself when there are none. */
  sprintCount: number;
  customNonWorkingDays: CustomNonWorkingDay[];
  onClose: () => void;
  onProjectStartChange: (value: string) => void;
  onShowHolidaysChange: (value: boolean) => void;
  onShowPolishHolidaysChange: (value: boolean) => void;
  onWorkingWeekdaysChange: (value: number[]) => void;
  onShowDepsChange: (value: boolean) => void;
  onShowSprintsChange: (value: boolean) => void;
  onAddOffDay: (date: string, name?: string) => void;
  onRemoveOffDay: (date: string) => void;
}

export function ProjectOptionsPanel({
  open,
  projectStart,
  showHolidays,
  showPolishHolidays,
  workingWeekdays,
  showDeps,
  showSprints,
  sprintCount,
  customNonWorkingDays,
  onClose,
  onProjectStartChange,
  onShowHolidaysChange,
  onShowPolishHolidaysChange,
  onWorkingWeekdaysChange,
  onShowDepsChange,
  onShowSprintsChange,
  onAddOffDay,
  onRemoveOffDay,
}: Props) {
  const [offDayDate, setOffDayDate] = useState("");
  const [offDayName, setOffDayName] = useState("");
  const selected = new Set(workingWeekdays.length ? workingWeekdays : DEFAULT_WORKING_WEEKDAYS);

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

  function toggleWeekday(day: number) {
    const next = new Set(selected);
    if (next.has(day)) {
      if (next.size <= 1) return;
      next.delete(day);
    } else {
      next.add(day);
    }
    onWorkingWeekdaysChange([...next].sort((a, b) => a - b));
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
          <div className="pg-options-section-title">Working days</div>
          <p className="pg-options-hint">Default is Sunday–Thursday. Duration skips unselected days.</p>
          <div className="pg-weekday-picks" role="group" aria-label="Working days">
            {WEEKDAY_SHORT.map((label, day) => {
              const on = selected.has(day);
              return (
                <button
                  key={label + day}
                  type="button"
                  className={`pg-weekday-pick${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleWeekday(day)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pg-options-section">
          <div className="pg-options-section-title">Holidays</div>
          <label className="pg-modal-check" title="Israeli public holidays (0 hours when on)">
            <input
              type="checkbox"
              checked={showHolidays}
              onChange={(e) => onShowHolidaysChange(e.target.checked)}
            />
            <span>IL holidays</span>
          </label>
          <label className="pg-modal-check" title="Polish public holidays (0 hours when on)">
            <input
              type="checkbox"
              checked={showPolishHolidays}
              onChange={(e) => onShowPolishHolidaysChange(e.target.checked)}
            />
            <span>PL holidays</span>
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
          <label
            className="pg-modal-check"
            title={
              sprintCount
                ? `Jira sprint bands above the dates (${sprintCount} sprint${sprintCount === 1 ? "" : "s"} on the pulled issues)`
                : "Jira sprint bands above the dates — none on the pulled issues yet"
            }
          >
            <input
              type="checkbox"
              checked={showSprints}
              onChange={(e) => onShowSprintsChange(e.target.checked)}
            />
            <span>Sprints{sprintCount ? ` (${sprintCount})` : ""}</span>
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
