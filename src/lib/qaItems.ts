import type {
  GanttModel,
  GanttTask,
  Milestone,
  PendingQaDelete,
  QaItem,
  QaKind,
} from "./types";
import { QA_COLORS } from "./types";
import { dueFromStartDuration } from "./workdays";

export function newQaItemId(): string {
  return `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isQaMilestone(m: Milestone): boolean {
  return !!m.localOnly && !!m.qaKind;
}

export function isLocalMilestoneRow(m: Milestone): boolean {
  return !!m.localOnly && !m.qaKind;
}

export interface QaPropertyPayload {
  v: 1;
  items: QaItem[];
}

export function parseQaProperty(raw: unknown): QaItem[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as QaPropertyPayload;
  if (!Array.isArray(payload.items)) return [];
  const out: QaItem[] = [];
  for (const item of payload.items) {
    if (!item?.id || !item.kind || !item.title || !item.start) continue;
    if (!Array.isArray(item.linkedIssueKeys) || !item.linkedIssueKeys.length) continue;
    out.push({
      id: String(item.id),
      kind: item.kind === "e2e" ? "e2e" : "integration",
      title: String(item.title),
      start: String(item.start),
      durationDays: Math.max(1, Number(item.durationDays) || 1),
      linkedIssueKeys: item.linkedIssueKeys.map(String),
    });
  }
  return out;
}

export function dedupeQaItems(items: QaItem[]): QaItem[] {
  const byId = new Map<string, QaItem>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

/** Union assignees from linked Jira tasks already on the model. */
export function deriveAssigneesFromLinked(
  model: GanttModel,
  linkedKeys: string[],
): { resourceIds: string[]; assignee: string | null } {
  const keySet = new Set(linkedKeys);
  const resourceIds: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of model.milestones) {
    if (isQaMilestone(m)) continue;
    for (const t of m.tasks) {
      if (!keySet.has(t.id)) continue;
      for (const rid of t.resourceIds) {
        if (seen.has(rid)) continue;
        seen.add(rid);
        resourceIds.push(rid);
        if (t.assignee) names.push(t.assignee);
      }
    }
  }
  return { resourceIds, assignee: names.length ? names.join(", ") : null };
}

export function qaItemToTask(
  item: QaItem,
  model: GanttModel,
  holidaysOn: boolean,
  opts?: {
    dirty?: boolean;
    pulledLinkedIssueKeys?: string[];
    pulledStart?: string | null;
    pulledDue?: string | null;
    pulledDurationDays?: number;
  },
): GanttTask {
  const durationDays = Math.max(1, item.durationDays || 1);
  const due = dueFromStartDuration(item.start, durationDays, holidaysOn);
  const { resourceIds, assignee } = deriveAssigneesFromLinked(model, item.linkedIssueKeys);
  const dirty = opts?.dirty ?? false;
  const pulledLinkedIssueKeys =
    opts?.pulledLinkedIssueKeys !== undefined
      ? [...opts.pulledLinkedIssueKeys]
      : dirty
        ? undefined
        : [...item.linkedIssueKeys];
  return {
    id: item.id,
    friendlyId: item.kind === "e2e" ? "E2E" : "IT",
    title: item.title,
    owner: "QA",
    start: item.start,
    due,
    durationDays,
    estDays: null,
    resourceIds,
    status: "QA",
    pulledStatus: "QA",
    pulledStart: dirty ? opts?.pulledStart : item.start,
    pulledDue: dirty ? opts?.pulledDue : due,
    pulledDurationDays: dirty ? opts?.pulledDurationDays : durationDays,
    transitionId: null,
    assignee,
    blockedBy: [],
    jiraUpdated: "",
    localOnly: true,
    qaKind: item.kind,
    linkedIssueKeys: [...item.linkedIssueKeys],
    pulledLinkedIssueKeys,
    dirty,
  };
}

export function qaItemToMilestone(
  item: QaItem,
  model: GanttModel,
  holidaysOn: boolean,
  opts?: {
    dirty?: boolean;
    pulledLinkedIssueKeys?: string[];
    pulledStart?: string | null;
    pulledDue?: string | null;
    pulledDurationDays?: number;
  },
): Milestone {
  return {
    id: item.id,
    title: item.title,
    color: QA_COLORS[item.kind],
    collapsed: true,
    localOnly: true,
    qaKind: item.kind,
    tasks: [qaItemToTask(item, model, holidaysOn, opts)],
  };
}

export function collectQaItems(model: GanttModel): QaItem[] {
  const out: QaItem[] = [];
  for (const m of model.milestones) {
    if (!isQaMilestone(m)) continue;
    const t = m.tasks.find((x) => x.id === m.id) || m.tasks[0];
    if (!t?.start || !t.qaKind || !t.linkedIssueKeys?.length) continue;
    out.push({
      id: m.id,
      kind: t.qaKind,
      title: m.title || t.title,
      start: t.start,
      durationDays: Math.max(1, t.durationDays || 1),
      linkedIssueKeys: [...t.linkedIssueKeys],
    });
  }
  return out;
}

export interface DirtyQaItem extends QaItem {
  previousLinkedKeys: string[];
}

export function collectDirtyQaItems(model: GanttModel): DirtyQaItem[] {
  const out: DirtyQaItem[] = [];
  for (const m of model.milestones) {
    if (!isQaMilestone(m)) continue;
    const t = m.tasks.find((x) => x.id === m.id) || m.tasks[0];
    if (!t?.dirty || !t.qaKind || !t.start || !t.linkedIssueKeys?.length) continue;
    out.push({
      id: m.id,
      kind: t.qaKind,
      title: m.title || t.title,
      start: t.start,
      durationDays: Math.max(1, t.durationDays || 1),
      linkedIssueKeys: [...t.linkedIssueKeys],
      previousLinkedKeys: [...(t.pulledLinkedIssueKeys ?? [])],
    });
  }
  return out;
}

function toQaItem(item: DirtyQaItem): QaItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    start: item.start,
    durationDays: item.durationDays,
    linkedIssueKeys: item.linkedIssueKeys,
  };
}

/** Keep unpushed QA rows from the previous model when a fresh Pull arrives. */
export function mergeDirtyQaItems(fresh: GanttModel, previous: GanttModel): GanttModel {
  const dirty = collectDirtyQaItems(previous);
  if (!dirty.length) return fresh;

  const dirtyIds = new Set(dirty.map((item) => item.id));
  const freshQa = collectQaItems(fresh).filter((item) => !dirtyIds.has(item.id));
  const mergedItems = dedupeQaItems([...freshQa, ...dirty.map(toQaItem)]);

  const withoutQa = fresh.milestones.filter((m) => !isQaMilestone(m));
  let next = injectQaItems(
    { ...fresh, milestones: withoutQa },
    mergedItems,
    previous.milestones.map((m) => m.id),
  );

  const prevById = new Map(
    previous.milestones
      .filter((m) => isQaMilestone(m) && dirtyIds.has(m.id))
      .map((m) => [m.id, m.tasks.find((t) => t.id === m.id) || m.tasks[0]] as const),
  );
  next = {
    ...next,
    milestones: next.milestones.map((m) => {
      if (!isQaMilestone(m) || !dirtyIds.has(m.id)) return m;
      const prevTask = prevById.get(m.id);
      if (!prevTask) return m;
      return {
        ...m,
        tasks: m.tasks.map((t) =>
          t.id === m.id
            ? {
                ...t,
                dirty: true,
                pulledLinkedIssueKeys: prevTask.pulledLinkedIssueKeys
                  ? [...prevTask.pulledLinkedIssueKeys]
                  : undefined,
              }
            : t,
        ),
      };
    }),
  };
  return refreshQaAssignees(next);
}

function orderMilestones(milestones: Milestone[], order: string[]): Milestone[] {
  if (!order.length) return milestones;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...milestones].sort((a, b) => {
    const pa = pos.has(a.id) ? (pos.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const pb = pos.has(b.id) ? (pos.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    if (!!a.localOnly !== !!b.localOnly) return a.localOnly ? 1 : -1;
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
}

/** Attach QA rows as top-level milestones (not nested under epics). */
export function injectQaItems(
  model: GanttModel,
  items: QaItem[],
  orderHint?: string[],
): GanttModel {
  const holidaysOn = model.showHolidays !== false;
  const jiraEpics = model.milestones.filter((m) => !m.localOnly);
  const localMarkers = model.milestones.filter((m) => isLocalMilestoneRow(m));

  if (!items.length) {
    return { ...model, milestones: [...localMarkers, ...jiraEpics] };
  }

  const qaRows = items.map((item) => qaItemToMilestone(item, model, holidaysOn));
  const byId = new Map<string, Milestone>();
  for (const m of [...localMarkers, ...jiraEpics, ...qaRows]) byId.set(m.id, m);

  const order =
    orderHint && orderHint.length
      ? orderHint
      : [
          ...jiraEpics.map((m) => m.id),
          ...localMarkers.map((m) => m.id),
          ...qaRows.map((m) => m.id),
        ];

  return {
    ...model,
    milestones: orderMilestones([...byId.values()], order),
  };
}

/** Keep only QA items with at least one linked task visible on the board. */
export function filterQaItemsForBoard(model: GanttModel, items: QaItem[]): QaItem[] {
  const keys = new Set<string>();
  for (const m of model.milestones) {
    if (m.localOnly) continue;
    for (const t of m.tasks) keys.add(t.id);
  }
  return items.filter((item) => item.linkedIssueKeys.some((k) => keys.has(k)));
}

/** Refresh derived assignees on all QA rows after pull or linked-task changes. */
export function refreshQaAssignees(model: GanttModel): GanttModel {
  return {
    ...model,
    milestones: model.milestones.map((m) => {
      if (!isQaMilestone(m)) return m;
      const t = m.tasks.find((x) => x.id === m.id) || m.tasks[0];
      if (!t?.linkedIssueKeys?.length) return m;
      const { resourceIds, assignee } = deriveAssigneesFromLinked(model, t.linkedIssueKeys);
      const task: GanttTask = { ...t, resourceIds, assignee };
      return { ...m, tasks: [task] };
    }),
  };
}

export function qaKindLabel(kind: QaKind): string {
  return kind === "e2e" ? "E2E flow" : "Integration test";
}

export function qaKindIcon(kind: QaKind): string {
  return kind === "e2e" ? "➜" : "⊞";
}

/** Drop unpushed QA edits/creates and restore queued deletes. */
export function revertUnpushedQa(
  model: GanttModel,
  pendingDeletes: PendingQaDelete[],
): GanttModel {
  const holidaysOn = model.showHolidays !== false;
  const kept: Milestone[] = [];
  for (const m of model.milestones) {
    if (!isQaMilestone(m)) {
      kept.push(m);
      continue;
    }
    const t = m.tasks.find((x) => x.id === m.id) || m.tasks[0];
    if (!t?.dirty) {
      kept.push(m);
      continue;
    }
    if (!t.pulledLinkedIssueKeys?.length || !t.qaKind) continue;
    const start = t.pulledStart || t.start;
    if (!start) continue;
    kept.push(
      qaItemToMilestone(
        {
          id: m.id,
          kind: t.qaKind,
          title: m.title || t.title,
          start,
          durationDays: t.pulledDurationDays ?? t.durationDays ?? 1,
          linkedIssueKeys: [...t.pulledLinkedIssueKeys],
        },
        model,
        holidaysOn,
      ),
    );
  }

  let next: GanttModel = { ...model, milestones: kept };
  const restored: QaItem[] = [];
  for (const del of pendingDeletes) {
    if (!del.kind || !del.title || !del.start || !del.linkedIssueKeys.length) continue;
    restored.push({
      id: del.id,
      kind: del.kind,
      title: del.title,
      start: del.start,
      durationDays: Math.max(1, del.durationDays || 1),
      linkedIssueKeys: [...del.linkedIssueKeys],
    });
  }
  if (restored.length) {
    const byId = new Map(collectQaItems(next).map((item) => [item.id, item]));
    for (const item of restored) byId.set(item.id, item);
    next = injectQaItems(
      next,
      [...byId.values()],
      next.milestones.map((m) => m.id),
    );
  }
  return refreshQaAssignees(next);
}
