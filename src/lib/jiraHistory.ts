import type {
  GanttModel,
  GanttTask,
  HistoricalSchedule,
  HistoryFieldMap,
  IssueChangelog,
} from "./types";
import { parseStoryPoints, scheduleFromFields } from "./jiraSchedule";
import { formatYmd, parseYmd } from "./workdays";

function endOfLocalDay(ymd: string): Date {
  const d = parseYmd(ymd);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseChangelogDate(from: string | null, fromString: string | null): string | null {
  const raw = from || fromString;
  if (!raw || raw === "null") return null;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return formatYmd(d);
  return null;
}

function parseChangelogStoryPoints(from: string | null, fromString: string | null): number | null {
  const raw = from ?? fromString;
  if (raw == null || raw === "" || raw === "null") return null;
  return parseStoryPoints(raw);
}

function fieldMatchesStart(fieldId: string, field: string, startDateId: string): boolean {
  if (fieldId === startDateId) return true;
  const name = field.toLowerCase();
  return name === "start date" || name.includes("start date");
}

function fieldMatchesStoryPoints(
  fieldId: string,
  field: string,
  storyPointsId: string,
): boolean {
  if (fieldId === storyPointsId) return true;
  const name = field.toLowerCase();
  return (
    name === "story points" ||
    name === "story point estimate" ||
    name === "storypoint" ||
    name.includes("story point")
  );
}

/** Rewind a task's schedule fields to the end of `asOfYmd` using its Jira changelog. */
export function rewindTaskSchedule(
  task: GanttTask,
  changelog: IssueChangelog | undefined,
  asOfYmd: string,
  fieldMap: HistoryFieldMap,
  holidaysOn: boolean,
): HistoricalSchedule | null {
  if (task.localOnly || task.pendingCreate) return null;

  if (!changelog) {
    const schedule = scheduleFromFields(task.start, task.due, task.estDays, holidaysOn);
    return {
      start: schedule.start,
      due: schedule.due,
      durationDays: schedule.durationDays,
      estDays: schedule.estDays,
      status: task.status,
      assignee: task.assignee,
    };
  }

  const asOfEnd = endOfLocalDay(asOfYmd);
  const createdAt = new Date(changelog.created);
  if (!Number.isNaN(createdAt.getTime()) && createdAt > asOfEnd) {
    return null;
  }

  let start = task.start;
  let due = task.due;
  let estDays = task.estDays;
  let status = task.status;
  let assignee = task.assignee;

  const histories = [...changelog.histories]
    .filter((h) => {
      const at = new Date(h.created);
      return !Number.isNaN(at.getTime()) && at > asOfEnd;
    })
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  for (const history of histories) {
    for (const item of history.items) {
      const fieldId = item.fieldId || "";
      const field = item.field || "";

      if (fieldMatchesStart(fieldId, field, fieldMap.startDate)) {
        start = parseChangelogDate(item.from, item.fromString);
        continue;
      }
      if (fieldId === "duedate" || field.toLowerCase() === "duedate" || field === "Due date") {
        due = parseChangelogDate(item.from, item.fromString);
        continue;
      }
      if (fieldMatchesStoryPoints(fieldId, field, fieldMap.storyPoints)) {
        estDays = parseChangelogStoryPoints(item.from, item.fromString);
        continue;
      }
      if (field.toLowerCase() === "status") {
        status = item.fromString || item.from || status;
        continue;
      }
      if (field.toLowerCase() === "assignee") {
        assignee = item.fromString || item.from || null;
        if (!item.from && !item.fromString) assignee = null;
      }
    }
  }

  const schedule = scheduleFromFields(start, due, estDays, holidaysOn);

  return {
    start: schedule.start,
    due: schedule.due,
    durationDays: schedule.durationDays,
    estDays: schedule.estDays,
    status,
    assignee,
  };
}

export function historicalScheduleDiffers(
  historical: HistoricalSchedule,
  task: GanttTask,
): boolean {
  return (
    historical.start !== task.start ||
    historical.due !== task.due ||
    historical.durationDays !== task.durationDays
  );
}

export function buildHistoryOverlay(
  tasks: GanttTask[],
  changelogs: Map<string, IssueChangelog>,
  asOfYmd: string,
  fieldMap: HistoryFieldMap,
  holidaysOn: boolean,
): Map<string, HistoricalSchedule | null> {
  const overlay = new Map<string, HistoricalSchedule | null>();
  for (const task of tasks) {
    overlay.set(
      task.id,
      rewindTaskSchedule(task, changelogs.get(task.id), asOfYmd, fieldMap, holidaysOn),
    );
  }
  return overlay;
}

function taskExistedAt(
  task: GanttTask,
  changelogs: Map<string, IssueChangelog>,
  asOfYmd: string,
): boolean {
  if (task.localOnly || task.pendingCreate) return true;
  const cl = changelogs.get(task.id);
  if (!cl) return true;
  const createdAt = new Date(cl.created);
  if (Number.isNaN(createdAt.getTime())) return true;
  return createdAt <= endOfLocalDay(asOfYmd);
}

function resourceIdsForAssignee(model: GanttModel, assignee: string | null): string[] {
  if (!assignee?.trim()) return [];
  const names = assignee.split(",").map((s) => s.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const name of names) {
    const resource = model.resources.find((r) => r.name === name);
    if (resource) ids.push(resource.id);
  }
  return ids;
}

/** Replace task schedules with historical values; hide tickets not yet created. */
export function applyHistoryToModel(
  model: GanttModel,
  overlay: Map<string, HistoricalSchedule | null>,
  changelogs: Map<string, IssueChangelog>,
  asOfYmd: string,
): GanttModel {
  return {
    ...model,
    milestones: model.milestones
      .map((m) => ({
        ...m,
        tasks: m.tasks
          .filter((t) => taskExistedAt(t, changelogs, asOfYmd))
          .map((t) => {
            if (t.localOnly || t.pendingCreate) return t;
            const hist = overlay.get(t.id);
            if (!hist) {
              if (!changelogs.has(t.id)) {
                return {
                  ...t,
                  dirty: false,
                  scheduleDirty: false,
                  statusDirty: false,
                  assigneeDirty: false,
                };
              }
              return {
                ...t,
                start: null,
                due: null,
                durationDays: 1,
                estDays: null,
                dirty: false,
                scheduleDirty: false,
                statusDirty: false,
                assigneeDirty: false,
              };
            }
            const resourceIds = resourceIdsForAssignee(model, hist.assignee);
            return {
              ...t,
              start: hist.start,
              due: hist.due,
              durationDays: hist.durationDays,
              estDays: hist.estDays,
              status: hist.status,
              assignee: hist.assignee,
              resourceIds,
              dirty: false,
              scheduleDirty: false,
              statusDirty: false,
              assigneeDirty: false,
            };
          }),
      }))
      .filter((m) => m.localOnly || m.tasks.length > 0),
  };
}

export function countHistoryStats(
  model: GanttModel,
  overlay: Map<string, HistoricalSchedule | null>,
  changelogs: Map<string, IssueChangelog>,
  asOfYmd: string,
): { moved: number; notCreated: number; scheduled: number } {
  let moved = 0;
  let notCreated = 0;
  let scheduled = 0;
  for (const m of model.milestones) {
    for (const t of m.tasks) {
      if (t.localOnly || t.pendingCreate) continue;
      if (!taskExistedAt(t, changelogs, asOfYmd)) {
        notCreated++;
        continue;
      }
      const hist = overlay.get(t.id);
      if (hist) {
        scheduled++;
        if (historicalScheduleDiffers(hist, t)) moved++;
      }
    }
  }
  return { moved, notCreated, scheduled };
}
