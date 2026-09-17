import type { GanttModel, GanttTask, Milestone } from "../lib/types";
import { formatYmd, todayLocal } from "../lib/workdays";

export type ScheduleFocus =
  | "all"
  | "scheduled"
  | "unscheduled"
  | "overdue"
  | "late"
  | "blocked"
  | "changed";

export type SelectableScheduleFocus = Exclude<ScheduleFocus, "all">;
export type GanttFilterMode = "include" | "exclude";

export interface GanttFilterValue {
  query: string;
  epicIds: string[];
  epicMode: GanttFilterMode;
  assigneeIds: string[];
  assigneeMode: GanttFilterMode;
  statuses: string[];
  statusMode: GanttFilterMode;
  from: string;
  through: string;
  focuses: SelectableScheduleFocus[];
  focusMode: GanttFilterMode;
}

export const EMPTY_GANTT_FILTERS: GanttFilterValue = {
  query: "",
  epicIds: [],
  epicMode: "include",
  assigneeIds: [],
  assigneeMode: "include",
  statuses: [],
  statusMode: "include",
  from: "",
  through: "",
  focuses: [],
  focusMode: "include",
};

export const UNASSIGNED_FILTER = "__unassigned__";

function isDoneStatus(status: string): boolean {
  return /done|closed|resolved|complete|ship/i.test(status || "");
}

function isReadyStatus(status: string): boolean {
  return /ready\s*for\s*dev|ready\s*for\s*development|selected for development|to\s*do|^todo$|backlog|^open$/i.test(
    status || "",
  );
}

function taskText(task: GanttTask): string {
  return [
    task.id,
    task.friendlyId,
    task.title,
    task.owner,
    task.assignee,
    ...(task.linkedIssueKeys || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function selectionMatches(
  itemMatches: boolean,
  selectedCount: number,
  mode: GanttFilterMode,
): boolean {
  if (!selectedCount) return true;
  return mode === "include" ? itemMatches : !itemMatches;
}

function taskMatchesFocus(
  task: GanttTask,
  focus: SelectableScheduleFocus,
  today: string,
): boolean {
  const taskStart = task.start || task.due;
  switch (focus) {
    case "scheduled":
      return !!taskStart;
    case "unscheduled":
      return !taskStart;
    case "overdue":
      return !!task.due && task.due < today && !isDoneStatus(task.status);
    case "late":
      return (
        !!task.start &&
        task.start < today &&
        !isDoneStatus(task.status) &&
        isReadyStatus(task.status)
      );
    case "blocked":
      return task.blockedBy.length > 0;
    case "changed":
      return !!task.dirty;
  }
}

function taskMatches(
  task: GanttTask,
  milestoneMatchesQuery: boolean,
  filters: GanttFilterValue,
  today: string,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query && !milestoneMatchesQuery && !taskText(task).includes(query)) return false;

  const assigneeMatches = filters.assigneeIds.some((assigneeId) =>
    assigneeId === UNASSIGNED_FILTER
      ? task.resourceIds.length === 0
      : task.resourceIds.includes(assigneeId),
  );
  if (
    !selectionMatches(
      assigneeMatches,
      filters.assigneeIds.length,
      filters.assigneeMode,
    )
  ) {
    return false;
  }

  if (
    !selectionMatches(
      filters.statuses.includes(task.status),
      filters.statuses.length,
      filters.statusMode,
    )
  ) {
    return false;
  }

  const taskStart = task.start || task.due;
  const taskEnd = task.due || task.start;
  if (filters.from && (!taskEnd || taskEnd < filters.from)) return false;
  if (filters.through && (!taskStart || taskStart > filters.through)) return false;

  const focusMatches = filters.focuses.some((focus) =>
    taskMatchesFocus(task, focus, today),
  );
  return selectionMatches(focusMatches, filters.focuses.length, filters.focusMode);
}

export function hasActiveGanttFilters(filters: GanttFilterValue): boolean {
  return (
    !!filters.query.trim() ||
    filters.epicIds.length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.statuses.length > 0 ||
    !!filters.from ||
    !!filters.through ||
    filters.focuses.length > 0
  );
}

export function filterGanttModel(
  model: GanttModel,
  filters: GanttFilterValue,
): GanttModel {
  if (!hasActiveGanttFilters(filters)) return model;

  const query = filters.query.trim().toLowerCase();
  const today = formatYmd(todayLocal());
  const hasTaskFilters =
    filters.assigneeIds.length > 0 ||
    filters.statuses.length > 0 ||
    !!filters.from ||
    !!filters.through ||
    filters.focuses.length > 0;

  const milestones = model.milestones.flatMap((milestone): Milestone[] => {
    if (
      !selectionMatches(
        filters.epicIds.includes(milestone.id),
        filters.epicIds.length,
        filters.epicMode,
      )
    ) {
      return [];
    }

    const milestoneMatchesQuery =
      !query || `${milestone.id} ${milestone.title}`.toLowerCase().includes(query);
    const matchedTasks = milestone.tasks.filter((task) =>
      taskMatches(task, milestoneMatchesQuery, filters, today),
    );

    if (!matchedTasks.length) {
      if (!milestone.tasks.length && !hasTaskFilters && milestoneMatchesQuery) {
        return [{ ...milestone, collapsed: false }];
      }
      return [];
    }

    // Keep the epic's own task as structural data when only child tasks match.
    // It supplies the epic row's bar and metadata but does not reveal other children.
    const epicSelf = milestone.tasks.find((task) => task.id === milestone.id);
    const tasks =
      epicSelf && !matchedTasks.some((task) => task.id === epicSelf.id)
        ? [epicSelf, ...matchedTasks]
        : matchedTasks;

    return [{ ...milestone, collapsed: false, tasks }];
  });

  return { ...model, milestones };
}
