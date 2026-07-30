/** Non-working days: Friday + Saturday (Sun–Thu work week). */

export interface Holiday {
  date: string;
  name: string;
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

const HOLIDAY_BY_YMD: Record<string, string> = {};
for (const h of ISRAEL_HOLIDAYS) HOLIDAY_BY_YMD[h.date] = h.name;

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

export function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 5 || w === 6;
}

export function holidayName(d: Date): string | null {
  return HOLIDAY_BY_YMD[formatYmd(d)] || null;
}

export function isHoliday(d: Date): boolean {
  return !!holidayName(d);
}

export function isNonWorking(d: Date, holidaysOn: boolean): boolean {
  if (isWeekend(d)) return true;
  if (holidaysOn && isHoliday(d)) return true;
  return false;
}

export function firstWorkingDay(d: Date, holidaysOn: boolean): Date {
  let x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let guard = 0;
  while (isNonWorking(x, holidaysOn) && guard++ < 370) x = addDays(x, 1);
  return x;
}

/** Last calendar day of a task whose durationDays are working days. */
export function addWorkingDays(
  start: Date,
  workingDays: number,
  holidaysOn: boolean,
): Date {
  const n = Math.max(1, Number(workingDays) || 1);
  let cur = firstWorkingDay(start, holidaysOn);
  let counted = 1;
  while (counted < n) {
    cur = addDays(cur, 1);
    if (!isNonWorking(cur, holidaysOn)) counted++;
  }
  return cur;
}

export function workingDaysInclusive(
  start: Date,
  end: Date,
  holidaysOn: boolean,
): number {
  let a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (b < a) return 1;
  let n = 0;
  let guard = 0;
  while (a <= b && guard++ < 2000) {
    if (!isNonWorking(a, holidaysOn)) n++;
    a = addDays(a, 1);
  }
  return Math.max(1, n);
}

export function taskEnd(
  startYmd: string,
  durationDays: number,
  holidaysOn: boolean,
): Date {
  return addWorkingDays(parseYmd(startYmd), Math.max(1, durationDays || 1), holidaysOn);
}

export function dueFromStartDuration(
  startYmd: string | null,
  durationDays: number,
  holidaysOn: boolean,
): string | null {
  if (!startYmd) return null;
  return formatYmd(taskEnd(startYmd, durationDays, holidaysOn));
}

export function durationFromStartDue(
  startYmd: string | null,
  dueYmd: string | null,
  holidaysOn: boolean,
): number {
  if (!startYmd || !dueYmd) return 1;
  return workingDaysInclusive(parseYmd(startYmd), parseYmd(dueYmd), holidaysOn);
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
