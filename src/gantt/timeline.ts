import type { GanttTask, Milestone, Sprint, SprintState } from "../lib/types";
import {
  addDays,
  daysBetween,
  formatYmd,
  holidayName,
  isWeekend,
  parseYmd,
  taskEnd,
  todayLocal,
  type WorkCalendar,
} from "../lib/workdays";

/** Timeline day column width (px) — zoom bounds. */
export const DAY_WIDTH_MIN = 12;
export const DAY_WIDTH_MAX = 56;
export const DAY_WIDTH_STEP = 4;

export function clampDayWidth(px: number): number {
  return Math.min(DAY_WIDTH_MAX, Math.max(DAY_WIDTH_MIN, Math.round(px)));
}

export interface DayCol {
  date: Date;
  ymd: string;
  dow: string;
  /** Day of month (1–31), shown above the weekday letter. */
  dom: number;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayLabel: string | null;
  monthLabel: string | null;
}

export interface HolidaySpan {
  ymd: string;
  /** Index of the first day column in the run. */
  index: number;
  days: number;
  label: string;
  title: string;
}

export interface SprintBand {
  id: string;
  name: string;
  state: SprintState;
  /** Index of the first day column the sprint covers. */
  index: number;
  days: number;
  /** Lane (0-based) — overlapping sprints from different boards stack. */
  lane: number;
  title: string;
  /** True when the sprint starts or ends outside the visible range. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface RowLayout {
  kind: "milestone" | "task";
  milestone: Milestone;
  task?: GanttTask;
  rowIndex: number;
  y: number;
  /** Synthetic bottom folder that collects hidden tasks. */
  isHiddenFolder?: boolean;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ROW_H = 40;
export const HEAD_H = 64;
/** Height of one sprint lane stacked on top of the day header. */
export const SPRINT_LANE_H = 18;
/** Keep the header usable when a JQL spans many boards with overlapping sprints. */
export const SPRINT_LANE_MAX = 3;
/** Reserved id for the synthetic Hidden folder row. */
export const HIDDEN_FOLDER_ID = "__hidden__";

/** Header height grows with each sprint lane so row positions stay aligned. */
export function headHeight(sprintLanes = 0): number {
  return HEAD_H + sprintLanes * SPRINT_LANE_H;
}

export function visibleTasks(milestones: Milestone[]): GanttTask[] {
  const out: GanttTask[] = [];
  for (const m of milestones) {
    if (!m.collapsed) out.push(...m.tasks.filter((t) => !t.hidden));
  }
  return out;
}

/** True when the task is the epic's own schedule (no child stories). */
export function isEpicSelfTask(milestoneId: string, task: GanttTask): boolean {
  return task.id === milestoneId;
}

export function buildRows(
  milestones: Milestone[],
  hiddenFolderCollapsed = true,
  headH: number = HEAD_H,
): RowLayout[] {
  const rows: RowLayout[] = [];
  const hidden: Array<{ milestone: Milestone; task: GanttTask }> = [];
  let i = 0;
  for (const m of milestones) {
    rows.push({ kind: "milestone", milestone: m, rowIndex: i, y: headH + i * ROW_H });
    i++;
    // Local milestones are a single top-level star row — never expand children.
    if (m.localOnly) continue;
    for (const t of m.tasks) {
      if (isEpicSelfTask(m.id, t)) continue;
      if (t.hidden) {
        hidden.push({ milestone: m, task: t });
        continue;
      }
      if (m.collapsed) continue;
      rows.push({ kind: "task", milestone: m, task: t, rowIndex: i, y: headH + i * ROW_H });
      i++;
    }
  }

  if (hidden.length) {
    const folder: Milestone = {
      id: HIDDEN_FOLDER_ID,
      title: `Hidden (${hidden.length})`,
      color: "#94A3B8",
      collapsed: hiddenFolderCollapsed,
      tasks: hidden.map((h) => h.task),
      localOnly: true,
    };
    rows.push({
      kind: "milestone",
      milestone: folder,
      rowIndex: i,
      y: headH + i * ROW_H,
      isHiddenFolder: true,
    });
    i++;
    if (!hiddenFolderCollapsed) {
      for (const { milestone, task } of hidden) {
        rows.push({
          kind: "task",
          milestone,
          task,
          rowIndex: i,
          y: headH + i * ROW_H,
          isHiddenFolder: true,
        });
        i++;
      }
    }
  }
  return rows;
}

export function rangeBounds(
  milestones: Milestone[],
  projectStart: string,
  cal: WorkCalendar,
): { start: Date; end: Date } {
  let min = parseYmd(projectStart);
  let max = addDays(min, 45);
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.start) continue;
      const s = parseYmd(t.start);
      const e = taskEnd(t.start, t.durationDays, cal);
      if (s < min) min = s;
      if (e > max) max = e;
    }
  }
  // pad
  min = addDays(min, -3);
  max = addDays(max, 14);
  return { start: min, end: max };
}

export function buildDays(start: Date, end: Date, cal: WorkCalendar): DayCol[] {
  const days: DayCol[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let lastMonth = -1;
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    const month = cur.getMonth();
    const holidayLabel = holidayName(cur, cal);
    days.push({
      date: new Date(cur),
      ymd: formatYmd(cur),
      dow: DOW[cur.getDay()],
      dom: cur.getDate(),
      isWeekend: isWeekend(cur, cal),
      isHoliday: !!holidayLabel,
      holidayLabel,
      monthLabel: month !== lastMonth ? `${MONTHS[month]} ${cur.getFullYear()}` : null,
    });
    lastMonth = month;
    cur = addDays(cur, 1);
  }
  return days;
}

/** Drops a "(Day 2)" style qualifier so a multi-day run reads as one holiday. */
function baseHolidayName(name: string): string {
  return name.replace(/\s*\(Day\s*\d+\)\s*$/i, "").trim() || name;
}

/** Back-to-back holiday days collapse into one header label so the name stays readable. */
export function buildHolidaySpans(days: DayCol[]): HolidaySpan[] {
  const spans: HolidaySpan[] = [];
  days.forEach((d, i) => {
    if (!d.isHoliday || !d.holidayLabel) return;
    const prev = spans[spans.length - 1];
    if (prev && prev.index + prev.days === i) {
      prev.days++;
      prev.label = baseHolidayName(prev.label);
      prev.title += ` · ${d.holidayLabel}`;
      return;
    }
    spans.push({
      ymd: d.ymd,
      index: i,
      days: 1,
      label: d.holidayLabel,
      title: d.holidayLabel,
    });
  });
  return spans;
}

/**
 * Clips each sprint to the visible days and packs overlapping ones into lanes, so a
 * board's sequential sprints share one lane while a second board stacks below it.
 */
export function buildSprintBands(days: DayCol[], sprints: Sprint[]): SprintBand[] {
  if (!days.length) return [];
  const firstYmd = days[0].ymd;
  const lastYmd = days[days.length - 1].ymd;
  const laneEnds: number[] = [];
  const bands: SprintBand[] = [];

  for (const sprint of sprints) {
    if (!sprint.start || !sprint.end || sprint.end < sprint.start) continue;
    if (sprint.end < firstYmd || sprint.start > lastYmd) continue;
    const clippedStart = sprint.start < firstYmd;
    const clippedEnd = sprint.end > lastYmd;
    const from = clippedStart ? 0 : dayIndex(days, sprint.start);
    const to = clippedEnd ? days.length - 1 : dayIndex(days, sprint.end);
    if (from < 0 || to < 0 || to < from) continue;

    let lane = laneEnds.findIndex((end) => end <= from);
    if (lane < 0) {
      if (laneEnds.length >= SPRINT_LANE_MAX) continue;
      lane = laneEnds.length;
    }
    laneEnds[lane] = to + 1;
    const window = `${sprint.start} → ${sprint.end}`;
    bands.push({
      id: sprint.id,
      name: sprint.name,
      state: sprint.state,
      index: from,
      days: to - from + 1,
      lane,
      title: `${sprint.name} · ${sprint.state} · ${window}`,
      clippedStart,
      clippedEnd,
    });
  }
  return bands;
}

/** Number of lanes the bands occupy — drives the header height. */
export function sprintLaneCount(bands: SprintBand[]): number {
  return bands.reduce((max, band) => Math.max(max, band.lane + 1), 0);
}

export function dayIndex(days: DayCol[], ymd: string): number {
  return days.findIndex((d) => d.ymd === ymd);
}

export function barGeometry(
  days: DayCol[],
  startYmd: string,
  durationDays: number,
  cal: WorkCalendar,
  dayWidth: number,
): { left: number; width: number } | null {
  const end = formatYmd(taskEnd(startYmd, durationDays, cal));
  const si = dayIndex(days, startYmd);
  const ei = dayIndex(days, end);
  if (si < 0 && ei < 0) return null;
  const leftIdx = si < 0 ? 0 : si;
  const rightIdx = ei < 0 ? days.length - 1 : ei;
  if (rightIdx < leftIdx) return null;
  return {
    left: leftIdx * dayWidth,
    width: Math.max(dayWidth, (rightIdx - leftIdx + 1) * dayWidth),
  };
}

export function milestoneSpan(
  milestone: Milestone,
  cal: WorkCalendar,
): { start: string; end: string } | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const t of milestone.tasks) {
    if (!t.start || t.hidden) continue;
    const s = parseYmd(t.start);
    const e = taskEnd(t.start, t.durationDays, cal);
    if (!min || s < min) min = s;
    if (!max || e > max) max = e;
  }
  if (!min || !max) return null;
  return { start: formatYmd(min), end: formatYmd(max) };
}

export function projectEndYmd(milestones: Milestone[], cal: WorkCalendar): string | null {
  let max: Date | null = null;
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.start) continue;
      const e = taskEnd(t.start, t.durationDays, cal);
      if (!max || e > max) max = e;
    }
  }
  return max ? formatYmd(max) : null;
}

export function markerLeft(days: DayCol[], ymd: string, dayWidth: number): number | null {
  const i = dayIndex(days, ymd);
  if (i < 0) {
    // clamp today into range edges
    if (!days.length) return null;
    if (ymd < days[0].ymd) return 0;
    if (ymd > days[days.length - 1].ymd) return days.length * dayWidth;
    return null;
  }
  return i * dayWidth + dayWidth / 2;
}

export function todayYmd(): string {
  return formatYmd(todayLocal());
}

export function shiftStartByPixels(
  startYmd: string,
  dx: number,
  dayWidth: number,
): string {
  const days = Math.round(dx / dayWidth);
  return formatYmd(addDays(parseYmd(startYmd), days));
}

export function durationDeltaFromPixels(dx: number, dayWidth: number): number {
  return Math.round(dx / dayWidth);
}

export function calendarSpanDays(startYmd: string, durationDays: number, cal: WorkCalendar): number {
  return daysBetween(parseYmd(startYmd), taskEnd(startYmd, durationDays, cal)) + 1;
}
