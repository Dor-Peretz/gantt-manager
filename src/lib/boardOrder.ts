import type { GanttModel, Milestone } from "./types";

function reorderTasks(m: Milestone, order: string[] | undefined): Milestone {
  if (!order?.length) return m;
  const pos = new Map(order.map((id, i) => [id, i]));
  const tasks = m.tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = pos.has(a.t.id) ? (pos.get(a.t.id) as number) : Number.MAX_SAFE_INTEGER;
      const pb = pos.has(b.t.id) ? (pos.get(b.t.id) as number) : Number.MAX_SAFE_INTEGER;
      return pa - pb || a.i - b.i;
    })
    .map((x) => x.t);
  return { ...m, tasks };
}

/** Apply per-epic task order and top-level milestone order from saved preferences. */
export function applySavedBoardOrder(
  model: GanttModel,
  milestoneOrder: string[],
  taskOrder: Record<string, string[]>,
): GanttModel {
  const msById = new Map(model.milestones.map((m) => [m.id, m]));
  const orderedMs: Milestone[] = [];
  const seen = new Set<string>();

  const msOrder =
    milestoneOrder.length > 0 ? milestoneOrder : model.milestones.map((m) => m.id);

  for (const id of msOrder) {
    const m = msById.get(id);
    if (!m) continue;
    orderedMs.push(reorderTasks(m, taskOrder[id]));
    seen.add(id);
  }
  for (const m of model.milestones) {
    if (seen.has(m.id)) continue;
    orderedMs.push(reorderTasks(m, taskOrder[m.id]));
  }

  return { ...model, milestones: orderedMs };
}

/** Restore milestone + task order from the board state before a re-pull. */
export function applyModelOrder(model: GanttModel, previous: GanttModel): GanttModel {
  const prevMsOrder = previous.milestones.map((m) => m.id);
  const prevTaskOrder = new Map(
    previous.milestones.map((m) => [m.id, m.tasks.map((t) => t.id)]),
  );

  const msById = new Map(model.milestones.map((m) => [m.id, m]));
  const orderedMs: Milestone[] = [];
  const seen = new Set<string>();

  for (const id of prevMsOrder) {
    const m = msById.get(id);
    if (!m) continue;
    orderedMs.push(reorderTasks(m, prevTaskOrder.get(id)));
    seen.add(id);
  }
  for (const m of model.milestones) {
    if (seen.has(m.id)) continue;
    orderedMs.push(m);
  }

  return { ...model, milestones: orderedMs };
}
