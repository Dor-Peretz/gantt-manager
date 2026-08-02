import type { DraftTask, GanttModel, GanttTask } from "./types";

export function newDraftTaskId(): string {
  return `draft:task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function draftToTask(d: DraftTask): GanttTask {
  return {
    id: d.id,
    friendlyId: "NEW",
    title: d.title,
    owner: "—",
    start: d.start,
    due: d.due,
    durationDays: d.durationDays,
    estDays: null,
    resourceIds: [],
    pulledResourceIds: [],
    status: "To Do",
    pulledStatus: "To Do",
    pulledStart: null,
    pulledDue: null,
    pulledDurationDays: 1,
    transitionId: null,
    assignee: null,
    blockedBy: [],
    jiraUpdated: "",
    pendingCreate: true,
    createEpicId: d.epicId,
    scheduleDirty: true,
    dirty: true,
  };
}

export function collectDraftTasks(model: GanttModel): DraftTask[] {
  const out: DraftTask[] = [];
  for (const epic of model.milestones) {
    for (const t of epic.tasks) {
      if (!t.pendingCreate) continue;
      out.push({
        id: t.id,
        epicId: t.createEpicId || epic.id,
        title: t.title,
        start: t.start,
        due: t.due,
        durationDays: t.durationDays,
      });
    }
  }
  return out;
}

/** Re-attach draft tasks after a Jira Pull (they are not in Jira yet). */
export function injectDraftTasks(model: GanttModel, drafts: DraftTask[]): GanttModel {
  if (!drafts.length) return model;
  const byEpic = new Map<string, DraftTask[]>();
  for (const d of drafts) {
    const list = byEpic.get(d.epicId) || [];
    list.push(d);
    byEpic.set(d.epicId, list);
  }
  const epicIds = new Set(model.milestones.map((m) => m.id));
  const orphaned: DraftTask[] = [];
  for (const [epicId, list] of byEpic) {
    if (!epicIds.has(epicId)) orphaned.push(...list);
  }

  return {
    ...model,
    milestones: model.milestones.map((epic, index) => {
      const list = [...(byEpic.get(epic.id) || [])];
      if (index === 0 && orphaned.length) list.push(...orphaned);
      if (!list.length) return epic;
      const existingIds = new Set(epic.tasks.map((t) => t.id));
      const toAdd = list.filter((d) => !existingIds.has(d.id)).map(draftToTask);
      if (!toAdd.length) return epic;
      return { ...epic, tasks: [...epic.tasks, ...toAdd] };
    }),
  };
}
