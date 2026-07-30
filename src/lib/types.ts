export interface Resource {
  id: string;
  name: string;
  team: string;
  color: string;
  initials: string;
}

export interface GanttTask {
  /** Jira issue key, e.g. SBT-62906 */
  id: string;
  /** Friendly id from summary prefix, e.g. M1-T1 */
  friendlyId: string;
  title: string;
  owner: string;
  start: string | null;
  due: string | null;
  durationDays: number;
  estDays: number | null;
  resourceIds: string[];
  status: string;
  /** Status name as of last Pull (to detect status edits) */
  pulledStatus: string;
  /** Jira transition id to apply on Push (when status changed) */
  transitionId?: string | null;
  assignee: string | null;
  /** Issue keys this task is blocked by (prerequisites) */
  blockedBy: string[];
  /** Jira updated ISO timestamp at last pull (for optimistic lock) */
  jiraUpdated: string;
  /** Show as a zero-duration milestone marker (red star) instead of a bar. */
  isMarker?: boolean;
  /** True when start/duration differ from last pull and need Push */
  scheduleDirty?: boolean;
  /** True when a status transition is pending Push */
  statusDirty?: boolean;
  /** Convenience: scheduleDirty || statusDirty */
  dirty?: boolean;
}

export interface StatusTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

export interface Milestone {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  tasks: GanttTask[];
}

export interface GanttModel {
  title: string;
  projectStart: string;
  dayWidthPx: number;
  leftPanelWidth: number;
  /** Height of the pinned Resources dock (px) */
  resourcesDockHeight: number;
  hoursPerDay: number;
  showHolidays: boolean;
  showDeps: boolean;
  jql: string;
  resources: Resource[];
  milestones: Milestone[];
  pulledAt: string | null;
}

export type ThemeMode = "light" | "dark";

export interface LocalState {
  resources: Resource[];
  /** issueKey -> resourceIds */
  allocations: Record<string, string[]>;
  /** epicKey -> collapsed */
  collapsed: Record<string, boolean>;
  /** epicKey -> ordered task ids (custom manual order) */
  taskOrder: Record<string, string[]>;
  /** ordered epic keys (custom manual order) */
  milestoneOrder: string[];
  /** issueKey -> shown as a milestone marker (red star) */
  markers: Record<string, boolean>;
  projectStart: string;
  showHolidays: boolean;
  showDeps: boolean;
  dayWidthPx: number;
  leftPanelWidth: number;
  resourcesDockHeight: number;
  jql: string;
  milestoneColors: Record<string, string>;
  theme: ThemeMode;
}

export interface PushItem {
  key: string;
  start: string | null;
  due: string | null;
  jiraUpdated: string;
  /** When set, Push will transition the issue to this status */
  transitionId?: string | null;
  status?: string | null;
}

export interface PushResult {
  key: string;
  status: "ok" | "conflict" | "error" | "skipped";
  message?: string;
  jiraUpdated?: string;
}

/** Distinct palette for Jira assignees (task bars + resource rows). */
export const DEFAULT_COLORS = [
  "#17A0E0",
  "#22C55E",
  "#F59E0B",
  "#A855F7",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#0E80C4",
  "#84CC16",
  "#F97316",
  "#6366F1",
  "#14B8A6",
  "#E11D48",
  "#8B5CF6",
  "#0EA5E9",
  "#CA8A04",
];

export const UNASSIGNED_COLOR = "#94A3B8";

export const MILESTONE_COLORS: Record<string, string> = {
  M1: "#17A0E0",
  M2: "#22C55E",
  M3: "#F59E0B",
  M4: "#A855F7",
  M5: "#EF4444",
};

export function emptyModel(jql = ""): GanttModel {
  return {
    title: "Jira Gantt",
    projectStart: new Date().toISOString().slice(0, 10),
    dayWidthPx: 28,
    leftPanelWidth: 680,
    resourcesDockHeight: 220,
    hoursPerDay: 8,
    showHolidays: true,
    showDeps: true,
    jql,
    resources: [],
    milestones: [],
    pulledAt: null,
  };
}
