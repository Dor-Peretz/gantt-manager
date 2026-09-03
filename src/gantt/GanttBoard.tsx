import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ScrollState } from "../api";
import type { GanttModel, GanttTask, HistoricalSchedule, HistoryViewMode } from "../lib/types";
import { isLocalMilestoneRow, isQaMilestone, qaKindIcon, qaKindLabel } from "../lib/qaItems";
import { historicalScheduleDiffers } from "../lib/jiraHistory";
import {
  DEFAULT_COLUMN_WIDTHS,
  UNASSIGNED_COLOR,
  normalizeColumnWidths,
} from "../lib/types";
import {
  dueFromStartDuration,
  firstWorkingDay,
  formatYmd,
  parseYmd,
  todayLocal,
} from "../lib/workdays";
import { AddTimelineMenu, type DeletableTimelineItem } from "./AddTimelineMenu";
import { AssignMenu } from "./AssignMenu";
import { EpicColorPicker } from "./EpicColorPicker";
import { ResourceAvatar } from "./ResourceAvatar";
import { ResourcesPane } from "./ResourcesPane";
import { StatusSelect } from "./StatusSelect";
import {
  DAY_WIDTH_MAX,
  DAY_WIDTH_MIN,
  DAY_WIDTH_STEP,
  ROW_H,
  barGeometry,
  buildDays,
  buildRows,
  clampDayWidth,
  isEpicSelfTask,
  markerLeft,
  milestoneSpan,
  projectEndYmd,
  rangeBounds,
  todayYmd,
} from "./timeline";
import { useDragResize } from "./useDragResize";
import {
  COLUMN_KEYS,
  COLUMN_LABELS,
  COLUMN_MIN,
  LEFT_PANEL_MIN,
  NAME_MIN_W,
  fitColumns,
  maxColumnWidth,
  maxNameWidth,
  type ColumnKey,
} from "./columns";

const LEFT_MIN = LEFT_PANEL_MIN;
const LEFT_MAX = 960;
const RES_DOCK_MIN = 96;
const RES_DOCK_MAX = 560;

function isDoneStatus(status: string): boolean {
  return /done|closed|resolved|complete|ship/i.test(status || "");
}

/** Still waiting to start (Ready for Dev / To Do / etc). */
function isReadyForDevStatus(status: string): boolean {
  const s = (status || "").toLowerCase();
  return /ready\s*for\s*dev|ready\s*for\s*development|selected for development|to\s*do|^todo$|backlog|^open$/i.test(
    s,
  );
}

/** Past due date and not in a done-like status. */
function isOverdue(t: GanttTask | undefined | null): boolean {
  if (!t || t.localOnly || t.isMarker || !t.due) return false;
  if (isDoneStatus(t.status)) return false;
  return t.due < formatYmd(todayLocal());
}

/** Start date has passed but status is still Ready for Dev / not started. */
function isStartLate(t: GanttTask | undefined | null): boolean {
  if (!t || t.localOnly || t.isMarker || !t.start) return false;
  if (isDoneStatus(t.status)) return false;
  if (!isReadyForDevStatus(t.status)) return false;
  return t.start < formatYmd(todayLocal());
}

function OverdueIcon({ due }: { due: string }) {
  return (
    <span
      className="pg-overdue-icon"
      title={`Overdue — due ${due}`}
      aria-label={`Overdue — due ${due}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 3.2 1.8 20.5a1 1 0 0 0 .87 1.5h18.66a1 1 0 0 0 .87-1.5L12 3.2Zm0 5.3a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1Zm0 9.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"
        />
      </svg>
    </span>
  );
}

function StartLateIcon({ start, status }: { start: string; status: string }) {
  return (
    <span
      className="pg-start-late-icon"
      title={`Should have started ${start} — still “${status}”`}
      aria-label={`Should have started ${start} — still ${status}`}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm.75-12.5h-1.5v5.25l4.5 2.7.75-1.23-3.75-2.22Z"
        />
      </svg>
    </span>
  );
}

function TaskWarnIcons({ task }: { task: GanttTask | undefined | null }) {
  if (!task) return null;
  return (
    <>
      {isOverdue(task) && task.due ? <OverdueIcon due={task.due} /> : null}
      {isStartLate(task) && task.start ? (
        <StartLateIcon start={task.start} status={task.status} />
      ) : null}
    </>
  );
}

/** Chevron that reveals a row's secondary info without changing the row height. */
function DetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`pg-info-toggle${open ? " on" : ""}`}
      title={open ? "Hide details" : "Show details"}
      aria-label={open ? "Hide details" : "Show details"}
      aria-expanded={open}
      onClick={onToggle}
    >
      ⌄
    </button>
  );
}

/** Floating panel with the info that used to make every row two or three lines tall. */
function RowDetails({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pg-row-details">
      <div className="pg-row-details-title">{title}</div>
      {children}
    </div>
  );
}

type Pt = [number, number];

/** Build an SVG path from orthogonal points with rounded corners. */
function roundedOrthPath(points: Pt[], radius = 6): string {
  const pts: Pt[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.round(last[0]) !== Math.round(p[0]) || Math.round(last[1]) !== Math.round(p[1])) {
      pts.push(p);
    }
  }
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const len1 = Math.hypot(cx - px, cy - py) || 1;
    const len2 = Math.hypot(nx - cx, ny - cy) || 1;
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const a: Pt = [cx - ((cx - px) / len1) * r, cy - ((cy - py) / len1) * r];
    const b: Pt = [cx + ((nx - cx) / len2) * r, cy + ((ny - cy) / len2) * r];
    d += ` L ${a[0]} ${a[1]} Q ${cx} ${cy} ${b[0]} ${b[1]}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/** Finish-to-start elbow route: from right edge of predecessor to left edge of successor. */
function depRoute(x1: number, y1: number, x2: number, y2: number): Pt[] {
  const stub = 14;
  const bendX = x2 - stub; // vertical drop just before the target
  if (bendX >= x1 + stub) {
    // Forward: run along the source row, then a single drop into the target.
    return [
      [x1, y1],
      [bendX, y1],
      [bendX, y2],
      [x2, y2],
    ];
  }
  // Successor starts before predecessor ends: exit right, hug a lane, come back in.
  const outX = x1 + stub;
  const inX = x2 - stub;
  const laneY = y1 + (y2 >= y1 ? 1 : -1) * (ROW_H / 2);
  return [
    [x1, y1],
    [outX, y1],
    [outX, laneY],
    [inX, laneY],
    [inX, y2],
    [x2, y2],
  ];
}

function historyGhostTitle(
  compareDate: string,
  hist: HistoricalSchedule,
  task: GanttTask,
): string {
  const then = `${hist.start ?? "—"} → ${hist.due ?? "—"} (${hist.durationDays}d)`;
  const now = `${task.start ?? "—"} → ${task.due ?? "—"} (${task.durationDays}d)`;
  return `As of ${compareDate}: ${then} · now: ${now}`;
}

function historyGhostForTask(
  task: GanttTask,
  historyOverlay: Map<string, HistoricalSchedule | null> | undefined,
  compareDate: string | null | undefined,
  days: ReturnType<typeof buildDays>,
  holidaysOn: boolean,
  dayWidth: number,
): { geo: { left: number; width: number }; title: string } | null {
  if (!historyOverlay || !compareDate || task.localOnly || task.pendingCreate) return null;
  const hist = historyOverlay.get(task.id);
  if (!hist || !historicalScheduleDiffers(hist, task) || !hist.start) return null;
  const geo = barGeometry(days, hist.start, hist.durationDays, holidaysOn, dayWidth);
  if (!geo) return null;
  return { geo, title: historyGhostTitle(compareDate, hist, task) };
}

function ColumnResizeHandle({
  label,
  width,
  min,
  max,
  onResize,
  onReset,
}: {
  label: string;
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const resize = useDragResize("x", onResize, { min, max });
  return (
    <span
      className="pg-col-resize"
      role="separator"
      aria-orientation="vertical"
      title={`Drag to resize ${label} · double-click to reset`}
      onPointerDown={(e) => resize.begin(e, width)}
      onDoubleClick={onReset}
    />
  );
}

interface Props {
  model: GanttModel;
  jiraBaseUrl: string;
  initialScroll?: ScrollState | null;
  /** Screenshot-ready: hide editors, resize chrome, and resources dock. */
  preview?: boolean;
  /** Show loading overlay while syncing with Jira. */
  loading?: "pull" | "push" | "history" | null;
  /** Optional detail under the loading spinner (e.g. push item count). */
  loadingDetail?: string | null;
  /** When set, overlay ghost bars from Jira changelog as of this date (YYYY-MM-DD). */
  compareDate?: string | null;
  historyOverlay?: Map<string, HistoricalSchedule | null>;
  /** overlay = ghosts on today; asOf = full board replaced (passed via model). */
  historyViewMode?: HistoryViewMode | null;
  historyViewLabel?: string | null;
  /** Read-only timeline (as-of view) — no drag, status, or assignee edits. */
  historyReadOnly?: boolean;
  onScheduleEdit: (taskId: string, patch: Partial<GanttTask>) => void;
  onStatusEdit: (
    taskId: string,
    next: {
      status: string;
      transitionId: string | null;
      timeSpent?: string | null;
    },
  ) => void;
  onResourceEdit: (taskId: string, resourceId: string | null) => void;
  onToggleCollapse: (milestoneId: string) => void;
  onMilestoneColorChange: (milestoneId: string, color: string) => void;
  onReorderMilestone: (fromId: string, toId: string, place: "before" | "after") => void;
  onReorderTask: (
    milestoneId: string,
    fromId: string,
    toId: string,
    place: "before" | "after",
  ) => void;
  onToggleMarker: (taskId: string) => void;
  onToggleHidden: (taskId: string) => void;
  onToggleHiddenFolder: () => void;
  onDeleteLocalMilestone: (taskId: string) => void;
  onDeleteQaItem: (milestoneId: string) => void;
  onEditQaItem: (milestoneId: string) => void;
  onDeleteDraftTask: (taskId: string) => void;
  onLayoutChange: (patch: Partial<GanttModel>) => void;
  onScrollChange?: (scroll: ScrollState) => void;
  onAddTask?: () => void;
  onAddMilestone?: () => void;
  onAddIntegrationTest?: () => void;
  onAddE2eFlow?: () => void;
  onCollapseOrExpandAll?: () => void;
}

type DragMode =
  | {
      kind: "move";
      taskId: string;
      startX: number;
      origStart: string;
      durationDays: number;
      lastStart: string;
    }
  | {
      kind: "resize";
      taskId: string;
      startX: number;
      origDuration: number;
      origStart: string;
      lastDuration: number;
    }
  | null;

export function GanttBoard({
  model,
  jiraBaseUrl,
  initialScroll,
  preview = false,
  loading = null,
  loadingDetail = null,
  compareDate = null,
  historyOverlay,
  historyViewMode = null,
  historyViewLabel = null,
  historyReadOnly = false,
  onScheduleEdit,
  onStatusEdit,
  onResourceEdit,
  onToggleCollapse,
  onMilestoneColorChange,
  onReorderMilestone,
  onReorderTask,
  onToggleMarker,
  onToggleHidden,
  onToggleHiddenFolder,
  onDeleteLocalMilestone,
  onDeleteQaItem,
  onEditQaItem,
  onDeleteDraftTask,
  onLayoutChange,
  onScrollChange,
  onAddTask,
  onAddMilestone,
  onAddIntegrationTest,
  onAddE2eFlow,
  onCollapseOrExpandAll,
}: Props) {
  const readOnly = preview || historyReadOnly;
  const hasEpics = model.milestones.some((m) => !m.localOnly);
  const hasBoardTasks = useMemo(() => {
    for (const m of model.milestones) {
      if (m.localOnly) continue;
      for (const t of m.tasks) {
        if (!t.localOnly && !t.pendingCreate && !t.isMarker) return true;
      }
    }
    return false;
  }, [model.milestones]);
  const deletableItems = useMemo((): DeletableTimelineItem[] => {
    const out: DeletableTimelineItem[] = [];
    for (const m of model.milestones) {
      if (isLocalMilestoneRow(m)) {
        out.push({
          id: m.id,
          label: m.title,
          kind: "milestone",
          confirmMessage: `Remove local milestone “${m.title}”?`,
          onDelete: () => onDeleteLocalMilestone(m.id),
        });
        continue;
      }
      if (isQaMilestone(m)) {
        const t = m.tasks.find((x) => x.id === m.id) || m.tasks[0];
        const synced = !!(t?.pulledLinkedIssueKeys?.length);
        out.push({
          id: m.id,
          label: m.title,
          kind: m.qaKind || "integration",
          confirmMessage: synced
            ? `Remove ${qaKindLabel(m.qaKind || "integration")} “${m.title}”? Push to delete from Jira.`
            : `Remove ${qaKindLabel(m.qaKind || "integration")} “${m.title}”?`,
          onDelete: () => onDeleteQaItem(m.id),
        });
        continue;
      }
      for (const t of m.tasks) {
        if (!t.pendingCreate) continue;
        out.push({
          id: t.id,
          label: t.title,
          kind: "draft",
          confirmMessage: `Remove draft task “${t.title}”?`,
          onDelete: () => onDeleteDraftTask(t.id),
        });
      }
    }
    return out;
  }, [
    model.milestones,
    onDeleteDraftTask,
    onDeleteLocalMilestone,
    onDeleteQaItem,
  ]);
  const allEpicsCollapsed =
    model.milestones.length > 0 && model.milestones.every((m) => m.collapsed);
  const holidaysOn = model.showHolidays;
  const dayWidth = model.dayWidthPx || 28;
  const leftW = model.leftPanelWidth || 680;
  const resDockH = model.resourcesDockHeight || 220;
  const resDockCollapsed = !!model.resourcesDockCollapsed;
  /** Saved preferred widths; `columns` is how they render after any squeeze. */
  const rawColumns = useMemo(
    () => normalizeColumnWidths(model.columnWidths),
    [model.columnWidths],
  );
  const { columns, nameW } = useMemo(
    () => fitColumns(rawColumns, leftW),
    [rawColumns, leftW],
  );
  const tasksScrollRef = useRef<HTMLDivElement>(null);
  const resScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedPulledAt = useRef<string | null>(null);

  useEffect(() => {
    if (!initialScroll || !model.milestones.length) return;
    // Re-apply after restore and after each Pull (DOM rebuild can reset scroll)
    if (lastAppliedPulledAt.current === model.pulledAt && lastAppliedPulledAt.current !== null) {
      return;
    }
    lastAppliedPulledAt.current = model.pulledAt;
    const tasksEl = tasksScrollRef.current;
    const resEl = resScrollRef.current;
    if (!tasksEl) return;
    requestAnimationFrame(() => {
      tasksEl.scrollLeft = initialScroll.tasksLeft || 0;
      tasksEl.scrollTop = initialScroll.tasksTop || 0;
      if (resEl) resEl.scrollLeft = initialScroll.resLeft || initialScroll.tasksLeft || 0;
    });
  }, [initialScroll, model.milestones.length, model.pulledAt]);

  /**
   * Store the column's new preferred width against the saved widths — never the
   * squeezed ones — so the other columns spring back when the panel grows again.
   * The space comes out of Name, which is what the drag visually takes it from.
   */
  function resizeColumn(key: ColumnKey, width: number) {
    onLayoutChange({
      columnWidths: {
        ...rawColumns,
        [key]: width,
        name: Math.max(NAME_MIN_W, nameW - (width - rawColumns[key])),
      },
    });
  }

  function emitScroll() {
    if (!onScrollChange) return;
    const tasksEl = tasksScrollRef.current;
    const resEl = resScrollRef.current;
    if (!tasksEl) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      onScrollChange({
        tasksLeft: tasksEl.scrollLeft,
        tasksTop: tasksEl.scrollTop,
        resLeft: resEl?.scrollLeft ?? tasksEl.scrollLeft,
      });
    }, 250);
  }

  const leftResize = useDragResize("x", (leftPanelWidth) => onLayoutChange({ leftPanelWidth }), {
    min: LEFT_MIN,
    max: LEFT_MAX,
  });
  const dockResize = useDragResize(
    "y",
    (resourcesDockHeight) => onLayoutChange({ resourcesDockHeight }),
    { min: RES_DOCK_MIN, max: RES_DOCK_MAX, sign: -1 },
  );
  const dayResize = useDragResize("x", (dayWidthPx) => onLayoutChange({ dayWidthPx }), {
    min: DAY_WIDTH_MIN,
    max: DAY_WIDTH_MAX,
  });

  function syncHorizontal(from: "tasks" | "res") {
    if (syncingScroll.current) return;
    const a = from === "tasks" ? tasksScrollRef.current : resScrollRef.current;
    const b = from === "tasks" ? resScrollRef.current : tasksScrollRef.current;
    if (!a || !b) return;
    syncingScroll.current = true;
    b.scrollLeft = a.scrollLeft;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
    emitScroll();
  }

  const { start, end } = useMemo(
    () => rangeBounds(model.milestones, model.projectStart, holidaysOn),
    [model.milestones, model.projectStart, holidaysOn],
  );
  const days = useMemo(() => buildDays(start, end, holidaysOn), [start, end, holidaysOn]);
  const rows = useMemo(
    () => buildRows(model.milestones, model.hiddenFolderCollapsed !== false),
    [model.milestones, model.hiddenFolderCollapsed],
  );
  const trackW = days.length * dayWidth;
  const canvasH = 52 + rows.length * ROW_H;

  const today = todayYmd();
  const todayLeft = markerLeft(days, today, dayWidth);
  const projStartLeft = markerLeft(days, model.projectStart, dayWidth);
  const projEnd = projectEndYmd(model.milestones, holidaysOn);
  const projEndLeft = projEnd ? markerLeft(days, projEnd, dayWidth) : null;

  const [rowDrag, setRowDrag] = useState<{ milestoneId: string; taskId: string } | null>(
    null,
  );
  const [rowDropTarget, setRowDropTarget] = useState<
    { taskId: string; place: "before" | "after" } | null
  >(null);

  const [msDrag, setMsDrag] = useState<string | null>(null);
  const [msDropTarget, setMsDropTarget] = useState<
    { id: string; place: "before" | "after" } | null
  >(null);

  const [drag, setDrag] = useState<DragMode>(null);
  /** Row whose secondary info panel is open — rows stay one line tall by default. */
  const [detailsRow, setDetailsRow] = useState<string | null>(null);
  /** Ghost bar while placing a start date on an unscheduled task. */
  const [placeHover, setPlaceHover] = useState<{
    taskId: string;
    start: string;
  } | null>(null);

  useEffect(() => {
    if (!detailsRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsRow(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".pg-row-details, .pg-info-toggle")) return;
      setDetailsRow(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [detailsRow]);

  function startFromTrackPointer(
    e: ReactMouseEvent | ReactPointerEvent,
    trackEl: HTMLElement,
  ): string | null {
    const rect = trackEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.floor(x / dayWidth);
    if (idx < 0 || idx >= days.length) return null;
    return formatYmd(firstWorkingDay(parseYmd(days[idx].ymd), holidaysOn));
  }

  function placeStartOnTask(task: GanttTask, start: string) {
    // Keep existing geometry duration; do not invent a Story Points estimate.
    const durationDays = Math.max(1, task.durationDays || 1);
    const due = dueFromStartDuration(start, durationDays, holidaysOn);
    onScheduleEdit(task.id, { start, due });
    setPlaceHover(null);
  }
  const dragRef = useRef<DragMode>(null);
  const dayWidthRef = useRef(dayWidth);
  const holidaysOnRef = useRef(holidaysOn);
  const onScheduleEditRef = useRef(onScheduleEdit);
  dayWidthRef.current = dayWidth;
  holidaysOnRef.current = holidaysOn;
  onScheduleEditRef.current = onScheduleEdit;

  const taskById = useMemo(() => {
    const m = new Map<string, GanttTask>();
    for (const ms of model.milestones) for (const t of ms.tasks) m.set(t.id, t);
    return m;
  }, [model.milestones]);

  const resourceColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of model.resources) m.set(r.id, r.color);
    return m;
  }, [model.resources]);

  function colorForTask(t: GanttTask): string {
    const id = t.resourceIds[0];
    if (id && resourceColor.has(id)) return resourceColor.get(id)!;
    return UNASSIGNED_COLOR;
  }

  useEffect(() => {
    if (!drag) return;

    const applyDrag = (clientX: number) => {
      const d = dragRef.current;
      if (!d) return;
      const dw = dayWidthRef.current;
      const hol = holidaysOnRef.current;
      const dx = clientX - d.startX;

      if (d.kind === "move") {
        const daysShift = Math.round(dx / dw);
        const shifted = addCalendarDays(d.origStart, daysShift);
        const next = formatYmd(firstWorkingDay(parseYmd(shifted), hol));
        if (next === d.lastStart) return;
        d.lastStart = next;
        const due = dueFromStartDuration(next, d.durationDays, hol);
        onScheduleEditRef.current(d.taskId, { start: next, due });
      } else {
        const delta = Math.round(dx / dw);
        const nextDur = Math.max(1, d.origDuration + delta);
        if (nextDur === d.lastDuration) return;
        d.lastDuration = nextDur;
        const due = dueFromStartDuration(d.origStart, nextDur, hol);
        onScheduleEditRef.current(d.taskId, { durationDays: nextDur, due });
      }
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      applyDrag(e.clientX);
    };
    const onUp = () => {
      dragRef.current = null;
      setDrag(null);
      document.body.classList.remove("pg-dragging-bar", "pg-resizing-bar");
    };

    document.body.classList.add(
      drag.kind === "resize" ? "pg-resizing-bar" : "pg-dragging-bar",
    );
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("pg-dragging-bar", "pg-resizing-bar");
    };
  }, [drag]);

  function beginDrag(mode: NonNullable<DragMode>, e: ReactPointerEvent) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = mode;
    setDrag(mode);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function addCalendarDays(ymd: string, n: number): string {
    const d = parseYmd(ymd);
    return formatYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  const depPaths = useMemo(() => {
    if (!model.showDeps)
      return [] as Array<{ d: string; x1: number; y1: number }>;
    const paths: Array<{ d: string; x1: number; y1: number }> = [];
    const rowY = new Map<string, number>();
    for (const r of rows) {
      if (r.kind === "task" && r.task) rowY.set(r.task.id, r.y + ROW_H / 2);
    }
    for (const r of rows) {
      if (r.kind !== "task" || !r.task?.start) continue;
      const to = r.task;
      const toStart = to.start as string;
      const toGeo = barGeometry(days, toStart, to.durationDays, holidaysOn, dayWidth);
      if (!toGeo) continue;
      for (const fromKey of to.blockedBy) {
        const from = taskById.get(fromKey);
        if (!from?.start) continue;
        const fromGeo = barGeometry(days, from.start, from.durationDays, holidaysOn, dayWidth);
        const y1 = rowY.get(fromKey);
        const y2 = rowY.get(to.id);
        if (!fromGeo || y1 == null || y2 == null) continue;
        const x1 = fromGeo.left + fromGeo.width;
        const x2 = toGeo.left;
        paths.push({ d: roundedOrthPath(depRoute(x1, y1, x2, y2)), x1, y1 });
      }
    }
    return paths;
  }, [model.showDeps, rows, days, holidaysOn, dayWidth, taskById]);

  if (!model.milestones.length) {
    return (
      <div className="pg-shell">
        <div className="pg-empty">
          No tasks yet. Enter a JQL (or epic keys) and press <strong>Pull</strong>.
          <br />
          Example: <code>project = SBT AND parent = SBT-61018</code>
        </div>
      </div>
    );
  }

  const shellStyle = {
    ["--day-w" as string]: `${dayWidth}px`,
    ["--left-w" as string]: `${leftW}px`,
    ["--name-w" as string]: `${nameW}px`,
    ["--col-start-w" as string]: `${columns.start}px`,
    ["--col-dur-w" as string]: `${columns.dur}px`,
    ["--col-status-w" as string]: `${columns.status}px`,
    ["--col-res-w" as string]: `${columns.res}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`pg-shell${preview ? " pg-preview" : ""}${
        historyViewMode === "asOf" ? " pg-history-asof" : ""
      }${historyViewMode === "overlay" ? " pg-history-overlay" : ""}`}
      style={shellStyle}
    >
      {historyViewLabel && historyViewMode ? (
        <div className="pg-history-banner" role="status">
          {historyViewLabel}
          {historyReadOnly ? " · read-only snapshot" : " · faded bars = then, solid = today"}
        </div>
      ) : null}
      {loading && (
        <div
          className={`pg-loading pg-loading-${loading}`}
          role="status"
          aria-live="polite"
        >
          <div className={`pg-loadbar pg-loadbar-board${loading === "push" ? " push" : ""}`} />
          <span className="pg-spinner" aria-hidden />
          <span className="pg-loading-text">
            {loading === "pull"
              ? "Pulling from Jira…"
              : loading === "push"
                ? "Pushing to Jira…"
                : "Loading Jira history…"}
          </span>
          {loadingDetail ? (
            <span className="pg-loading-detail">{loadingDetail}</span>
          ) : null}
        </div>
      )}
      {!preview && (
        <div className="pg-zoom pg-zoom-timeline" title="Timeline zoom">
          <button
            type="button"
            className="gantt-btn"
            disabled={dayWidth <= DAY_WIDTH_MIN}
            onClick={() =>
              onLayoutChange({
                dayWidthPx: clampDayWidth(dayWidth - DAY_WIDTH_STEP),
              })
            }
            aria-label="Zoom out timeline"
          >
            −
          </button>
          <span className="pg-zoom-label">{dayWidth}px</span>
          <button
            type="button"
            className="gantt-btn"
            disabled={dayWidth >= DAY_WIDTH_MAX}
            onClick={() =>
              onLayoutChange({
                dayWidthPx: clampDayWidth(dayWidth + DAY_WIDTH_STEP),
              })
            }
            aria-label="Zoom in timeline"
          >
            +
          </button>
        </div>
      )}
      <div
        className="pg-scroll"
        ref={tasksScrollRef}
        onScroll={() => syncHorizontal("tasks")}
        style={{ flex: "1 1 auto", minHeight: 120, maxHeight: "none" }}
      >
        <div className="pg-canvas" style={{ minHeight: canvasH }}>
          {/* Full-height divider to resize the columns panel (drag left/right) */}
          {!preview && (
            <div className="pg-left-divider-rail">
              <div
                className="pg-resize-x pg-resize-x-full"
                title="Drag to resize columns"
                style={{ height: canvasH }}
                onPointerDown={(e) => leftResize.begin(e, leftW)}
              />
            </div>
          )}
          {/* Header */}
          <div className="pg-row pg-head">
            <div className="pg-fixed">
              <div className="pg-col-num">#</div>
              <div className="pg-col-name pg-col-name-head">
                <span className="pg-name-text" style={{ fontWeight: 700, color: "var(--muted)" }}>
                  Name
                </span>
                {!preview &&
                  (onCollapseOrExpandAll ||
                    (!readOnly &&
                      (onAddTask || onAddMilestone || onAddIntegrationTest || onAddE2eFlow))) && (
                  <div className="pg-board-actions">
                    {!readOnly &&
                      onAddTask &&
                      onAddMilestone &&
                      onAddIntegrationTest &&
                      onAddE2eFlow && (
                      <AddTimelineMenu
                        hasEpics={hasEpics}
                        hasBoardTasks={hasBoardTasks}
                        deletableItems={deletableItems}
                        onAddTask={onAddTask}
                        onAddMilestone={onAddMilestone}
                        onAddIntegrationTest={onAddIntegrationTest}
                        onAddE2eFlow={onAddE2eFlow}
                      />
                    )}
                    {onCollapseOrExpandAll && (
                      <button
                        type="button"
                        className="gantt-btn pg-board-action"
                        disabled={!model.milestones.length}
                        onClick={onCollapseOrExpandAll}
                        title={
                          allEpicsCollapsed
                            ? "Expand all epics and show their tasks"
                            : "Collapse all epics and hide their tasks"
                        }
                      >
                        {allEpicsCollapsed ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                  </div>
                )}
                {!preview && (
                  <ColumnResizeHandle
                    label="Name"
                    width={nameW}
                    min={NAME_MIN_W}
                    max={maxNameWidth(leftW)}
                    onResize={(name) => onLayoutChange({ columnWidths: { ...rawColumns, name } })}
                    onReset={() =>
                      onLayoutChange({
                        columnWidths: { ...rawColumns, name: DEFAULT_COLUMN_WIDTHS.name },
                      })
                    }
                  />
                )}
              </div>
              {COLUMN_KEYS.map((key) => (
                <div key={key} className={`pg-col-${key} pg-col-head`}>
                  <span className="pg-col-head-label">{COLUMN_LABELS[key]}</span>
                  {!preview && (
                    <ColumnResizeHandle
                      label={COLUMN_LABELS[key]}
                      width={rawColumns[key]}
                      min={COLUMN_MIN[key]}
                      max={maxColumnWidth(key, rawColumns, nameW)}
                      onResize={(width) => resizeColumn(key, width)}
                      onReset={() => resizeColumn(key, DEFAULT_COLUMN_WIDTHS[key])}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="pg-track pg-head-track" style={{ width: trackW }}>
              <div className="pg-days" style={{ width: trackW }}>
                {days.map((d, i) =>
                  d.monthLabel ? (
                    <div key={`m-${d.ymd}`} className="pg-month" style={{ left: i * dayWidth }}>
                      {d.monthLabel}
                    </div>
                  ) : null,
                )}
                <div className="pg-dow-row">
                  {days.map((d) => (
                    <div
                      key={d.ymd}
                      className={`pg-dow${d.isWeekend ? " weekend" : ""}${d.isHoliday ? " holiday" : ""}`}
                      title={d.holidayLabel || d.ymd}
                    >
                      <span className="pg-dom">{d.dom}</span>
                      <span className="pg-dow-letter">{d.dow}</span>
                    </div>
                  ))}
                </div>
                {!preview && (
                  <div
                    className="pg-resize-day"
                    title="Drag to zoom day width"
                    onPointerDown={(e) => dayResize.begin(e, dayWidth)}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Body rows */}
          {rows.map((r) => {
            if (r.kind === "milestone") {
              const isHiddenFolder = !!r.isHiddenFolder;
              const isQaRow = isQaMilestone(r.milestone);
              const isLocalMs = isLocalMilestoneRow(r.milestone) && !isHiddenFolder;
              const epicSelf = isHiddenFolder
                ? undefined
                : r.milestone.tasks.find((t) => isEpicSelfTask(r.milestone.id, t));
              const qaTask = isQaRow
                ? r.milestone.tasks.find((t) => t.id === r.milestone.id) || r.milestone.tasks[0]
                : undefined;
              const childTasks = isHiddenFolder
                ? r.milestone.tasks
                : r.milestone.tasks.filter(
                    (t) => !isEpicSelfTask(r.milestone.id, t) && !t.hidden,
                  );
              const childCount = childTasks.length;
              const doneChildCount = childTasks.filter((t) => isDoneStatus(t.status)).length;
              /** Epic completion from its visible child stories; null when there are none. */
              const donePct =
                !isHiddenFolder && !isQaRow && !isLocalMs && childCount > 0
                  ? Math.round((doneChildCount / childCount) * 100)
                  : null;
              const span = isHiddenFolder ? null : milestoneSpan(r.milestone, holidaysOn);
              const msGeo =
                isHiddenFolder
                  ? null
                  : isQaRow && epicSelf?.start
                    ? barGeometry(
                        days,
                        epicSelf.start,
                        epicSelf.durationDays,
                        holidaysOn,
                        dayWidth,
                      )
                    : !isLocalMs && epicSelf?.start
                      ? barGeometry(
                          days,
                          epicSelf.start,
                          epicSelf.durationDays,
                          holidaysOn,
                          dayWidth,
                        )
                      : !isLocalMs && !isQaRow && span
                        ? (() => {
                            const si = days.findIndex((d) => d.ymd === span.start);
                            const ei = days.findIndex((d) => d.ymd === span.end);
                            if (si < 0 || ei < 0) return null;
                            return {
                              left: si * dayWidth,
                              width: Math.max(dayWidth, (ei - si + 1) * dayWidth),
                            };
                          })()
                        : null;
              const localDate = epicSelf?.start || epicSelf?.due || null;
              const localStarLeft =
                isLocalMs && !isQaRow && localDate
                  ? markerLeft(days, localDate, dayWidth)
                  : null;
              const canPlaceEpicSelf =
                !readOnly &&
                !!epicSelf &&
                !epicSelf.start &&
                !isLocalMs &&
                !isHiddenFolder &&
                !msGeo;
              const epicPlaceGhost =
                canPlaceEpicSelf &&
                placeHover?.taskId === epicSelf.id &&
                barGeometry(
                  days,
                  placeHover.start,
                  Math.max(1, epicSelf.durationDays || 1),
                  holidaysOn,
                  dayWidth,
                );
              const msRowKey = `ms-${r.milestone.id}`;
              const msDetailsOpen = detailsRow === msRowKey;
              const msQaKeys = (isQaRow && epicSelf?.linkedIssueKeys) || [];
              /** QA rows collect assignees from every linked Jira issue, so there can be several. */
              const qaAssignees = isQaRow
                ? (epicSelf?.resourceIds || [])
                    .map((rid) => model.resources.find((res) => res.id === rid))
                    .filter((res): res is (typeof model.resources)[number] => !!res)
                : [];
              const msMeta = isHiddenFolder
                ? "Hidden from timeline · expand to show or unhide"
                : isQaRow
                  ? qaTask?.dirty
                    ? `${qaKindLabel(r.milestone.qaKind || "integration")} · Push to save on linked Jira issues`
                    : `${qaKindLabel(r.milestone.qaKind || "integration")} · saved on linked Jira issues`
                  : isLocalMs
                    ? "Local milestone · not synced to Jira"
                    : epicSelf
                      ? `${epicSelf.assignee ? `${epicSelf.assignee} · ` : ""}${
                          epicSelf.estDays != null ? `Est ${epicSelf.estDays}sp` : ""
                        }${
                          epicSelf.owner && epicSelf.owner !== "—"
                            ? `${epicSelf.estDays != null ? " · " : ""}${epicSelf.owner}`
                            : ""
                        }`
                      : "";
              return (
                <div
                  className={`pg-row milestone${msDetailsOpen ? " details-open" : ""}${
                    isLocalMs ? " local-ms" : ""
                  }${
                    isQaRow ? ` qa-row qa-${r.milestone.qaKind}` : ""
                  }${isHiddenFolder ? " hidden-folder" : ""}${
                    !isHiddenFolder && msDrag === r.milestone.id ? " row-dragging" : ""
                  }${
                    !isHiddenFolder && msDropTarget?.id === r.milestone.id
                      ? ` drop-${msDropTarget.place}`
                      : ""
                  }`}
                  key={`ms-${r.milestone.id}`}
                  onDragOver={(e) => {
                    if (!msDrag || isHiddenFolder) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const place: "before" | "after" =
                      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    if (
                      msDropTarget?.id !== r.milestone.id ||
                      msDropTarget?.place !== place
                    ) {
                      setMsDropTarget({ id: r.milestone.id, place });
                    }
                  }}
                  onDrop={(e) => {
                    if (!msDrag || isHiddenFolder) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const place: "before" | "after" =
                      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    onReorderMilestone(msDrag, r.milestone.id, place);
                    setMsDrag(null);
                    setMsDropTarget(null);
                  }}
                >
                  <div className="pg-fixed">
                    <div className="pg-col-num">
                      {isHiddenFolder ? (
                        <span className="pg-drag-handle pg-drag-handle-spacer" />
                      ) : (
                        <span
                          className="pg-drag-handle"
                          draggable
                          title={
                            isQaRow
                              ? "Drag to reorder QA row"
                              : isLocalMs
                                ? "Drag to reorder milestone"
                                : "Drag to reorder epic"
                          }
                          aria-label={
                            isQaRow
                              ? "Drag to reorder QA row"
                              : isLocalMs
                                ? "Drag to reorder milestone"
                                : "Drag to reorder epic"
                          }
                          onDragStart={(e) => {
                            setMsDrag(r.milestone.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", r.milestone.id);
                          }}
                          onDragEnd={() => {
                            setMsDrag(null);
                            setMsDropTarget(null);
                          }}
                        >
                          ⠿
                        </span>
                      )}
                      <span className="pg-col-num-id">
                        {isHiddenFolder
                          ? "⊘"
                          : isQaRow && r.milestone.qaKind
                            ? qaKindIcon(r.milestone.qaKind)
                            : isLocalMs
                              ? "★"
                              : childCount}
                      </span>
                      {epicSelf?.dirty || qaTask?.dirty ? (
                        <span className="pg-dirty-dot" title="Unpushed change" />
                      ) : null}
                    </div>
                    <div className="pg-col-name">
                      {isHiddenFolder ? (
                        <button
                          type="button"
                          className="pg-toggle"
                          onClick={() => onToggleHiddenFolder()}
                          aria-label="Toggle hidden folder"
                        >
                          {r.milestone.collapsed ? "▸" : "▾"}
                        </button>
                      ) : isLocalMs || isQaRow ? (
                        <span className="pg-toggle pg-toggle-spacer" />
                      ) : childCount > 0 ? (
                        <button
                          type="button"
                          className="pg-toggle"
                          onClick={() => onToggleCollapse(r.milestone.id)}
                          aria-label="Toggle"
                        >
                          {r.milestone.collapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className="pg-toggle pg-toggle-spacer" />
                      )}
                      {isHiddenFolder ? (
                        <span className="pg-hidden-folder-icon" title="Hidden tasks">
                          ⊘
                        </span>
                      ) : isQaRow && r.milestone.qaKind ? (
                        <span
                          className={`pg-qa-kind-icon qa-${r.milestone.qaKind}`}
                          title={qaKindLabel(r.milestone.qaKind)}
                        >
                          {qaKindIcon(r.milestone.qaKind)}
                        </span>
                      ) : isLocalMs ? (
                        <span className="pg-local-ms-bullet" title="Local milestone">
                          ★
                        </span>
                      ) : (
                        <EpicColorPicker
                          epicKey={r.milestone.id}
                          color={r.milestone.color}
                          onChange={(color) =>
                            onMilestoneColorChange(r.milestone.id, color)
                          }
                        />
                      )}
                      <div className="pg-name-stack">
                        <span
                          className="pg-name-text"
                          style={{ fontWeight: 700 }}
                          title={r.milestone.title}
                        >
                          {isHiddenFolder ? (
                            <span className="pg-hidden-folder-label">Folder</span>
                          ) : isQaRow ? (
                            <span className="pg-local-key">
                              {r.milestone.qaKind === "e2e" ? "E2E" : "IT"}
                            </span>
                          ) : isLocalMs ? (
                            <span className="pg-local-key">MS</span>
                          ) : (
                            <a
                              href={`${jiraBaseUrl}/browse/${r.milestone.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {r.milestone.id}
                            </a>
                          )}
                          {r.milestone.title}
                        </span>
                        <TaskWarnIcons task={epicSelf} />
                      </div>
                      {msMeta || msQaKeys.length ? (
                        <DetailsToggle
                          open={msDetailsOpen}
                          onToggle={() => setDetailsRow(msDetailsOpen ? null : msRowKey)}
                        />
                      ) : null}
                      {msDetailsOpen && (
                        <RowDetails title={r.milestone.title}>
                          {msQaKeys.length ? (
                            <span className="pg-qa-chips">
                              {msQaKeys.map((key) => (
                                <a
                                  key={key}
                                  className="pg-qa-chip"
                                  href={`${jiraBaseUrl}/browse/${key}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Linked Jira task ${key}`}
                                >
                                  {key}
                                </a>
                              ))}
                            </span>
                          ) : null}
                          {msMeta ? <span className="pg-owner">{msMeta}</span> : null}
                        </RowDetails>
                      )}
                      {isLocalMs && !readOnly && (
                        <button
                          type="button"
                          className="pg-local-delete"
                          title="Delete milestone"
                          aria-label="Delete milestone"
                          onClick={() => onDeleteLocalMilestone(r.milestone.id)}
                        >
                          ×
                        </button>
                      )}
                      {isQaRow && !readOnly && (
                        <>
                          <button
                            type="button"
                            className="pg-local-edit"
                            title="Edit QA item"
                            aria-label="Edit QA item"
                            onClick={() => onEditQaItem(r.milestone.id)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="pg-local-delete"
                            title="Delete QA item"
                            aria-label="Delete QA item"
                            onClick={() => onDeleteQaItem(r.milestone.id)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                    {isLocalMs && !isQaRow && epicSelf ? (
                      <>
                        <div className="pg-col-start">
                          <input
                            className="pg-input"
                            type="date"
                            value={epicSelf.start || ""}
                            disabled={readOnly}
                            onChange={(e) => {
                              const startVal = e.target.value || null;
                              onScheduleEdit(epicSelf.id, {
                                start: startVal,
                                due: startVal,
                              });
                            }}
                          />
                        </div>
                        <div className="pg-col-dur">
                          <span className="pg-dur-milestone" title="Milestone (no duration)">
                            ★
                          </span>
                        </div>
                        <div className="pg-col-status">
                          <span className="pg-status-pill local">Local</span>
                        </div>
                        <div className="pg-col-res">
                          <span className="pg-assign-empty" title="Local milestone">
                            ★
                          </span>
                        </div>
                      </>
                    ) : isQaRow && epicSelf ? (
                      <>
                        <div className="pg-col-start">
                          <input
                            className="pg-input"
                            type="date"
                            value={epicSelf.start || ""}
                            disabled={readOnly}
                            onChange={(e) => {
                              const startVal = e.target.value || null;
                              onScheduleEdit(epicSelf.id, { start: startVal });
                            }}
                          />
                        </div>
                        <div className="pg-col-dur">
                          <input
                            className="pg-input dur"
                            type="number"
                            min={1}
                            value={epicSelf.durationDays}
                            disabled={readOnly}
                            onChange={(e) => {
                              const durationDays = Math.max(1, Number(e.target.value) || 1);
                              onScheduleEdit(epicSelf.id, { durationDays });
                            }}
                          />
                          <span className="pg-dur-suffix">d</span>
                        </div>
                        <div className="pg-col-status">
                          <span className="pg-status-pill qa">QA</span>
                        </div>
                        <div className="pg-col-res pg-qa-res">
                          {qaAssignees.length ? (
                            qaAssignees.map((resource) => (
                              <ResourceAvatar
                                key={resource.id}
                                resource={resource}
                                className="pg-qa-res-avatar"
                                title={`From linked Jira assignee · ${resource.name}`}
                              />
                            ))
                          ) : (
                            <span className="pg-assign-empty" title="No assignees on linked tasks">
                              —
                            </span>
                          )}
                        </div>
                      </>
                    ) : epicSelf && !isQaRow ? (
                      <>
                        <div className="pg-col-start">
                          <input
                            className="pg-input"
                            type="date"
                            value={epicSelf.start || ""}
                            disabled={readOnly}
                            onChange={(e) => {
                              const startVal = e.target.value || null;
                              const due = startVal
                                ? dueFromStartDuration(
                                    startVal,
                                    epicSelf.durationDays,
                                    holidaysOn,
                                  )
                                : epicSelf.due;
                              onScheduleEdit(epicSelf.id, { start: startVal, due });
                            }}
                          />
                        </div>
                        <div className="pg-col-dur">
                          <input
                            className="pg-input dur"
                            type="number"
                            min={1}
                            placeholder="—"
                            title={
                              epicSelf.estDays == null
                                ? "No Story Points in Jira"
                                : "Story Points (Dur)"
                            }
                            value={epicSelf.estDays ?? ""}
                            disabled={readOnly}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                onScheduleEdit(epicSelf.id, { estDays: null });
                                return;
                              }
                              const durationDays = Math.max(1, Number(raw) || 1);
                              const due = epicSelf.start
                                ? dueFromStartDuration(
                                    epicSelf.start,
                                    durationDays,
                                    holidaysOn,
                                  )
                                : epicSelf.due;
                              onScheduleEdit(epicSelf.id, {
                                durationDays,
                                due,
                                estDays: durationDays,
                              });
                            }}
                          />
                          <span className="pg-dur-suffix">d</span>
                        </div>
                        <div className="pg-col-status">
                          <StatusSelect
                            issueKey={epicSelf.id}
                            status={epicSelf.status}
                            pulledStatus={epicSelf.pulledStatus || epicSelf.status}
                            transitionId={epicSelf.transitionId}
                            durationDays={epicSelf.durationDays}
                            timeSpent={epicSelf.timeSpent}
                            disabled={readOnly}
                            onChange={(next) => onStatusEdit(epicSelf.id, next)}
                          />
                        </div>
                        <div className="pg-col-res">
                          <AssignMenu
                            resources={model.resources}
                            selected={epicSelf.resourceIds}
                            pulledSelected={epicSelf.pulledResourceIds ?? epicSelf.resourceIds}
                            disabled={readOnly}
                            issueKey={epicSelf.id}
                            onChange={(resourceId) => onResourceEdit(epicSelf.id, resourceId)}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="pg-col-start" />
                        <div className="pg-col-dur" />
                        <div className="pg-col-status" />
                        <div className="pg-col-res" />
                      </>
                    )}
                  </div>
                  <div
                    className={`pg-track${canPlaceEpicSelf ? " placeable" : ""}`}
                    style={{ width: trackW, minHeight: ROW_H }}
                    onPointerMove={
                      canPlaceEpicSelf && epicSelf
                        ? (e) => {
                            const start = startFromTrackPointer(e, e.currentTarget);
                            if (!start) {
                              setPlaceHover(null);
                              return;
                            }
                            if (
                              placeHover?.taskId !== epicSelf.id ||
                              placeHover.start !== start
                            ) {
                              setPlaceHover({ taskId: epicSelf.id, start });
                            }
                          }
                        : undefined
                    }
                    onPointerLeave={
                      canPlaceEpicSelf && epicSelf
                        ? () => {
                            if (placeHover?.taskId === epicSelf.id) setPlaceHover(null);
                          }
                        : undefined
                    }
                    onClick={
                      canPlaceEpicSelf && epicSelf
                        ? (e) => {
                            const start = startFromTrackPointer(e, e.currentTarget);
                            if (start) placeStartOnTask(epicSelf, start);
                          }
                        : undefined
                    }
                  >
                    <Bands days={days} dayWidth={dayWidth} />
                    <Markers
                      todayLeft={todayLeft}
                      projStartLeft={projStartLeft}
                      projEndLeft={projEndLeft}
                    />
                    {epicPlaceGhost && epicSelf && (
                      <div
                        className="pg-bar pg-bar-ghost"
                        style={{
                          left: epicPlaceGhost.left,
                          width: epicPlaceGhost.width,
                          background: r.milestone.color,
                        }}
                        title={`Click to set start ${placeHover!.start}`}
                      >
                        <span className="pg-bar-label">
                          {epicSelf.friendlyId || r.milestone.id}
                        </span>
                        <span className="pg-bar-ghost-hint">
                          Set {placeHover!.start}
                        </span>
                      </div>
                    )}
                    {epicSelf &&
                      (() => {
                        const hg = historyGhostForTask(
                          epicSelf,
                          historyOverlay,
                          compareDate,
                          days,
                          holidaysOn,
                          dayWidth,
                        );
                        if (!hg) return null;
                        return (
                          <div
                            className="pg-bar pg-bar-history-ghost"
                            style={{
                              left: hg.geo.left,
                              width: hg.geo.width,
                              background: r.milestone.color,
                            }}
                            title={hg.title}
                          />
                        );
                      })()}
                    {isLocalMs && !isQaRow && localStarLeft != null && epicSelf ? (
                      <div
                        className={`pg-milestone-star${
                          drag?.taskId === epicSelf.id ? " dragging" : ""
                        }`}
                        style={{ left: localStarLeft }}
                        title={`Milestone: ${r.milestone.title} · ${localDate}`}
                        onPointerDown={(e) => {
                          if (!epicSelf.start) return;
                          beginDrag(
                            {
                              kind: "move",
                              taskId: epicSelf.id,
                              startX: e.clientX,
                              origStart: epicSelf.start,
                              durationDays: 1,
                              lastStart: epicSelf.start,
                            },
                            e,
                          );
                        }}
                      >
                        <span className="pg-milestone-star-icon">★</span>
                        <span className="pg-milestone-star-name">{r.milestone.title}</span>
                      </div>
                    ) : msGeo ? (
                      <div
                        className={`pg-bar milestone-bar${isQaRow ? " qa-bar" : ""}${
                          !isQaRow && isOverdue(epicSelf) ? " overdue" : ""
                        }${!isQaRow && isStartLate(epicSelf) ? " start-late" : ""}${
                          !isQaRow && epicSelf && isDoneStatus(epicSelf.status) ? " done" : ""
                        }${
                          epicSelf && drag?.taskId === epicSelf.id
                            ? drag.kind === "resize"
                              ? " resizing"
                              : " dragging"
                            : ""
                        }`}
                        style={{
                          left: msGeo.left,
                          width: msGeo.width,
                          background: r.milestone.color,
                        }}
                        title={
                          [
                            donePct != null
                              ? `${doneChildCount} of ${childCount} tasks done (${donePct}%)`
                              : null,
                            epicSelf && isDoneStatus(epicSelf.status)
                              ? `Done — ${epicSelf.status}`
                              : isOverdue(epicSelf) && epicSelf?.due
                                ? `Overdue — due ${epicSelf.due}`
                                : isStartLate(epicSelf) && epicSelf
                                  ? `Should have started ${epicSelf.start} — still “${epicSelf.status}”`
                                  : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || undefined
                        }
                        onPointerDown={
                          epicSelf?.start
                            ? (e) => {
                                beginDrag(
                                  {
                                    kind: "move",
                                    taskId: epicSelf.id,
                                    startX: e.clientX,
                                    origStart: epicSelf.start!,
                                    durationDays: epicSelf.durationDays,
                                    lastStart: epicSelf.start!,
                                  },
                                  e,
                                );
                              }
                            : undefined
                        }
                      >
                        {donePct != null && (
                          <span
                            className={`pg-bar-fill${donePct >= 100 ? " full" : ""}`}
                            style={{ width: `${donePct}%` }}
                            aria-hidden
                          />
                        )}
                        {donePct != null && (
                          <span className="pg-bar-pct">{donePct}%</span>
                        )}
                        {epicSelf && (
                          <>
                            <span className="pg-bar-label">
                              {isQaRow
                                ? `${qaKindIcon(r.milestone.qaKind || "integration")} ${r.milestone.title}`
                                : epicSelf.estDays != null
                                  ? `${epicSelf.estDays}sp`
                                  : r.milestone.id}
                            </span>
                            {!isQaRow && isOverdue(epicSelf) ? (
                              <span className="pg-bar-overdue" aria-hidden>
                                !
                              </span>
                            ) : !isQaRow && isStartLate(epicSelf) ? (
                              <span className="pg-bar-start-late" aria-hidden>
                                S
                              </span>
                            ) : null}
                            {epicSelf.start && (
                              <span
                                className="pg-bar-handle"
                                onPointerDown={(e) => {
                                  beginDrag(
                                    {
                                      kind: "resize",
                                      taskId: epicSelf.id,
                                      startX: e.clientX,
                                      origDuration: epicSelf.durationDays,
                                      origStart: epicSelf.start!,
                                      lastDuration: epicSelf.durationDays,
                                    },
                                    e,
                                  );
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    ) : null}
                    {isQaRow && msGeo && qaAssignees.length > 0 && (
                      <span
                        className="pg-bar-assignees"
                        style={{ left: msGeo.left + msGeo.width + 6 }}
                        title={`Assignees on linked Jira issues · ${qaAssignees
                          .map((res) => res.name)
                          .join(", ")}`}
                      >
                        {qaAssignees.map((res) => (
                          <ResourceAvatar
                            key={res.id}
                            resource={res}
                            className="pg-bar-avatar"
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            const t = r.task!;
            const inHiddenFolder = !!r.isHiddenFolder;
            const geo =
              t.start &&
              barGeometry(days, t.start, t.durationDays, holidaysOn, dayWidth);
            const canPlace = !readOnly && !t.start && !t.isMarker && !inHiddenFolder;
            const placeGhost =
              canPlace &&
              placeHover?.taskId === t.id &&
              barGeometry(
                days,
                placeHover.start,
                Math.max(1, t.durationDays || 1),
                holidaysOn,
                dayWidth,
              );

            const taskDetailsOpen = detailsRow === `task-${t.id}`;
            const taskMeta = inHiddenFolder
              ? `Hidden · ${r.milestone.title}`
              : t.localOnly
                ? "Local only · not synced to Jira"
                : t.pendingCreate
                  ? `Draft · will create under ${t.createEpicId || "epic"} on Push`
                  : `${t.assignee ? `${t.assignee} · ` : ""}${t.owner}`;
            const taskBlockers =
              !t.localOnly && !t.pendingCreate && t.blockedBy.length > 0 ? t.blockedBy : [];

            const isRowDragging = !inHiddenFolder && rowDrag?.taskId === t.id;
            const dropCls =
              !inHiddenFolder &&
              rowDropTarget?.taskId === t.id &&
              rowDrag?.milestoneId === r.milestone.id
                ? ` drop-${rowDropTarget.place}`
                : "";

            return (
              <div
                className={`pg-row task${t.dirty ? " dirty" : ""}${
                  inHiddenFolder ? " is-hidden" : ""
                }${taskDetailsOpen ? " details-open" : ""}${
                  isRowDragging ? " row-dragging" : ""
                }${dropCls}`}
                key={inHiddenFolder ? `hidden-${t.id}` : t.id}
                onDragOver={(e) => {
                  if (inHiddenFolder || !rowDrag || rowDrag.milestoneId !== r.milestone.id)
                    return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const place: "before" | "after" =
                    e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  if (rowDropTarget?.taskId !== t.id || rowDropTarget?.place !== place) {
                    setRowDropTarget({ taskId: t.id, place });
                  }
                }}
                onDrop={(e) => {
                  if (inHiddenFolder || !rowDrag || rowDrag.milestoneId !== r.milestone.id)
                    return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const place: "before" | "after" =
                    e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  onReorderTask(r.milestone.id, rowDrag.taskId, t.id, place);
                  setRowDrag(null);
                  setRowDropTarget(null);
                }}
              >
                <div className="pg-fixed">
                  <div className="pg-col-num">
                    {inHiddenFolder ? (
                      <span className="pg-drag-handle pg-drag-handle-spacer" />
                    ) : (
                      <span
                        className="pg-drag-handle"
                        draggable
                        title="Drag to reorder"
                        aria-label="Drag to reorder task"
                        onDragStart={(e) => {
                          setRowDrag({ milestoneId: r.milestone.id, taskId: t.id });
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", t.id);
                        }}
                        onDragEnd={() => {
                          setRowDrag(null);
                          setRowDropTarget(null);
                        }}
                      >
                        ⠿
                      </span>
                    )}
                    <span className="pg-col-num-id">{t.friendlyId}</span>
                    {t.dirty ? <span className="pg-dirty-dot" title="Unpushed change" /> : null}
                  </div>
                  <div className="pg-col-name indented">
                    <span
                      className="pg-bullet"
                      style={{ background: colorForTask(t) }}
                    />
                    <div className="pg-name-stack">
                      <span className="pg-name-text" title={t.title}>
                        {t.localOnly ? (
                          <span className="pg-local-key" title="Local milestone">
                            ★ MS
                          </span>
                        ) : t.pendingCreate ? (
                          <span className="pg-draft-key" title="Draft — Push to create in Jira">
                            NEW
                          </span>
                        ) : (
                          <a
                            href={`${jiraBaseUrl}/browse/${t.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.id}
                          </a>
                        )}
                        {t.title}
                      </span>
                      <TaskWarnIcons task={t} />
                    </div>
                    {taskDetailsOpen && (
                      <RowDetails title={t.title}>
                        <span className="pg-owner">{taskMeta}</span>
                        {taskBlockers.length ? (
                          <span className="pg-prereq-hint">{taskBlockers.join(", ")}</span>
                        ) : null}
                      </RowDetails>
                    )}
                    <div className="pg-name-actions">
                      <DetailsToggle
                        open={taskDetailsOpen}
                        onToggle={() =>
                          setDetailsRow(taskDetailsOpen ? null : `task-${t.id}`)
                        }
                      />
                      {!t.localOnly && (
                        <button
                          type="button"
                          className={`pg-hide-toggle${t.hidden ? " on" : ""}`}
                          title={t.hidden ? "Show task in timeline" : "Hide task from timeline"}
                          aria-label={t.hidden ? "Show task" : "Hide task"}
                          aria-pressed={!!t.hidden}
                          onClick={() => onToggleHidden(t.id)}
                        >
                          {t.hidden ? "◉" : "◎"}
                        </button>
                      )}
                      {t.localOnly ? (
                        <button
                          type="button"
                          className="pg-local-delete"
                          title="Delete local milestone"
                          aria-label="Delete local milestone"
                          onClick={() => onDeleteLocalMilestone(t.id)}
                        >
                          ×
                        </button>
                      ) : t.pendingCreate ? (
                        <button
                          type="button"
                          className="pg-local-delete"
                          title="Delete draft task"
                          aria-label="Delete draft task"
                          onClick={() => onDeleteDraftTask(t.id)}
                        >
                          ×
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`pg-marker-toggle${t.isMarker ? " on" : ""}`}
                          title={
                            t.isMarker
                              ? "Milestone marker — click to make it a normal bar"
                              : "Mark as milestone (red star, no duration)"
                          }
                          aria-label="Toggle milestone marker"
                          aria-pressed={!!t.isMarker}
                          onClick={() => onToggleMarker(t.id)}
                        >
                          {t.isMarker ? "★" : "☆"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="pg-col-start">
                    <input
                      className="pg-input"
                      type="date"
                      value={t.start || ""}
                      disabled={readOnly}
                      onChange={(e) => {
                        const startVal = e.target.value || null;
                        const due = startVal
                          ? dueFromStartDuration(startVal, t.durationDays, holidaysOn)
                          : t.due;
                        onScheduleEdit(t.id, { start: startVal, due });
                      }}
                    />
                  </div>
                  <div className="pg-col-dur">
                    {t.isMarker || t.localOnly ? (
                      <span className="pg-dur-milestone" title="Milestone (no duration)">
                        ★
                      </span>
                    ) : (
                      <>
                        <input
                          className="pg-input dur"
                          type="number"
                          min={1}
                          placeholder="—"
                          disabled={readOnly}
                          title={
                            t.estDays == null ? "No Story Points in Jira" : "Story Points (Dur)"
                          }
                          value={t.estDays ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              onScheduleEdit(t.id, { estDays: null });
                              return;
                            }
                            const durationDays = Math.max(1, Number(raw) || 1);
                            const due = t.start
                              ? dueFromStartDuration(t.start, durationDays, holidaysOn)
                              : t.due;
                            onScheduleEdit(t.id, {
                              durationDays,
                              due,
                              estDays: durationDays,
                            });
                          }}
                        />
                        <span className="pg-dur-suffix">d</span>
                      </>
                    )}
                  </div>
                  <div className="pg-col-status">
                    {t.localOnly ? (
                      <span className="pg-status-pill local" title="Local only — not in Jira">
                        Local
                      </span>
                    ) : t.pendingCreate ? (
                      <span className="pg-status-pill draft" title="Draft — Push to create in Jira">
                        Draft
                      </span>
                    ) : (
                      <StatusSelect
                        issueKey={t.id}
                        status={t.status}
                        pulledStatus={t.pulledStatus || t.status}
                        transitionId={t.transitionId}
                        durationDays={t.durationDays}
                        timeSpent={t.timeSpent}
                        disabled={readOnly}
                        onChange={(next) => onStatusEdit(t.id, next)}
                      />
                    )}
                  </div>
                  <div className="pg-col-res">
                    {t.localOnly ? (
                      <span className="pg-assign-empty" title="Local milestone">
                        ★
                      </span>
                    ) : (
                      <AssignMenu
                        resources={model.resources}
                        selected={t.resourceIds}
                        pulledSelected={t.pulledResourceIds ?? t.resourceIds}
                        disabled={readOnly}
                        issueKey={t.id}
                        onChange={(resourceId) => onResourceEdit(t.id, resourceId)}
                      />
                    )}
                  </div>
                </div>
                <div
                  className={`pg-track${canPlace ? " placeable" : ""}`}
                  style={{ width: trackW, minHeight: ROW_H }}
                  onPointerMove={
                    canPlace
                      ? (e) => {
                          const start = startFromTrackPointer(e, e.currentTarget);
                          if (!start) {
                            setPlaceHover(null);
                            return;
                          }
                          if (placeHover?.taskId !== t.id || placeHover.start !== start) {
                            setPlaceHover({ taskId: t.id, start });
                          }
                        }
                      : undefined
                  }
                  onPointerLeave={
                    canPlace
                      ? () => {
                          if (placeHover?.taskId === t.id) setPlaceHover(null);
                        }
                      : undefined
                  }
                  onClick={
                    canPlace
                      ? (e) => {
                          const start = startFromTrackPointer(e, e.currentTarget);
                          if (start) placeStartOnTask(t, start);
                        }
                      : undefined
                  }
                >
                  <Bands days={days} dayWidth={dayWidth} />
                  <Markers
                    todayLeft={todayLeft}
                    projStartLeft={projStartLeft}
                    projEndLeft={projEndLeft}
                  />
                  {placeGhost && (
                    <div
                      className="pg-bar pg-bar-ghost"
                      style={{
                        left: placeGhost.left,
                        width: placeGhost.width,
                        background: colorForTask(t),
                      }}
                      title={`Click to set start ${placeHover!.start}`}
                    >
                      <span className="pg-bar-label">{t.friendlyId}</span>
                      <span className="pg-bar-ghost-hint">Set {placeHover!.start}</span>
                    </div>
                  )}
                  {(() => {
                    const hg = historyGhostForTask(
                      t,
                      historyOverlay,
                      compareDate,
                      days,
                      holidaysOn,
                      dayWidth,
                    );
                    if (!hg) return null;
                    return (
                      <div
                        className="pg-bar pg-bar-history-ghost"
                        style={{
                          left: hg.geo.left,
                          width: hg.geo.width,
                          background: colorForTask(t),
                        }}
                        title={hg.title}
                      />
                    );
                  })()}
                  {!inHiddenFolder && t.isMarker ? (
                    (() => {
                      const md = t.start || t.due;
                      const mx = md ? markerLeft(days, md, dayWidth) : null;
                      if (mx == null) return null;
                      return (
                        <div
                          className={`pg-milestone-star${
                            drag?.taskId === t.id ? " dragging" : ""
                          }`}
                          style={{ left: mx }}
                          title={`Milestone: ${t.title} · ${md}`}
                          onPointerDown={(e) => {
                            if (!t.start) return;
                            beginDrag(
                              {
                                kind: "move",
                                taskId: t.id,
                                startX: e.clientX,
                                origStart: t.start,
                                durationDays: t.durationDays,
                                lastStart: t.start,
                              },
                              e,
                            );
                          }}
                        >
                          <span className="pg-milestone-star-icon">★</span>
                          <span className="pg-milestone-star-name">{t.title}</span>
                        </div>
                      );
                    })()
                  ) : !inHiddenFolder && geo ? (
                    <div
                      className={`pg-bar${
                        isOverdue(t) ? " overdue" : ""
                      }${isStartLate(t) ? " start-late" : ""}${
                        isDoneStatus(t.status) ? " done" : ""
                      }${
                        drag?.taskId === t.id
                          ? drag.kind === "resize"
                            ? " resizing"
                            : " dragging"
                          : ""
                      }`}
                      style={{
                        left: geo.left,
                        width: geo.width,
                        background: colorForTask(t),
                      }}
                      title={
                        isDoneStatus(t.status)
                          ? `Done — ${t.status}`
                          : isOverdue(t) && t.due
                            ? `Overdue — due ${t.due}`
                            : isStartLate(t)
                              ? `Should have started ${t.start} — still “${t.status}”`
                              : undefined
                      }
                      onPointerDown={(e) => {
                        if (!t.start) return;
                        beginDrag(
                          {
                            kind: "move",
                            taskId: t.id,
                            startX: e.clientX,
                            origStart: t.start,
                            durationDays: t.durationDays,
                            lastStart: t.start,
                          },
                          e,
                        );
                      }}
                    >
                      <span className="pg-bar-label">{t.friendlyId}</span>
                      {isOverdue(t) ? (
                        <span className="pg-bar-overdue" aria-hidden>
                          !
                        </span>
                      ) : isStartLate(t) ? (
                        <span className="pg-bar-start-late" aria-hidden>
                          S
                        </span>
                      ) : null}
                      <span
                        className="pg-bar-handle"
                        onPointerDown={(e) => {
                          if (!t.start) return;
                          beginDrag(
                            {
                              kind: "resize",
                              taskId: t.id,
                              startX: e.clientX,
                              origDuration: t.durationDays,
                              origStart: t.start,
                              lastDuration: t.durationDays,
                            },
                            e,
                          );
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {model.showDeps && depPaths.length > 0 && (
            <svg
              className="pg-deps-svg"
              width={trackW}
              height={canvasH}
              style={{ left: leftW, top: 0 }}
            >
              <defs>
                <marker
                  id="dep-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="9"
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path className="pg-dep-arrow" d="M1.5,1.5 L9,5 L1.5,8.5 Z" />
                </marker>
              </defs>
              {depPaths.map((p, i) => (
                <g key={i}>
                  <circle className="pg-dep-dot" cx={p.x1} cy={p.y1} r={2.2} />
                  <path className="pg-dep-path" d={p.d} markerEnd="url(#dep-arrow)" />
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>

      {!preview && (
        <>
          <div
            className={`pg-split-y${resDockCollapsed ? " collapsed" : ""}`}
            title={
              resDockCollapsed
                ? "Resources minimized"
                : "Drag to resize Resources panel"
            }
            onPointerDown={(e) => {
              if (resDockCollapsed) return;
              dockResize.begin(e, resDockH);
            }}
          >
            <span>Resources{resDockCollapsed ? " · minimized" : " · drag to resize"}</span>
            <button
              type="button"
              className="pg-dock-toggle"
              title={resDockCollapsed ? "Expand Resources" : "Minimize Resources"}
              aria-label={resDockCollapsed ? "Expand Resources" : "Minimize Resources"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                onLayoutChange({ resourcesDockCollapsed: !resDockCollapsed })
              }
            >
              {resDockCollapsed ? "▴ Expand" : "▾ Minimize"}
            </button>
          </div>

          {!resDockCollapsed && (
            <div
              className="pg-resources-dock"
              ref={resScrollRef}
              onScroll={() => syncHorizontal("res")}
              style={{ height: resDockH, maxHeight: "none" }}
            >
              <div className="pg-canvas">
                <ResourcesPane model={model} days={days} dayWidth={dayWidth} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Bands({
  days,
  dayWidth,
}: {
  days: ReturnType<typeof buildDays>;
  dayWidth: number;
}) {
  return (
    <>
      {days.map((d, i) =>
        d.isWeekend ? (
          <div
            key={`w-${d.ymd}`}
            className="pg-weekend-band"
            style={{ left: i * dayWidth, width: dayWidth }}
          />
        ) : d.isHoliday ? (
          <div
            key={`h-${d.ymd}`}
            className="pg-holiday-band"
            style={{ left: i * dayWidth, width: dayWidth }}
            title={d.holidayLabel || undefined}
          />
        ) : null,
      )}
    </>
  );
}

function Markers({
  todayLeft,
  projStartLeft,
  projEndLeft,
}: {
  todayLeft: number | null;
  projStartLeft: number | null;
  projEndLeft: number | null;
}) {
  return (
    <>
      {projStartLeft != null && (
        <div className="pg-marker" style={{ left: projStartLeft }}>
          <span className="pg-marker-label">Start</span>
        </div>
      )}
      {projEndLeft != null && (
        <div className="pg-marker end" style={{ left: projEndLeft }}>
          <span className="pg-marker-label">End</span>
        </div>
      )}
      {todayLeft != null && (
        <div className="pg-marker today" style={{ left: todayLeft }}>
          <span className="pg-marker-label">Today</span>
        </div>
      )}
    </>
  );
}
