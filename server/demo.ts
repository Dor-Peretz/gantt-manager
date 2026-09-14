/**
 * Demo mode — a self-contained fake Jira board for screenshots and walkthroughs.
 *
 * Enabled with GANTT_DEMO=1 (`npm run demo`). Nothing here touches a real Jira
 * site, and demo runs read/write `preferences.demo.json` so personal prefs and
 * saved JQLs stay out of the way.
 */
import type {
  GanttModel,
  GanttTask,
  LocalState,
  Milestone,
  PushItem,
  PushResult,
  QaItem,
  Resource,
  StatusTransition,
} from "../src/lib/types.ts";
import { normalizeColumnWidths } from "../src/lib/types.ts";
import {
  dueFromStartDuration,
  initialsFromName,
  setCustomNonWorkingDays,
} from "../src/lib/workdays.ts";
import { applySavedBoardOrder } from "../src/lib/boardOrder.ts";
import {
  filterQaItemsForBoard,
  injectQaItems,
  refreshQaAssignees,
} from "../src/lib/qaItems.ts";

export function isDemo(): boolean {
  return process.env.GANTT_DEMO === "1";
}

export const DEMO_BASE_URL = "https://acme.atlassian.net";
export const DEMO_USER = "Dana Cole";
export const DEMO_JQL =
  '(key = NMB-1200 OR issuekey in portfolioChildIssuesOf(NMB-1200)) AND status != Canceled ORDER BY summary ASC';

const PROJECT_START = "2026-08-16";

interface Person {
  id: string;
  name: string;
  team: string;
  color: string;
}

const PEOPLE: Person[] = [
  { id: "acct-alex", name: "Alex Levin", team: "Platform", color: "#17A0E0" },
  { id: "acct-maya", name: "Maya Ross", team: "Payments", color: "#22C55E" },
  { id: "acct-tom", name: "Tom Shaw", team: "Payments", color: "#F59E0B" },
  { id: "acct-kim", name: "Kim Park", team: "Quality", color: "#A855F7" },
  { id: "acct-dana", name: "Dana Cole", team: "Risk", color: "#06B6D4" },
];

const PERSON_BY_ID = new Map(PEOPLE.map((p) => [p.id, p]));

interface EpicSpec {
  key: string;
  summary: string;
  color: string;
}

interface TaskSpec {
  key: string;
  epic: string;
  friendlyId: string;
  title: string;
  start: string;
  durationDays: number;
  status: string;
  who: string;
  blockedBy?: string[];
  /** Set by demo Push so pushed edits survive the next Pull. */
  due?: string | null;
}

const EPICS: EpicSpec[] = [
  { key: "NMB-1201", summary: "[Nimbus][M0] Platform setup", color: "#0EA5E9" },
  { key: "NMB-1210", summary: "[Nimbus][M1] Credit limits", color: "#17A0E0" },
  { key: "NMB-1220", summary: "[Nimbus][M2] Offers", color: "#22C55E" },
  { key: "NMB-1230", summary: "[Nimbus][M3] Partner programs", color: "#F59E0B" },
  { key: "NMB-1240", summary: "[Nimbus][M4] Account management", color: "#A855F7" },
  { key: "NMB-1250", summary: "[Nimbus][M5] Rollout", color: "#EF4444" },
  { key: "NMB-1260", summary: "[Nimbus][M6] Merchant ops", color: "#14B8A6" },
];

const TASKS: TaskSpec[] = [
  { key: "NMB-1202", epic: "NMB-1201", friendlyId: "M0-T1", title: "Service scaffolding + repo setup", start: "2026-08-16", durationDays: 4, status: "Done", who: "acct-alex" },
  { key: "NMB-1203", epic: "NMB-1201", friendlyId: "M0-T2", title: "CI pipeline + test harness", start: "2026-08-20", durationDays: 3, status: "Done", who: "acct-kim" },
  { key: "NMB-1204", epic: "NMB-1201", friendlyId: "M0-T3", title: "Feature flag rollout switches", start: "2026-08-25", durationDays: 2, status: "Done", who: "acct-maya" },

  { key: "NMB-1211", epic: "NMB-1210", friendlyId: "M1-T1", title: "Limit calculation service", start: "2026-08-23", durationDays: 5, status: "In Progress", who: "acct-alex" },
  { key: "NMB-1212", epic: "NMB-1210", friendlyId: "M1-T2", title: "Limit rules admin API", start: "2026-08-30", durationDays: 4, status: "In Progress", who: "acct-tom", blockedBy: ["NMB-1211"] },
  { key: "NMB-1213", epic: "NMB-1210", friendlyId: "M1-T3", title: "Limits contract tests", start: "2026-09-02", durationDays: 3, status: "In Review", who: "acct-kim" },

  { key: "NMB-1221", epic: "NMB-1220", friendlyId: "M2-T1", title: "Offer engine", start: "2026-08-30", durationDays: 6, status: "In Progress", who: "acct-maya" },
  { key: "NMB-1222", epic: "NMB-1220", friendlyId: "M2-T2", title: "Offer eligibility rules", start: "2026-09-06", durationDays: 4, status: "To Do", who: "acct-dana", blockedBy: ["NMB-1221"] },
  { key: "NMB-1223", epic: "NMB-1220", friendlyId: "M2-T3", title: "Offer states in checkout UI", start: "2026-09-10", durationDays: 3, status: "To Do", who: "acct-tom" },

  { key: "NMB-1231", epic: "NMB-1230", friendlyId: "M3-T1", title: "Program configuration", start: "2026-09-01", durationDays: 5, status: "In Progress", who: "acct-dana" },
  { key: "NMB-1232", epic: "NMB-1230", friendlyId: "M3-T2", title: "Partner onboarding flow", start: "2026-09-08", durationDays: 4, status: "To Do", who: "acct-maya" },

  { key: "NMB-1241", epic: "NMB-1240", friendlyId: "M4-T1", title: "Plan management service", start: "2026-09-06", durationDays: 5, status: "To Do", who: "acct-alex" },
  { key: "NMB-1242", epic: "NMB-1240", friendlyId: "M4-T2", title: "Payment rules engine", start: "2026-09-13", durationDays: 4, status: "To Do", who: "acct-kim", blockedBy: ["NMB-1241"] },

  { key: "NMB-1251", epic: "NMB-1250", friendlyId: "M5-T1", title: "Staged rollout + monitoring", start: "2026-09-15", durationDays: 5, status: "Backlog", who: "acct-tom" },
  { key: "NMB-1252", epic: "NMB-1250", friendlyId: "M5-T2", title: "Runbook + on-call handover", start: "2026-09-21", durationDays: 2, status: "Backlog", who: "acct-dana" },

  { key: "NMB-1261", epic: "NMB-1260", friendlyId: "M6-T1", title: "Merchant ops dashboard", start: "2026-09-14", durationDays: 4, status: "Backlog", who: "acct-maya" },
];

let qaItems: QaItem[] = [
  {
    id: "qa-integration-1",
    kind: "integration",
    title: "Integration tests — core services",
    start: "2026-09-08",
    durationDays: 3,
    linkedIssueKeys: ["NMB-1211", "NMB-1213"],
  },
  {
    id: "qa-e2e-1",
    kind: "e2e",
    title: "E2E — limits + offers",
    start: "2026-09-15",
    durationDays: 2,
    linkedIssueKeys: ["NMB-1221", "NMB-1222"],
  },
];

const UPDATED_AT = "2026-09-01T09:00:00.000+0000";

function demoResources(): Resource[] {
  return PEOPLE.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    color: p.color,
    initials: initialsFromName(p.name),
    avatarUrl: null,
  }));
}

/** Seed preferences for a fresh demo run — a saved JQL, colours and two markers. */
export function demoPreferences(): Partial<LocalState> {
  return {
    jql: DEMO_JQL,
    savedJqls: [{ id: "demo-nimbus", name: "Nimbus", jql: DEMO_JQL }],
    activeSavedJqlId: "demo-nimbus",
    projectStart: PROJECT_START,
    dayWidthPx: 24,
    showHolidays: true,
    showDeps: true,
    theme: "light",
    resources: demoResources(),
    milestoneColors: Object.fromEntries(EPICS.map((e) => [e.key, e.color])),
    localMarkers: [
      { id: "local-release-cut", title: "Release cut", start: "2026-09-17" },
      { id: "local-prod-ready", title: "Prod ready", start: "2026-09-22" },
    ],
  };
}

export function demoHealth(): { ok: true; site: string; displayName: string } {
  return {
    ok: true,
    site: `${DEMO_BASE_URL} as ${DEMO_USER}`,
    displayName: DEMO_USER,
  };
}

function taskFromSpec(spec: TaskSpec, holidaysOn: boolean): GanttTask {
  const person = PERSON_BY_ID.get(spec.who);
  const due = spec.due ?? dueFromStartDuration(spec.start, spec.durationDays, holidaysOn);
  const resourceIds = person ? [person.id] : [];
  return {
    id: spec.key,
    friendlyId: spec.friendlyId,
    title: spec.title,
    owner: person?.team || "—",
    start: spec.start,
    due,
    durationDays: spec.durationDays,
    estDays: spec.durationDays,
    resourceIds,
    pulledResourceIds: resourceIds,
    status: spec.status,
    pulledStatus: spec.status,
    pulledStart: spec.start,
    pulledDue: due,
    pulledDurationDays: spec.durationDays,
    pulledEstDays: spec.durationDays,
    transitionId: null,
    assignee: person?.name || null,
    blockedBy: spec.blockedBy ? [...spec.blockedBy] : [],
    jiraUpdated: UPDATED_AT,
    dirty: false,
  };
}

export interface DemoPull {
  model: GanttModel;
  resources: Resource[];
  allocations: Record<string, string[]>;
}

/** Board built from the fake dataset, with the viewer's saved prefs applied. */
export function demoPull(jql: string, local: LocalState): DemoPull {
  setCustomNonWorkingDays(local.customNonWorkingDays ?? []);
  const holidaysOn = local.showHolidays !== false;
  const savedMarkers = local.markers || {};
  const savedHidden = local.hiddenTasks || {};

  const milestones: Milestone[] = EPICS.map((epic) => {
    const tasks = TASKS.filter((t) => t.epic === epic.key).map((spec) => {
      const task = taskFromSpec(spec, holidaysOn);
      task.isMarker = savedMarkers[task.id] === true;
      task.hidden = savedHidden[task.id] === true;
      return task;
    });
    return {
      id: epic.key,
      title: epic.summary,
      color: local.milestoneColors?.[epic.key] || epic.color,
      collapsed: local.collapsed?.[epic.key] ?? true,
      tasks,
    };
  });

  const resources = demoResources();
  const allocations: Record<string, string[]> = {};
  for (const m of milestones) {
    for (const t of m.tasks) allocations[t.id] = t.resourceIds;
  }

  let model: GanttModel = {
    title: "Jira Gantt",
    projectStart: local.projectStart || PROJECT_START,
    dayWidthPx: local.dayWidthPx || 24,
    leftPanelWidth: local.leftPanelWidth || 680,
    columnWidths: normalizeColumnWidths(local.columnWidths),
    resourcesDockHeight: local.resourcesDockHeight || 220,
    resourcesDockCollapsed: local.resourcesDockCollapsed === true,
    hoursPerDay: 8,
    showHolidays: holidaysOn,
    showDeps: local.showDeps === true,
    customNonWorkingDays: local.customNonWorkingDays ?? [],
    jql: jql || DEMO_JQL,
    resources,
    milestones,
    pulledAt: new Date().toISOString(),
    hiddenFolderCollapsed: local.hiddenFolderCollapsed !== false,
  };
  model = applySavedBoardOrder(model, local.milestoneOrder || [], local.taskOrder || {});

  const visibleQa = filterQaItemsForBoard(model, qaItems);
  if (visibleQa.length) {
    model = injectQaItems(model, visibleQa, local.milestoneOrder);
    model = refreshQaAssignees(model);
  }

  return { model, resources, allocations };
}

/** Accept every push and keep the edit, so demo Push → Pull behaves like Jira. */
export function demoPush(items: PushItem[]): PushResult[] {
  const jiraUpdated = new Date().toISOString().replace("Z", "+0000");
  return items.map((item, i) => {
    if (item.create) {
      const createdKey = `NMB-19${String(i + 1).padStart(2, "0")}`;
      TASKS.push({
        key: createdKey,
        epic: item.create.epicKey,
        friendlyId: createdKey,
        title: item.create.summary,
        start: item.start || PROJECT_START,
        durationDays: 1,
        status: "To Do",
        who: "acct-alex",
        due: item.due ?? null,
      });
      return { key: item.key, status: "ok", jiraUpdated, draftId: item.create.draftId, createdKey };
    }
    const spec = TASKS.find((t) => t.key === item.key);
    if (spec) {
      if (item.start) spec.start = item.start;
      if (item.due !== undefined) spec.due = item.due;
      if (item.status) spec.status = item.status;
      if (item.assigneeAccountId !== undefined && item.assigneeAccountId) {
        spec.who = item.assigneeAccountId;
      }
    }
    return { key: item.key, status: "ok", jiraUpdated };
  });
}

const DEMO_TRANSITIONS: StatusTransition[] = [
  { id: "11", name: "Backlog", to: { id: "1", name: "Backlog" } },
  { id: "21", name: "To Do", to: { id: "2", name: "To Do" } },
  { id: "31", name: "In Progress", to: { id: "3", name: "In Progress" } },
  { id: "41", name: "In Review", to: { id: "4", name: "In Review" } },
  { id: "51", name: "Done", to: { id: "5", name: "Done" } },
];

export function demoTransitions(): StatusTransition[] {
  return DEMO_TRANSITIONS.map((t) => ({ ...t, to: { ...t.to } }));
}

export function demoSaveQaItem(item: QaItem): void {
  qaItems = [...qaItems.filter((q) => q.id !== item.id), { ...item }];
}

export function demoDeleteQaItem(itemId: string): void {
  qaItems = qaItems.filter((q) => q.id !== itemId);
}
