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
  assignee: string | null;
  /** Issue keys this task is blocked by (prerequisites) */
  blockedBy: string[];
  /** Jira updated ISO timestamp at last pull (for optimistic lock) */
  jiraUpdated: string;
  dirty?: boolean;
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
  hoursPerDay: number;
  showHolidays: boolean;
  showDeps: boolean;
  jql: string;
  resources: Resource[];
  milestones: Milestone[];
  pulledAt: string | null;
}

export interface LocalState {
  resources: Resource[];
  /** issueKey -> resourceIds */
  allocations: Record<string, string[]>;
  /** epicKey -> collapsed */
  collapsed: Record<string, boolean>;
  projectStart: string;
  showHolidays: boolean;
  showDeps: boolean;
  dayWidthPx: number;
  leftPanelWidth: number;
  jql: string;
  milestoneColors: Record<string, string>;
}

export interface PushItem {
  key: string;
  start: string | null;
  due: string | null;
  jiraUpdated: string;
}

export interface PushResult {
  key: string;
  status: "ok" | "conflict" | "error" | "skipped";
  message?: string;
  jiraUpdated?: string;
}

export const DEFAULT_COLORS = [
  "#17A0E0",
  "#22C55E",
  "#F59E0B",
  "#A855F7",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#0E80C4",
];

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
    hoursPerDay: 8,
    showHolidays: true,
    showDeps: true,
    jql,
    resources: [],
    milestones: [],
    pulledAt: null,
  };
}
