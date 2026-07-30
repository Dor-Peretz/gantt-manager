import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ScrollState } from "../api";
import type { GanttModel, GanttTask } from "../lib/types";
import { UNASSIGNED_COLOR } from "../lib/types";
import {
  dueFromStartDuration,
  firstWorkingDay,
  formatYmd,
  parseYmd,
} from "../lib/workdays";
import { AssignMenu } from "./AssignMenu";
import { EpicColorPicker } from "./EpicColorPicker";
import { ResourcesPane } from "./ResourcesPane";
import { StatusSelect } from "./StatusSelect";
import {
  ROW_H,
  barGeometry,
  buildDays,
  buildRows,
  isEpicSelfTask,
  markerLeft,
  milestoneSpan,
  projectEndYmd,
  rangeBounds,
  todayYmd,
} from "./timeline";
import { useDragResize } from "./useDragResize";

const LEFT_MIN = 360;
const LEFT_MAX = 960;
const RES_DOCK_MIN = 96;
const RES_DOCK_MAX = 560;
const DAY_W_MIN = 18;
const DAY_W_MAX = 48;
/** # + Start + Dur + Status + Res (name column gets the rest) */
const LEFT_FIXED_OTHER = 48 + 108 + 78 + 108 + 100;

interface Props {
  model: GanttModel;
  jiraBaseUrl: string;
  initialScroll?: ScrollState | null;
  onScheduleEdit: (taskId: string, patch: Partial<GanttTask>) => void;
  onStatusEdit: (
    taskId: string,
    next: { status: string; transitionId: string | null },
  ) => void;
  onToggleCollapse: (milestoneId: string) => void;
  onMilestoneColorChange: (milestoneId: string, color: string) => void;
  onLayoutChange: (patch: Partial<GanttModel>) => void;
  onScrollChange?: (scroll: ScrollState) => void;
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
  onScheduleEdit,
  onStatusEdit,
  onToggleCollapse,
  onMilestoneColorChange,
  onLayoutChange,
  onScrollChange,
}: Props) {
  const holidaysOn = model.showHolidays;
  const dayWidth = model.dayWidthPx || 28;
  const leftW = model.leftPanelWidth || 680;
  const resDockH = model.resourcesDockHeight || 220;
  const nameW = Math.max(120, leftW - LEFT_FIXED_OTHER);
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
    min: DAY_W_MIN,
    max: DAY_W_MAX,
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
  const rows = useMemo(() => buildRows(model.milestones), [model.milestones]);
  const trackW = days.length * dayWidth;
  const canvasH = 52 + rows.length * ROW_H;

  const today = todayYmd();
  const todayLeft = markerLeft(days, today, dayWidth);
  const projStartLeft = markerLeft(days, model.projectStart, dayWidth);
  const projEnd = projectEndYmd(model.milestones, holidaysOn);
  const projEndLeft = projEnd ? markerLeft(days, projEnd, dayWidth) : null;

  const [drag, setDrag] = useState<DragMode>(null);
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
    if (!model.showDeps) return [] as Array<{ d: string; color: string }>;
    const paths: Array<{ d: string; color: string }> = [];
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
        const mid = (x1 + x2) / 2;
        paths.push({
          d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
          color: r.milestone.color,
        });
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
  } as React.CSSProperties;

  return (
    <div className="pg-shell" style={shellStyle}>
      <div
        className="pg-scroll"
        ref={tasksScrollRef}
        onScroll={() => syncHorizontal("tasks")}
        style={{ flex: "1 1 auto", minHeight: 120, maxHeight: "none" }}
      >
        <div className="pg-canvas" style={{ minHeight: canvasH }}>
          {/* Header */}
          <div className="pg-row pg-head">
            <div className="pg-fixed">
              <div className="pg-col-num">#</div>
              <div className="pg-col-name">
                <span className="pg-name-text" style={{ fontWeight: 700, color: "var(--muted)" }}>
                  Name
                </span>
              </div>
              <div className="pg-col-start" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                Start
              </div>
              <div className="pg-col-dur" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                Dur
              </div>
              <div className="pg-col-status" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                Status
              </div>
              <div className="pg-col-res" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                Res
              </div>
              <div
                className="pg-resize-x"
                title="Drag to resize left panel"
                onPointerDown={(e) => leftResize.begin(e, leftW)}
              />
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
                <div
                  className="pg-resize-day"
                  title="Drag to zoom day width"
                  onPointerDown={(e) => dayResize.begin(e, dayWidth)}
                />
              </div>
            </div>
          </div>

          {/* Body rows */}
          {rows.map((r) => {
            if (r.kind === "milestone") {
              const epicSelf = r.milestone.tasks.find((t) =>
                isEpicSelfTask(r.milestone.id, t),
              );
              const childCount = r.milestone.tasks.filter(
                (t) => !isEpicSelfTask(r.milestone.id, t),
              ).length;
              const span = milestoneSpan(r.milestone, holidaysOn);
              // Use calendar-day bar for multi-task milestone summary; workday bar for epic self.
              const msGeo = epicSelf?.start
                ? barGeometry(
                    days,
                    epicSelf.start,
                    epicSelf.durationDays,
                    holidaysOn,
                    dayWidth,
                  )
                : span
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
              return (
                <div
                  className={`pg-row milestone${epicSelf?.dirty ? " dirty" : ""}`}
                  key={`ms-${r.milestone.id}`}
                >
                  <div className="pg-fixed">
                    <div className="pg-col-num">
                      {childCount}
                      {epicSelf?.dirty ? (
                        <span className="pg-dirty-dot" title="Unpushed change" />
                      ) : null}
                    </div>
                    <div className="pg-col-name">
                      {childCount > 0 ? (
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
                      <EpicColorPicker
                        epicKey={r.milestone.id}
                        color={r.milestone.color}
                        onChange={(color) =>
                          onMilestoneColorChange(r.milestone.id, color)
                        }
                      />
                      <div className="pg-name-stack">
                        <span className="pg-name-text" style={{ fontWeight: 700 }}>
                          <a
                            href={`${jiraBaseUrl}/browse/${r.milestone.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.milestone.id}
                          </a>
                          {r.milestone.title}
                        </span>
                        {epicSelf && (
                          <span className="pg-owner">
                            {epicSelf.assignee ? `${epicSelf.assignee} · ` : ""}
                            {epicSelf.estDays != null ? `Est ${epicSelf.estDays}sp` : ""}
                            {epicSelf.owner && epicSelf.owner !== "—"
                              ? `${epicSelf.estDays != null ? " · " : ""}${epicSelf.owner}`
                              : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {epicSelf ? (
                      <>
                        <div className="pg-col-start">
                          <input
                            className="pg-input"
                            type="date"
                            value={epicSelf.start || ""}
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
                            value={epicSelf.durationDays}
                            onChange={(e) => {
                              const durationDays = Math.max(1, Number(e.target.value) || 1);
                              const due = epicSelf.start
                                ? dueFromStartDuration(
                                    epicSelf.start,
                                    durationDays,
                                    holidaysOn,
                                  )
                                : epicSelf.due;
                              onScheduleEdit(epicSelf.id, { durationDays, due });
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
                            onChange={(next) => onStatusEdit(epicSelf.id, next)}
                          />
                        </div>
                        <div className="pg-col-res">
                          <AssignMenu
                            resources={model.resources}
                            selected={epicSelf.resourceIds}
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
                  <div className="pg-track" style={{ width: trackW, minHeight: ROW_H }}>
                    <Bands days={days} dayWidth={dayWidth} />
                    <Markers
                      todayLeft={todayLeft}
                      projStartLeft={projStartLeft}
                      projEndLeft={projEndLeft}
                    />
                    {msGeo && (
                      <div
                        className={`pg-bar milestone-bar${
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
                        {epicSelf && (
                          <>
                            <span className="pg-bar-label">
                              {epicSelf.estDays != null
                                ? `${epicSelf.estDays}sp`
                                : r.milestone.id}
                            </span>
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
                    )}
                  </div>
                </div>
              );
            }

            const t = r.task!;
            const geo =
              t.start &&
              barGeometry(days, t.start, t.durationDays, holidaysOn, dayWidth);

            return (
              <div className={`pg-row task${t.dirty ? " dirty" : ""}`} key={t.id}>
                <div className="pg-fixed">
                  <div className="pg-col-num">
                    {t.friendlyId}
                    {t.dirty ? <span className="pg-dirty-dot" title="Unpushed change" /> : null}
                  </div>
                  <div className="pg-col-name indented">
                    <span
                      className="pg-bullet"
                      style={{ background: colorForTask(t) }}
                    />
                    <div className="pg-name-stack">
                      <span className="pg-name-text">
                        <a
                          href={`${jiraBaseUrl}/browse/${t.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.id}
                        </a>
                        {t.title}
                      </span>
                      <span className="pg-owner">
                        {t.assignee ? `${t.assignee} · ` : ""}
                        {t.owner}
                      </span>
                      {t.blockedBy.length > 0 && (
                        <span className="pg-prereq-hint">{t.blockedBy.join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="pg-col-start">
                    <input
                      className="pg-input"
                      type="date"
                      value={t.start || ""}
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
                    <input
                      className="pg-input dur"
                      type="number"
                      min={1}
                      value={t.durationDays}
                      onChange={(e) => {
                        const durationDays = Math.max(1, Number(e.target.value) || 1);
                        const due = t.start
                          ? dueFromStartDuration(t.start, durationDays, holidaysOn)
                          : t.due;
                        onScheduleEdit(t.id, { durationDays, due });
                      }}
                    />
                    <span className="pg-dur-suffix">d</span>
                  </div>
                  <div className="pg-col-status">
                    <StatusSelect
                      issueKey={t.id}
                      status={t.status}
                      pulledStatus={t.pulledStatus || t.status}
                      transitionId={t.transitionId}
                      onChange={(next) => onStatusEdit(t.id, next)}
                    />
                  </div>
                  <div className="pg-col-res">
                    <AssignMenu resources={model.resources} selected={t.resourceIds} />
                  </div>
                </div>
                <div className="pg-track" style={{ width: trackW, minHeight: ROW_H }}>
                  <Bands days={days} dayWidth={dayWidth} />
                  <Markers
                    todayLeft={todayLeft}
                    projStartLeft={projStartLeft}
                    projEndLeft={projEndLeft}
                  />
                  {geo && (
                    <div
                      className={`pg-bar${drag?.taskId === t.id ? (drag.kind === "resize" ? " resizing" : " dragging") : ""}`}
                      style={{
                        left: geo.left,
                        width: geo.width,
                        background: colorForTask(t),
                      }}
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
                  )}
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
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
                </marker>
              </defs>
              {depPaths.map((p, i) => (
                <path
                  key={i}
                  d={p.d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={1.5}
                  opacity={0.75}
                  markerEnd="url(#arrow)"
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      <div
        className="pg-split-y"
        title="Drag to resize Resources panel"
        onPointerDown={(e) => dockResize.begin(e, resDockH)}
      >
        <span>Resources · drag to resize</span>
      </div>

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
