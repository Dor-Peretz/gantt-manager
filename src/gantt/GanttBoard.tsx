import { useMemo, useRef, useState } from "react";
import type { GanttModel, GanttTask, Resource } from "../lib/types";
import {
  dueFromStartDuration,
  firstWorkingDay,
  formatYmd,
  parseYmd,
} from "../lib/workdays";
import { AssignMenu } from "./AssignMenu";
import { ResourcesPane } from "./ResourcesPane";
import {
  ROW_H,
  barGeometry,
  buildDays,
  buildRows,
  markerLeft,
  milestoneSpan,
  projectEndYmd,
  rangeBounds,
  todayYmd,
} from "./timeline";

interface Props {
  model: GanttModel;
  jiraBaseUrl: string;
  onModelChange: (next: GanttModel) => void;
  onScheduleEdit: (taskId: string, patch: Partial<GanttTask>) => void;
  onToggleCollapse: (milestoneId: string) => void;
  onAllocations: (taskId: string, resourceIds: string[]) => void;
  onAddResource: (r: Resource) => void;
  onRemoveResource: (id: string) => void;
}

type DragMode =
  | { kind: "move"; taskId: string; startX: number; origStart: string }
  | { kind: "resize"; taskId: string; startX: number; origDuration: number; origStart: string }
  | null;

export function GanttBoard({
  model,
  jiraBaseUrl,
  onScheduleEdit,
  onToggleCollapse,
  onAllocations,
  onAddResource,
  onRemoveResource,
}: Props) {
  const holidaysOn = model.showHolidays;
  const dayWidth = model.dayWidthPx || 28;
  const leftW = model.leftPanelWidth || 680;
  const nameW = Math.max(120, leftW - 322);

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
  dragRef.current = drag;

  const taskById = useMemo(() => {
    const m = new Map<string, GanttTask>();
    for (const ms of model.milestones) for (const t of ms.tasks) m.set(t.id, t);
    return m;
  }, [model.milestones]);

  function applyDrag(clientX: number) {
    const d = dragRef.current;
    if (!d) return;
    const dx = clientX - d.startX;
    if (d.kind === "move") {
      const daysShift = Math.round(dx / dayWidth);
      let next = formatYmd(parseYmd(d.origStart));
      // shift by calendar days, then snap to working day
      next = formatYmd(
        firstWorkingDay(
          new Date(
            parseYmd(d.origStart).getFullYear(),
            parseYmd(d.origStart).getMonth(),
            parseYmd(d.origStart).getDate() + daysShift,
          ),
          holidaysOn,
        ),
      );
      const task = taskById.get(d.taskId);
      if (!task || next === task.start) return;
      const due = dueFromStartDuration(next, task.durationDays, holidaysOn);
      onScheduleEdit(d.taskId, { start: next, due });
    } else {
      const delta = Math.round(dx / dayWidth);
      const nextDur = Math.max(1, d.origDuration + delta);
      const task = taskById.get(d.taskId);
      if (!task || nextDur === task.durationDays) return;
      const due = dueFromStartDuration(d.origStart, nextDur, holidaysOn);
      onScheduleEdit(d.taskId, { durationDays: nextDur, due });
    }
  }

  function endDrag() {
    setDrag(null);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  function onMove(e: PointerEvent) {
    applyDrag(e.clientX);
  }
  function onUp() {
    endDrag();
  }

  function beginDrag(mode: NonNullable<DragMode>) {
    setDrag(mode);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

  return (
    <div
      className="pg-shell"
      style={
        {
          ["--day-w" as string]: `${dayWidth}px`,
          ["--left-w" as string]: `${leftW}px`,
          ["--name-w" as string]: `${nameW}px`,
        } as React.CSSProperties
      }
    >
      <div className="pg-scroll">
        <div className="pg-canvas" style={{ minHeight: canvasH + model.resources.length * ROW_H + 56 }}>
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
              <div className="pg-col-res" style={{ fontWeight: 700, color: "var(--muted)", fontSize: 11 }}>
                Res
              </div>
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
                      {d.dow}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Body rows */}
          {rows.map((r) => {
            if (r.kind === "milestone") {
              const span = milestoneSpan(r.milestone, holidaysOn);
              const geo =
                span &&
                barGeometry(
                  days,
                  span.start,
                  // approximate calendar span as duration via geometry from start->end
                  Math.max(
                    1,
                    Math.round(
                      (parseYmd(span.end).getTime() - parseYmd(span.start).getTime()) / 86400000,
                    ) + 1,
                  ),
                  false,
                  dayWidth,
                );
              // Use calendar-day bar for milestone summary (don't skip weekends in geometry)
              const msGeo = span
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
              void geo;
              return (
                <div className="pg-row milestone" key={`ms-${r.milestone.id}`}>
                  <div className="pg-fixed">
                    <div className="pg-col-num">{r.milestone.tasks.length}</div>
                    <div className="pg-col-name">
                      <button
                        type="button"
                        className="pg-toggle"
                        onClick={() => onToggleCollapse(r.milestone.id)}
                        aria-label="Toggle"
                      >
                        {r.milestone.collapsed ? "▸" : "▾"}
                      </button>
                      <span
                        className="pg-bullet"
                        style={{ background: r.milestone.color, marginTop: 5 }}
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
                      </div>
                    </div>
                    <div className="pg-col-start" />
                    <div className="pg-col-dur" />
                    <div className="pg-col-res" />
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
                        className="pg-bar milestone-bar"
                        style={{
                          left: msGeo.left,
                          width: msGeo.width,
                          background: r.milestone.color,
                        }}
                      />
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
                      style={{ background: r.milestone.color }}
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
                        {t.status ? ` · ${t.status}` : ""}
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
                  <div className="pg-col-res">
                    <AssignMenu
                      resources={model.resources}
                      selected={t.resourceIds}
                      onChange={(ids) => onAllocations(t.id, ids)}
                    />
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
                        background: r.milestone.color,
                      }}
                      onPointerDown={(e) => {
                        if (!t.start) return;
                        e.preventDefault();
                        beginDrag({
                          kind: "move",
                          taskId: t.id,
                          startX: e.clientX,
                          origStart: t.start,
                        });
                      }}
                    >
                      <span className="pg-bar-label">{t.friendlyId}</span>
                      <span
                        className="pg-bar-handle"
                        onPointerDown={(e) => {
                          if (!t.start) return;
                          e.preventDefault();
                          e.stopPropagation();
                          beginDrag({
                            kind: "resize",
                            taskId: t.id,
                            startX: e.clientX,
                            origDuration: t.durationDays,
                            origStart: t.start,
                          });
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

          <ResourcesPane
            model={model}
            days={days}
            dayWidth={dayWidth}
            onAddResource={onAddResource}
            onRemoveResource={onRemoveResource}
          />
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
