import type { GanttTask, Milestone } from "../lib/types";
import {
  addDays,
  daysBetween,
  formatYmd,
  holidayName,
  isHoliday,
  isWeekend,
  parseYmd,
  taskEnd,
  todayLocal,
} from "../lib/workdays";

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

export interface RowLayout {
  kind: "milestone" | "task";
  milestone: Milestone;
  task?: GanttTask;
  rowIndex: number;
  y: number;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ROW_H = 40;
export const HEAD_H = 64;

export function visibleTasks(milestones: Milestone[]): GanttTask[] {
  const out: GanttTask[] = [];
  for (const m of milestones) {
    if (!m.collapsed) out.push(...m.tasks);
  }
  return out;
}

/** True when the task is the epic's own schedule (no child stories). */
export function isEpicSelfTask(milestoneId: string, task: GanttTask): boolean {
  return task.id === milestoneId;
}

export function buildRows(milestones: Milestone[]): RowLayout[] {
  const rows: RowLayout[] = [];
  let i = 0;
  for (const m of milestones) {
    rows.push({ kind: "milestone", milestone: m, rowIndex: i, y: HEAD_H + i * ROW_H });
    i++;
    // Local milestones are a single top-level star row — never expand children.
    if (m.localOnly) continue;
    if (!m.collapsed) {
      for (const t of m.tasks) {
        // Epic self-schedule is shown on the milestone row, not nested under it.
        if (isEpicSelfTask(m.id, t)) continue;
        rows.push({ kind: "task", milestone: m, task: t, rowIndex: i, y: HEAD_H + i * ROW_H });
        i++;
      }
    }
  }
  return rows;
}

export function rangeBounds(
  milestones: Milestone[],
  projectStart: string,
  holidaysOn: boolean,
): { start: Date; end: Date } {
  let min = parseYmd(projectStart);
  let max = addDays(min, 45);
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.start) continue;
      const s = parseYmd(t.start);
      const e = taskEnd(t.start, t.durationDays, holidaysOn);
      if (s < min) min = s;
      if (e > max) max = e;
    }
  }
  // pad
  min = addDays(min, -3);
  max = addDays(max, 14);
  return { start: min, end: max };
}

export function buildDays(start: Date, end: Date, holidaysOn: boolean): DayCol[] {
  const days: DayCol[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let lastMonth = -1;
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    const month = cur.getMonth();
    days.push({
      date: new Date(cur),
      ymd: formatYmd(cur),
      dow: DOW[cur.getDay()],
      dom: cur.getDate(),
      isWeekend: isWeekend(cur),
      isHoliday: holidaysOn && isHoliday(cur),
      holidayLabel: holidaysOn ? holidayName(cur) : null,
      monthLabel: month !== lastMonth ? `${MONTHS[month]} ${cur.getFullYear()}` : null,
    });
    lastMonth = month;
    cur = addDays(cur, 1);
  }
  return days;
}

export function dayIndex(days: DayCol[], ymd: string): number {
  return days.findIndex((d) => d.ymd === ymd);
}

export function barGeometry(
  days: DayCol[],
  startYmd: string,
  durationDays: number,
  holidaysOn: boolean,
  dayWidth: number,
): { left: number; width: number } | null {
  const end = formatYmd(taskEnd(startYmd, durationDays, holidaysOn));
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
  holidaysOn: boolean,
): { start: string; end: string } | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const t of milestone.tasks) {
    if (!t.start) continue;
    const s = parseYmd(t.start);
    const e = taskEnd(t.start, t.durationDays, holidaysOn);
    if (!min || s < min) min = s;
    if (!max || e > max) max = e;
  }
  if (!min || !max) return null;
  return { start: formatYmd(min), end: formatYmd(max) };
}

export function projectEndYmd(milestones: Milestone[], holidaysOn: boolean): string | null {
  let max: Date | null = null;
  for (const m of milestones) {
    for (const t of m.tasks) {
      if (!t.start) continue;
      const e = taskEnd(t.start, t.durationDays, holidaysOn);
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

export function calendarSpanDays(startYmd: string, durationDays: number, holidaysOn: boolean): number {
  return daysBetween(parseYmd(startYmd), taskEnd(startYmd, durationDays, holidaysOn)) + 1;
}
