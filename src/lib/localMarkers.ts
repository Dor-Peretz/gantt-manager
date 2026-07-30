import type { GanttModel, GanttTask, LocalMarker, Milestone } from "./types";

export function newLocalMarkerId(): string {
  return `local:ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function localMarkerToTask(m: LocalMarker): GanttTask {
  return {
    id: m.id,
    friendlyId: "MS",
    title: m.title,
    owner: "Local",
    start: m.start,
    due: m.start,
    durationDays: 1,
    estDays: null,
    resourceIds: [],
    status: "Local",
    pulledStatus: "Local",
    transitionId: null,
    assignee: null,
    blockedBy: [],
    jiraUpdated: "",
    isMarker: true,
    localOnly: true,
    dirty: false,
  };
}

export function localMarkerToMilestone(m: LocalMarker): Milestone {
  return {
    id: m.id,
    title: m.title,
    color: "#ef4444",
    collapsed: true,
    localOnly: true,
    // Self-task (same id) → rendered on the milestone row as a red star.
    tasks: [localMarkerToTask(m)],
  };
}

export function collectLocalMarkers(model: GanttModel): LocalMarker[] {
  const out: LocalMarker[] = [];
  const seen = new Set<string>();

  for (const epic of model.milestones) {
    if (epic.localOnly) {
      const t = epic.tasks.find((x) => x.id === epic.id) || epic.tasks[0];
      const start = t?.start || t?.due;
      if (!start || seen.has(epic.id)) continue;
      seen.add(epic.id);
      out.push({ id: epic.id, title: epic.title || t.title, start });
      continue;
    }
    // Migrate any legacy markers that were nested under epics.
    for (const t of epic.tasks) {
      if (!t.localOnly || !t.isMarker || seen.has(t.id)) continue;
      const start = t.start || t.due;
      if (!start) continue;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title, start });
    }
  }
  return out;
}

function orderMilestones(milestones: Milestone[], order: string[]): Milestone[] {
  if (!order.length) return milestones;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...milestones].sort((a, b) => {
    const pa = pos.has(a.id) ? (pos.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const pb = pos.has(b.id) ? (pos.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    // Keep Jira epics before brand-new locals when both are unordered.
    if (!!a.localOnly !== !!b.localOnly) return a.localOnly ? 1 : -1;
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
}

/** Re-attach local milestones as top-level rows (not nested under epics). */
export function injectLocalMarkers(
  model: GanttModel,
  markers: LocalMarker[],
  orderHint?: string[],
): GanttModel {
  // Strip nested legacy local tasks and any prior local-only rows.
  const jiraEpics = model.milestones
    .filter((m) => !m.localOnly)
    .map((m) => ({
      ...m,
      tasks: m.tasks.filter((t) => !t.localOnly),
    }));

  if (!markers.length) {
    return { ...model, milestones: jiraEpics };
  }

  const localRows = markers.map(localMarkerToMilestone);
  const byId = new Map<string, Milestone>();
  for (const m of jiraEpics) byId.set(m.id, m);
  for (const m of localRows) byId.set(m.id, m);

  const order =
    orderHint && orderHint.length
      ? orderHint
      : [...jiraEpics.map((m) => m.id), ...localRows.map((m) => m.id)];

  return {
    ...model,
    milestones: orderMilestones([...byId.values()], order),
  };
}
