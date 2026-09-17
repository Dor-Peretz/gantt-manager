/** Calendar math: working weekdays + optional IL / PL public holidays. */

import type { CustomNonWorkingDay } from "./types";

export interface Holiday {
  date: string;
  name: string;
}

/** JS `Date.getDay()`: 0 Sunday … 6 Saturday. Default Sun–Thu. */
export const DEFAULT_WORKING_WEEKDAYS = [0, 1, 2, 3, 4];

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface WorkCalendar {
  workingWeekdays: number[];
  israelHolidays: boolean;
  polishHolidays: boolean;
}

export const DEFAULT_WORK_CALENDAR: WorkCalendar = {
  workingWeekdays: [...DEFAULT_WORKING_WEEKDAYS],
  israelHolidays: true,
  polishHolidays: false,
};

export function normalizeWorkingWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORKING_WEEKDAYS];
  const days = [
    ...new Set(
      raw.filter(
        (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6,
      ),
    ),
  ].sort((a, b) => a - b);
  return days.length ? days : [...DEFAULT_WORKING_WEEKDAYS];
}

export function workCalendarFrom(input: {
  showHolidays?: boolean;
  showPolishHolidays?: boolean;
  workingWeekdays?: number[];
}): WorkCalendar {
  return {
    workingWeekdays: normalizeWorkingWeekdays(input.workingWeekdays),
    israelHolidays: input.showHolidays !== false,
    polishHolidays: input.showPolishHolidays === true,
  };
}

/**
 * Official Israeli public holidays (banks / most offices closed).
 * Sources: timeanddate.com / officeholidays.com — Hebrew calendar years 5786–5788.
 */
export const ISRAEL_HOLIDAYS: Holiday[] = [
  { date: "2026-04-02", name: "Passover (Day 1)" },
  { date: "2026-04-08", name: "Passover (Day 7)" },
  { date: "2026-04-22", name: "Independence Day" },
  { date: "2026-05-22", name: "Shavuot" },
  { date: "2026-09-12", name: "Rosh Hashana" },
  { date: "2026-09-13", name: "Rosh Hashana (Day 2)" },
  { date: "2026-09-21", name: "Yom Kippur" },
  { date: "2026-09-26", name: "Sukkot (Day 1)" },
  { date: "2026-10-03", name: "Shemini Atzeret / Simchat Torah" },
  { date: "2027-04-22", name: "Passover (Day 1)" },
  { date: "2027-04-28", name: "Passover (Day 7)" },
  { date: "2027-05-12", name: "Independence Day" },
  { date: "2027-06-11", name: "Shavuot" },
  { date: "2027-10-02", name: "Rosh Hashana" },
  { date: "2027-10-03", name: "Rosh Hashana (Day 2)" },
  { date: "2027-10-11", name: "Yom Kippur" },
  { date: "2027-10-16", name: "Sukkot (Day 1)" },
  { date: "2027-10-23", name: "Shemini Atzeret / Simchat Torah" },
];

/**
 * Official Polish public holidays (nationwide days off).
 * Movable dates: Easter Sunday/Monday, Pentecost, Corpus Christi.
 */
export const POLAND_HOLIDAYS: Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day (PL)" },
  { date: "2026-01-06", name: "Epiphany (PL)" },
  { date: "2026-04-05", name: "Easter Sunday (PL)" },
  { date: "2026-04-06", name: "Easter Monday (PL)" },
  { date: "2026-05-01", name: "Labour Day (PL)" },
  { date: "2026-05-03", name: "Constitution Day (PL)" },
  { date: "2026-05-24", name: "Pentecost (PL)" },
  { date: "2026-06-04", name: "Corpus Christi (PL)" },
  { date: "2026-08-15", name: "Assumption (PL)" },
  { date: "2026-11-01", name: "All Saints' Day (PL)" },
  { date: "2026-11-11", name: "Independence Day (PL)" },
  { date: "2026-12-25", name: "Christmas Day (PL)" },
  { date: "2026-12-26", name: "Second Day of Christmas (PL)" },
  { date: "2027-01-01", name: "New Year's Day (PL)" },
  { date: "2027-01-06", name: "Epiphany (PL)" },
  { date: "2027-03-28", name: "Easter Sunday (PL)" },
  { date: "2027-03-29", name: "Easter Monday (PL)" },
  { date: "2027-05-01", name: "Labour Day (PL)" },
  { date: "2027-05-03", name: "Constitution Day (PL)" },
  { date: "2027-05-16", name: "Pentecost (PL)" },
  { date: "2027-05-27", name: "Corpus Christi (PL)" },
  { date: "2027-08-15", name: "Assumption (PL)" },
  { date: "2027-11-01", name: "All Saints' Day (PL)" },
  { date: "2027-11-11", name: "Independence Day (PL)" },
  { date: "2027-12-25", name: "Christmas Day (PL)" },
  { date: "2027-12-26", name: "Second Day of Christmas (PL)" },
  { date: "2028-01-01", name: "New Year's Day (PL)" },
  { date: "2028-01-06", name: "Epiphany (PL)" },
  { date: "2028-04-16", name: "Easter Sunday (PL)" },
  { date: "2028-04-17", name: "Easter Monday (PL)" },
  { date: "2028-05-01", name: "Labour Day (PL)" },
  { date: "2028-05-03", name: "Constitution Day (PL)" },
  { date: "2028-06-04", name: "Pentecost (PL)" },
  { date: "2028-06-15", name: "Corpus Christi (PL)" },
  { date: "2028-08-15", name: "Assumption (PL)" },
  { date: "2028-11-01", name: "All Saints' Day (PL)" },
  { date: "2028-11-11", name: "Independence Day (PL)" },
  { date: "2028-12-25", name: "Christmas Day (PL)" },
  { date: "2028-12-26", name: "Second Day of Christmas (PL)" },
];

const HOLIDAY_BY_YMD: Record<string, string> = {};
for (const h of ISRAEL_HOLIDAYS) HOLIDAY_BY_YMD[h.date] = h.name;

const POLAND_HOLIDAY_BY_YMD: Record<string, string> = {};
for (const h of POLAND_HOLIDAYS) POLAND_HOLIDAY_BY_YMD[h.date] = h.name;

let CUSTOM_BY_YMD: Record<string, string> = {};

export function setCustomNonWorkingDays(days: CustomNonWorkingDay[]): void {
  CUSTOM_BY_YMD = {};
  for (const d of days) {
    CUSTOM_BY_YMD[d.date] = d.name?.trim() || "Off day";
  }
}

export function customOffDayName(d: Date): string | null {
  return CUSTOM_BY_YMD[formatYmd(d)] || null;
}

export function israelHolidayName(d: Date): string | null {
  return HOLIDAY_BY_YMD[formatYmd(d)] || null;
}

export function isCustomOffDay(d: Date): boolean {
  return !!customOffDayName(d);
}

export function isIsraelHoliday(d: Date): boolean {
  return !!israelHolidayName(d);
}

export function polishHolidayName(d: Date): string | null {
  return POLAND_HOLIDAY_BY_YMD[formatYmd(d)] || null;
}

export function isPolishHoliday(d: Date): boolean {
  return !!polishHolidayName(d);
}

export function parseYmd(s: string): Date {
  const p = String(s).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function isWeekend(d: Date, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): boolean {
  return !cal.workingWeekdays.includes(d.getDay());
}

export function holidayName(d: Date, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): string | null {
  return (
    customOffDayName(d) ||
    (cal.israelHolidays ? israelHolidayName(d) : null) ||
    (cal.polishHolidays ? polishHolidayName(d) : null)
  );
}

export function isHoliday(d: Date, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): boolean {
  return !!holidayName(d, cal);
}

export function isNonWorking(d: Date, cal: WorkCalendar): boolean {
  if (isWeekend(d, cal)) return true;
  if (isCustomOffDay(d)) return true;
  if (cal.israelHolidays && isIsraelHoliday(d)) return true;
  if (cal.polishHolidays && isPolishHoliday(d)) return true;
  return false;
}

export function firstWorkingDay(d: Date, cal: WorkCalendar): Date {
  let x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let guard = 0;
  while (isNonWorking(x, cal) && guard++ < 370) x = addDays(x, 1);
  return x;
}

/** Last calendar day of a task whose durationDays are working days. */
export function addWorkingDays(
  start: Date,
  workingDays: number,
  cal: WorkCalendar,
): Date {
  const n = Math.max(1, Number(workingDays) || 1);
  let cur = firstWorkingDay(start, cal);
  let counted = 1;
  while (counted < n) {
    cur = addDays(cur, 1);
    if (!isNonWorking(cur, cal)) counted++;
  }
  return cur;
}

export function workingDaysInclusive(
  start: Date,
  end: Date,
  cal: WorkCalendar,
): number {
  let a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (b < a) return 1;
  let n = 0;
  let guard = 0;
  while (a <= b && guard++ < 2000) {
    if (!isNonWorking(a, cal)) n++;
    a = addDays(a, 1);
  }
  return Math.max(1, n);
}

export function taskEnd(
  startYmd: string,
  durationDays: number,
  cal: WorkCalendar,
): Date {
  return addWorkingDays(parseYmd(startYmd), Math.max(1, durationDays || 1), cal);
}

export function dueFromStartDuration(
  startYmd: string | null,
  durationDays: number,
  cal: WorkCalendar,
): string | null {
  if (!startYmd) return null;
  return formatYmd(taskEnd(startYmd, durationDays, cal));
}

/** First calendar day of a task that ends on dueYmd after durationDays working days. */
export function startFromDueDuration(
  dueYmd: string | null,
  durationDays: number,
  cal: WorkCalendar,
): string | null {
  if (!dueYmd) return null;
  const n = Math.max(1, Number(durationDays) || 1);
  let cur = parseYmd(dueYmd);
  let guard = 0;
  while (isNonWorking(cur, cal) && guard++ < 370) cur = addDays(cur, -1);
  let counted = 1;
  while (counted < n && guard++ < 2000) {
    cur = addDays(cur, -1);
    if (!isNonWorking(cur, cal)) counted++;
  }
  return formatYmd(cur);
}

export function durationFromStartDue(
  startYmd: string | null,
  dueYmd: string | null,
  cal: WorkCalendar,
): number {
  if (!startYmd || !dueYmd) return 1;
  return workingDaysInclusive(parseYmd(startYmd), parseYmd(dueYmd), cal);
}

export function initialsFromName(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
