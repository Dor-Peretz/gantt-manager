import type { ColumnWidths } from "../lib/types";

/** Resizable columns to the right of Name, in render order. */
export const COLUMN_KEYS = ["start", "dur", "status", "res"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  start: "Start",
  dur: "Dur",
  status: "Status",
  res: "Res",
};

export const COLUMN_MIN: Record<ColumnKey, number> = {
  start: 66,
  dur: 46,
  status: 60,
  res: 46,
};
export const COLUMN_MAX = 260;

/** The "#" column is never resizable. */
export const NUM_COL_W = 48;
/** Name never goes below this — it is the last column allowed to shrink. */
export const NAME_MIN_W = 120;

const MIN_OTHER = COLUMN_KEYS.reduce((total, key) => total + COLUMN_MIN[key], 0);

/** Smallest left panel that still fits every column at its minimum. */
export const LEFT_PANEL_MIN = NUM_COL_W + MIN_OTHER + NAME_MIN_W;

function sumOther(widths: ColumnWidths): number {
  return COLUMN_KEYS.reduce((total, key) => total + widths[key], 0);
}

/** Shrink the non-name columns toward `budget`, proportionally, never past their minimums. */
function shrinkToBudget(widths: ColumnWidths, budget: number): ColumnWidths {
  const out = { ...widths };
  const pinned = new Set<ColumnKey>();
  for (let pass = 0; pass < COLUMN_KEYS.length; pass++) {
    const flexible = COLUMN_KEYS.filter((key) => !pinned.has(key));
    if (!flexible.length) break;
    const pinnedWidth = COLUMN_KEYS.filter((key) => pinned.has(key)).reduce(
      (total, key) => total + COLUMN_MIN[key],
      0,
    );
    const flexibleRaw = flexible.reduce((total, key) => total + widths[key], 0);
    if (flexibleRaw <= 0) break;
    const scale = Math.max(0, budget - pinnedWidth) / flexibleRaw;
    let pinnedAny = false;
    for (const key of flexible) {
      const next = Math.round(widths[key] * scale);
      if (next <= COLUMN_MIN[key]) {
        out[key] = COLUMN_MIN[key];
        pinned.add(key);
        pinnedAny = true;
      } else {
        out[key] = next;
      }
    }
    if (!pinnedAny) break;
  }
  return out;
}

/**
 * Lay out the fixed left columns for a given panel width. Name is the priority
 * column: it absorbs any surplus, and when the panel gets tight the other
 * columns shrink to their minimums first, so Name is the last to lose room.
 */
export function fitColumns(
  widths: ColumnWidths,
  leftPanelWidth: number,
): { columns: ColumnWidths; nameW: number } {
  const available = Math.max(0, leftPanelWidth - NUM_COL_W);
  const otherRaw = sumOther(widths);
  const nameRaw = Math.max(NAME_MIN_W, widths.name);
  if (available >= otherRaw + nameRaw) {
    return { columns: { ...widths }, nameW: available - otherRaw };
  }
  const budget = Math.min(otherRaw, Math.max(MIN_OTHER, available - nameRaw));
  const columns = shrinkToBudget(widths, budget);
  return { columns, nameW: Math.max(NAME_MIN_W, available - sumOther(columns)) };
}

/** Widest a column may be dragged before it would eat into Name's minimum. */
export function maxColumnWidth(key: ColumnKey, columns: ColumnWidths, nameW: number): number {
  const headroom = Math.max(0, nameW - NAME_MIN_W);
  return Math.max(COLUMN_MIN[key], Math.min(COLUMN_MAX, columns[key] + headroom));
}

/** Widest Name may be dragged before the other columns would drop below their minimums. */
export function maxNameWidth(leftPanelWidth: number): number {
  return Math.max(NAME_MIN_W, leftPanelWidth - NUM_COL_W - MIN_OTHER);
}
