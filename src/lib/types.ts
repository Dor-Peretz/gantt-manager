export interface Resource {
  id: string;
  name: string;
  team: string;
  color: string;
  initials: string;
  /** Jira profile avatar URL when available */
  avatarUrl?: string | null;
}

export interface GanttTask {
  /** Jira issue key, e.g. PROJ-123 */
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
  /** Schedule as of last Pull/Push — used to discard local edits */
  pulledStart?: string | null;
  pulledDue?: string | null;
  pulledDurationDays?: number;
  /** Story Points estimate as of last Pull/Push (`null` = none in Jira) */
  pulledEstDays?: number | null;
  /** Jira transition id to apply on Push (when status changed) */
  transitionId?: string | null;
  assignee: string | null;
  /** Issue keys this task is blocked by (prerequisites) */
  blockedBy: string[];
  /** Jira updated ISO timestamp at last pull (for optimistic lock) */
  jiraUpdated: string;
  /** Show as a zero-duration milestone marker (red star) instead of a bar. */
  isMarker?: boolean;
  /**
   * Hidden from the epic list / main timeline — collected in the bottom Hidden folder.
   * Local preference only; never synced to Jira.
   */
  hidden?: boolean;
  /** Created in the app only — never Pull/Push to Jira. */
  localOnly?: boolean;
  /** Draft task created in the app — Push will create it in Jira under createEpicId. */
  pendingCreate?: boolean;
  /** Epic key to parent under when pendingCreate is true */
  createEpicId?: string;
  /** True when start/duration differ from last pull and need Push */
  scheduleDirty?: boolean;
  /** True when a status transition is pending Push */
  statusDirty?: boolean;
  /**
   * Actual time spent for a pending Done transition (Jira timeSpent, e.g. "3d").
   * Asked when the user picks Done; sent on Push as a worklog.
   */
  timeSpent?: string | null;
  /** Resource ids as of last Pull/Push (for assignee dirty detection) */
  pulledResourceIds?: string[];
  /** True when assignee differs from last Pull and needs Push */
  assigneeDirty?: boolean;
  /** Convenience: scheduleDirty || statusDirty || assigneeDirty */
  dirty?: boolean;
  /** Integration test or E2E flow row — stored on linked Jira issues via issue properties. */
  qaKind?: QaKind;
  /** Jira issue keys this QA item covers (required for QA rows). */
  linkedIssueKeys?: string[];
  /** Linked keys last saved to Jira — used when Push updates QA properties. */
  pulledLinkedIssueKeys?: string[];
}

export interface StatusTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

/** Local-only timeline milestone — stored in preferences, never synced to Jira. */
export interface LocalMarker {
  id: string;
  title: string;
  /** Date shown on the timeline (YYYY-MM-DD) */
  start: string;
  /** @deprecated Was used when markers lived under epics; ignored now. */
  epicId?: string;
}

/** User-defined non-working day (always applies, independent of IL holidays toggle). */
export interface CustomNonWorkingDay {
  date: string;
  name?: string;
}

export type QaKind = "integration" | "e2e";

/** Shared QA timeline item — persisted on linked Jira issues (issue property). */
export interface QaItem {
  id: string;
  kind: QaKind;
  title: string;
  /** Start date (YYYY-MM-DD) */
  start: string;
  durationDays: number;
  linkedIssueKeys: string[];
}

/** Jira issue property that stores QA timeline rows on linked issues. */
export const QA_PROPERTY_KEY = "gantt.qa";
/** Previous property key — still read so existing rows keep loading. */
export const QA_PROPERTY_KEY_LEGACY = "sunbit.gantt.qa";

export const QA_COLORS: Record<QaKind, string> = {
  integration: "#0d9488",
  e2e: "#7c3aed",
};

/** Draft task awaiting Push → Jira create. */
export interface DraftTask {
  id: string;
  epicId: string;
  title: string;
  start: string | null;
  due: string | null;
  durationDays: number;
}

/** QA item waiting for Push → delete from linked Jira issues. */
export interface PendingQaDelete {
  id: string;
  linkedIssueKeys: string[];
  /** Snapshot used by Clear to restore a queued delete. */
  kind?: QaKind;
  title?: string;
  start?: string;
  durationDays?: number;
}

export interface Milestone {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  tasks: GanttTask[];
  /** Local-only milestone row (red star) — not a Jira epic, never synced. */
  localOnly?: boolean;
  /** QA item row (integration / e2e) — synced via Jira issue properties on linked tasks. */
  qaKind?: QaKind;
}

/**
 * Widths (px) of the resizable left-pane columns. Name is the priority column:
 * it absorbs leftover space and is the last one squeezed when room runs out.
 */
export interface ColumnWidths {
  name: number;
  start: number;
  dur: number;
  status: number;
  res: number;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 238,
  start: 108,
  dur: 78,
  status: 108,
  res: 100,
};

export function normalizeColumnWidths(
  raw: Partial<ColumnWidths> | null | undefined,
): ColumnWidths {
  const pick = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : fallback;
  return {
    name: pick(raw?.name, DEFAULT_COLUMN_WIDTHS.name),
    start: pick(raw?.start, DEFAULT_COLUMN_WIDTHS.start),
    dur: pick(raw?.dur, DEFAULT_COLUMN_WIDTHS.dur),
    status: pick(raw?.status, DEFAULT_COLUMN_WIDTHS.status),
    res: pick(raw?.res, DEFAULT_COLUMN_WIDTHS.res),
  };
}

export interface GanttModel {
  title: string;
  projectStart: string;
  dayWidthPx: number;
  leftPanelWidth: number;
  columnWidths: ColumnWidths;
  /** Height of the pinned Resources dock (px) */
  resourcesDockHeight: number;
  /** When true, Resources dock is minimized */
  resourcesDockCollapsed: boolean;
  hoursPerDay: number;
  showHolidays: boolean;
  showDeps: boolean;
  /** Manual off days — always skip in schedule/resource math. */
  customNonWorkingDays: CustomNonWorkingDay[];
  jql: string;
  resources: Resource[];
  milestones: Milestone[];
  pulledAt: string | null;
  /** When true, the bottom Hidden folder is collapsed (default). */
  hiddenFolderCollapsed?: boolean;
}

export type ThemeMode = "light" | "dark";

/** Named JQL preset saved in per-viewer preferences. */
export interface SavedJql {
  id: string;
  name: string;
  jql: string;
}

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
  /** issueKey -> hidden from epic list / main timeline */
  hiddenTasks: Record<string, boolean>;
  /** When true, the bottom Hidden folder is collapsed */
  hiddenFolderCollapsed: boolean;
  /** Local-only milestone markers (never synced to Jira) */
  localMarkers: LocalMarker[];
  /** Draft tasks to create in Jira on Push */
  draftTasks: DraftTask[];
  /** QA items removed locally but not yet deleted from Jira issue properties */
  pendingQaDeletes: PendingQaDelete[];
  projectStart: string;
  showHolidays: boolean;
  showDeps: boolean;
  customNonWorkingDays: CustomNonWorkingDay[];
  dayWidthPx: number;
  leftPanelWidth: number;
  columnWidths: ColumnWidths;
  resourcesDockHeight: number;
  resourcesDockCollapsed: boolean;
  jql: string;
  /** Named JQL presets for quick switching */
  savedJqls: SavedJql[];
  /** Currently selected saved JQL id, or null when editing custom JQL */
  activeSavedJqlId: string | null;
  milestoneColors: Record<string, string>;
  theme: ThemeMode;
}

/** Compact Jira changelog item for schedule rewind. */
export interface ChangelogItem {
  fieldId: string;
  field: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface ChangelogHistory {
  created: string;
  items: ChangelogItem[];
}

export interface IssueChangelog {
  key: string;
  created: string;
  histories: ChangelogHistory[];
}

/** Field ids needed to interpret changelog entries on the client. */
export interface HistoryFieldMap {
  startDate: string;
  storyPoints: string;
}

/** How Jira history is shown when history mode is on. */
export type HistoryViewMode = "overlay" | "asOf";

/** Task schedule reconstructed from Jira changelog as of a date. */
export interface HistoricalSchedule {
  start: string | null;
  due: string | null;
  durationDays: number;
  estDays: number | null;
  status: string;
  assignee: string | null;
}

export interface PushItem {
  key: string;
  start: string | null;
  due: string | null;
  jiraUpdated: string;
  /** Working-day estimate written to Jira Story Points */
  storyPoints?: number | null;
  /** When set, Push will transition the issue to this status */
  transitionId?: string | null;
  status?: string | null;
  /**
   * Actual time spent to log when transitioning to Done (Jira timeSpent, e.g. "3d").
   * Entered by the user when selecting Done.
   */
  timeSpent?: string | null;
  /** Jira account id to assign (null = unassign). Omit to leave assignee unchanged. */
  assigneeAccountId?: string | null;
  /** When set, create a new Jira issue instead of updating an existing one */
  create?: {
    epicKey: string;
    summary: string;
    draftId: string;
  };
}

export interface PushResult {
  key: string;
  status: "ok" | "conflict" | "error" | "skipped";
  message?: string;
  jiraUpdated?: string;
  /** Original draft id when a create succeeded */
  draftId?: string;
  /** New Jira key when a create succeeded */
  createdKey?: string;
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
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    resourcesDockHeight: 220,
    resourcesDockCollapsed: false,
    hoursPerDay: 8,
    showHolidays: true,
    showDeps: false,
    customNonWorkingDays: [],
    jql,
    resources: [],
    milestones: [],
    pulledAt: null,
    hiddenFolderCollapsed: true,
  };
}
