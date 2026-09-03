import {
  dueFromStartDuration,
  durationFromStartDue,
  startFromDueDuration,
} from "./workdays";

export function parseStoryPoints(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Resolve start/due/duration from Jira dates + Story Points.
 * Story Points are the app's Dur estimate whenever present (1 SP ≈ 1 working day).
 */
export function scheduleFromFields(
  start: string | null,
  due: string | null,
  sp: number | null,
  holidaysOn: boolean,
): { start: string | null; due: string | null; durationDays: number; estDays: number | null } {
  const estDays = sp != null && Number.isFinite(sp) && sp > 0 ? sp : null;
  const estDur = estDays != null ? Math.max(1, Math.round(estDays)) : null;

  if (estDur != null) {
    if (start) {
      return {
        start,
        due: dueFromStartDuration(start, estDur, holidaysOn),
        durationDays: estDur,
        estDays,
      };
    }
    if (due) {
      return {
        start: startFromDueDuration(due, estDur, holidaysOn),
        due,
        durationDays: estDur,
        estDays,
      };
    }
    return { start: null, due: null, durationDays: estDur, estDays };
  }

  if (start && due) {
    return {
      start,
      due,
      durationDays: durationFromStartDue(start, due, holidaysOn),
      estDays: null,
    };
  }
  if (start) return { start, due, durationDays: 1, estDays: null };
  if (due) return { start: null, due, durationDays: 1, estDays: null };
  return { start: null, due: null, durationDays: 1, estDays: null };
}
