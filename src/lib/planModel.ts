import { dueFromStartDuration, normalizeWorkingWeekdays, workCalendarFrom } from "./workdays";
import type {
  GanttModel,
  GanttTask,
  JiraPlan,
  Milestone,
  PlanEpic,
  PlanTask,
  Resource,
} from "./types";
import { DEFAULT_COLORS, MILESTONE_COLORS, normalizeColumnWidths } from "./types";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function epicColor(epicId: string, title: string, override?: string): string {
  if (override) return override;
  const m = title.match(/\[M(\d+)\]/i) || title.match(/\bM(\d+)\b/i);
  if (m) {
    const key = `M${m[1]}`;
    if (MILESTONE_COLORS[key]) return MILESTONE_COLORS[key];
  }
  return DEFAULT_COLORS[Math.abs(hash(epicId)) % DEFAULT_COLORS.length];
}

function planTaskToGantt(task: PlanTask, epicId: string): GanttTask {
  const resourceIds = task.assigneeAccountId ? [`jira:${task.assigneeAccountId}`] : [];
  return {
    id: task.id,
    friendlyId: task.friendlyId || "PLAN",
    title: task.title,
    owner: "—",
    start: task.start,
    due: task.due,
    durationDays: task.durationDays,
    estDays: task.estDays,
    resourceIds,
    pulledResourceIds: [...resourceIds],
    status: task.status || "To Do",
    pulledStatus: task.status || "To Do",
    pulledStart: task.start,
    pulledDue: task.due,
    pulledDurationDays: task.durationDays,
    pulledEstDays: task.estDays,
    transitionId: null,
    assignee: task.assigneeName,
    blockedBy: task.blockedBy,
    jiraUpdated: "",
    planOnly: true,
    pendingCreate: true,
    createEpicId: epicId,
    scheduleDirty: false,
    statusDirty: false,
    assigneeDirty: false,
    dirty: false,
  };
}

function ganttTaskToPlan(task: GanttTask): PlanTask {
  const accountId = task.resourceIds[0]?.startsWith("jira:")
    ? task.resourceIds[0].slice(5)
    : null;
  return {
    id: task.id,
    title: task.title,
    friendlyId: task.friendlyId || "PLAN",
    start: task.start,
    due: task.due,
    durationDays: Math.max(1, task.durationDays || 1),
    estDays: task.estDays,
    assigneeAccountId: accountId,
    assigneeName: task.assignee,
    status: task.status || "To Do",
    blockedBy: task.blockedBy || [],
  };
}

export function planToGanttModel(plan: JiraPlan, layout?: Partial<GanttModel>): GanttModel {
  const resourcesById = new Map<string, Resource>();
  for (const epic of plan.epics) {
    for (const task of epic.tasks) {
      if (!task.assigneeAccountId) continue;
      const id = `jira:${task.assigneeAccountId}`;
      if (!resourcesById.has(id)) {
        const name = task.assigneeName || task.assigneeAccountId;
        resourcesById.set(id, {
          id,
          name,
          team: "Plan assignee",
          color: DEFAULT_COLORS[Math.abs(hash(id)) % DEFAULT_COLORS.length],
          initials: name
            .split(/\s+/)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
        });
      }
    }
  }

  const milestones: Milestone[] = plan.epics.map((epic) => ({
    id: epic.id,
    title: epic.title,
    color: epic.color || epicColor(epic.id, epic.title),
    collapsed: epic.collapsed,
    planOnly: true,
    tasks: epic.tasks.map((t) => planTaskToGantt(t, epic.id)),
  }));

  return {
    title: `Plan · ${plan.draftTicketKey}`,
    projectStart: plan.projectStart,
    dayWidthPx: layout?.dayWidthPx || 28,
    leftPanelWidth: layout?.leftPanelWidth || 680,
    columnWidths: normalizeColumnWidths(layout?.columnWidths),
    resourcesDockHeight: layout?.resourcesDockHeight || 220,
    resourcesDockCollapsed: layout?.resourcesDockCollapsed ?? false,
    hoursPerDay: 8,
    showHolidays: layout?.showHolidays ?? plan.showHolidays,
    showPolishHolidays: layout?.showPolishHolidays === true,
    workingWeekdays: normalizeWorkingWeekdays(
      layout?.workingWeekdays ?? plan.workingWeekdays,
    ),
    showDeps: layout?.showDeps === true,
    // Plan rows are not Jira issues yet, so there are no sprints to band.
    showSprints: false,
    customNonWorkingDays: layout?.customNonWorkingDays || [],
    jql: "",
    resources: [...resourcesById.values()],
    milestones,
    pulledAt: plan.updatedAt,
    hiddenFolderCollapsed: true,
  };
}

export function ganttModelToPlan(model: GanttModel, base: JiraPlan): JiraPlan {
  const epics: PlanEpic[] = model.milestones
    .filter((m) => m.planOnly)
    .map((m) => {
      const prev = base.epics.find((e) => e.id === m.id);
      return {
        id: m.id,
        title: m.title,
        color: m.color,
        collapsed: m.collapsed,
        publishedKey: prev?.publishedKey,
        tasks: m.tasks.filter((t) => t.planOnly).map(ganttTaskToPlan),
      };
    });
  return {
    ...base,
    projectStart: model.projectStart,
    showHolidays: model.showHolidays !== false,
    showPolishHolidays: model.showPolishHolidays === true,
    workingWeekdays: model.workingWeekdays,
    epics,
    updatedAt: new Date().toISOString(),
  };
}

export function applyPlanSchedule(
  task: PlanTask,
  patch: Partial<GanttTask>,
  cal: { showHolidays?: boolean; showPolishHolidays?: boolean; workingWeekdays?: number[] } | boolean,
): PlanTask {
  const next = { ...task };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.start !== undefined) next.start = patch.start;
  if (patch.durationDays !== undefined) {
    next.durationDays = Math.max(1, patch.durationDays);
    if (patch.estDays === undefined) {
      next.estDays = Math.max(1, Math.round(next.durationDays));
    }
  }
  if (patch.estDays !== undefined) {
    next.estDays =
      patch.estDays != null && patch.estDays > 0 ? Math.max(1, Math.round(patch.estDays)) : null;
    if (next.estDays != null) next.durationDays = next.estDays;
  }
  if (patch.due !== undefined) next.due = patch.due;
  if (next.start && (patch.start !== undefined || patch.durationDays !== undefined)) {
    const calendar = typeof cal === "boolean" ? workCalendarFrom({ showHolidays: cal }) : workCalendarFrom(cal);
    next.due = dueFromStartDuration(next.start, next.durationDays, calendar);
  }
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.assignee !== undefined || patch.resourceIds !== undefined) {
    const rid = patch.resourceIds?.[0];
    if (rid?.startsWith("jira:")) {
      next.assigneeAccountId = rid.slice(5);
    } else if (patch.resourceIds !== undefined) {
      next.assigneeAccountId = null;
      next.assigneeName = null;
    }
    if (patch.assignee !== undefined) next.assigneeName = patch.assignee;
  }
  return next;
}

export function countPlanItems(plan: JiraPlan): { epics: number; tasks: number } {
  let tasks = 0;
  for (const e of plan.epics) tasks += e.tasks.length;
  return { epics: plan.epics.length, tasks };
}
