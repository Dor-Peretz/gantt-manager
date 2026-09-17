import { useId } from "react";
import type { Milestone, Resource } from "../lib/types";
import {
  EMPTY_GANTT_FILTERS,
  hasActiveGanttFilters,
  UNASSIGNED_FILTER,
  type GanttFilterMode,
  type GanttFilterValue,
  type SelectableScheduleFocus,
} from "./filtering";

interface Props {
  value: GanttFilterValue;
  resources: Resource[];
  milestones: Milestone[];
  statuses: string[];
  shownCount: number;
  totalCount: number;
  onChange: (next: GanttFilterValue) => void;
}

interface MultiFilterOption {
  value: string;
  label: string;
}

interface MultiFilterProps {
  label: string;
  options: MultiFilterOption[];
  selected: string[];
  mode: GanttFilterMode;
  onSelectedChange: (selected: string[]) => void;
  onModeChange: (mode: GanttFilterMode) => void;
}

function MultiFilter({
  label,
  options,
  selected,
  mode,
  onSelectedChange,
  onModeChange,
}: MultiFilterProps) {
  const id = useId();
  const selectedSet = new Set(selected);
  const summary =
    selected.length === 0
      ? "All"
      : `${mode === "exclude" ? "Exclude" : "Include"} ${selected.length}`;

  function toggle(option: string) {
    onSelectedChange(
      selectedSet.has(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );
  }

  return (
    <div className="pg-filter-field">
      <span>{label}</span>
      <details className="pg-multi-filter">
        <summary title={`${label}: ${summary}`}>
          <span>{summary}</span>
          <span className="pg-multi-caret" aria-hidden>▾</span>
        </summary>
        <div className="pg-multi-menu">
          <div className="pg-multi-mode" aria-label={`${label} filter mode`}>
            <button
              type="button"
              className={mode === "include" ? "active" : ""}
              onClick={() => onModeChange("include")}
            >
              Include
            </button>
            <button
              type="button"
              className={mode === "exclude" ? "active exclude" : ""}
              onClick={() => onModeChange("exclude")}
            >
              Exclude
            </button>
          </div>
          <div className="pg-multi-options">
            {options.map((option, index) => (
              <label key={option.value} htmlFor={`${id}-${index}`}>
                <input
                  id={`${id}-${index}`}
                  type="checkbox"
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="pg-multi-clear"
            disabled={selected.length === 0}
            onClick={() => onSelectedChange([])}
          >
            Clear selection
          </button>
        </div>
      </details>
    </div>
  );
}

export function GanttFilters({
  value,
  resources,
  milestones,
  statuses,
  shownCount,
  totalCount,
  onChange,
}: Props) {
  const active = hasActiveGanttFilters(value);
  const update = (patch: Partial<GanttFilterValue>) => onChange({ ...value, ...patch });
  const focusOptions: Array<{ value: SelectableScheduleFocus; label: string }> = [
    { value: "scheduled", label: "Scheduled" },
    { value: "unscheduled", label: "Unscheduled" },
    { value: "overdue", label: "Overdue" },
    { value: "late", label: "Late to start" },
    { value: "blocked", label: "Has prerequisites" },
    { value: "changed", label: "Locally changed" },
  ];

  return (
    <details className="pg-filters" open={active || undefined}>
      <summary>
        <span>Filters</span>
        {active ? <span className="pg-filter-badge">Active</span> : null}
        <span className="pg-filter-count">
          {shownCount} of {totalCount} items
        </span>
      </summary>
      <div className="pg-filter-controls">
        <label className="pg-filter-field pg-filter-search">
          <span>Search</span>
          <input
            type="search"
            value={value.query}
            onChange={(event) => update({ query: event.target.value })}
            placeholder="Key, title, owner…"
          />
        </label>
        <MultiFilter
          label="Epic / group"
          options={milestones.map((milestone) => ({
            value: milestone.id,
            label: `${milestone.id} · ${milestone.title}`,
          }))}
          selected={value.epicIds}
          mode={value.epicMode}
          onSelectedChange={(epicIds) => update({ epicIds })}
          onModeChange={(epicMode) => update({ epicMode })}
        />
        <MultiFilter
          label="Assignee"
          options={[
            { value: UNASSIGNED_FILTER, label: "Unassigned" },
            ...resources.map((resource) => ({
              value: resource.id,
              label: resource.name,
            })),
          ]}
          selected={value.assigneeIds}
          mode={value.assigneeMode}
          onSelectedChange={(assigneeIds) => update({ assigneeIds })}
          onModeChange={(assigneeMode) => update({ assigneeMode })}
        />
        <MultiFilter
          label="Status"
          options={statuses.map((status) => ({ value: status, label: status }))}
          selected={value.statuses}
          mode={value.statusMode}
          onSelectedChange={(statuses) => update({ statuses })}
          onModeChange={(statusMode) => update({ statusMode })}
        />
        <label className="pg-filter-field">
          <span>Date from</span>
          <input
            type="date"
            value={value.from}
            max={value.through || undefined}
            onChange={(event) => update({ from: event.target.value })}
          />
        </label>
        <label className="pg-filter-field">
          <span>Date and before</span>
          <input
            type="date"
            value={value.through}
            min={value.from || undefined}
            onChange={(event) => update({ through: event.target.value })}
          />
        </label>
        <MultiFilter
          label="Focus"
          options={focusOptions}
          selected={value.focuses}
          mode={value.focusMode}
          onSelectedChange={(focuses) =>
            update({ focuses: focuses as SelectableScheduleFocus[] })
          }
          onModeChange={(focusMode) => update({ focusMode })}
        />
        <button
          type="button"
          className="gantt-btn pg-filter-clear"
          disabled={!active}
          onClick={() => onChange(EMPTY_GANTT_FILTERS)}
        >
          Clear filters
        </button>
      </div>
      <p className="pg-filter-help">
        Multiple choices in one filter match any selected value. Different filters combine
        together. Switch a filter to Exclude to hide its selected values. Dates include work
        that overlaps the selected period.
      </p>
    </details>
  );
}
