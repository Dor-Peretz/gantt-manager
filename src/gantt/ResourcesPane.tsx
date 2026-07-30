import { useState } from "react";
import type { GanttModel, Resource } from "../lib/types";
import { DEFAULT_COLORS } from "../lib/types";
import { initialsFromName, isNonWorking, parseYmd, taskEnd } from "../lib/workdays";
import type { DayCol } from "./timeline";

interface Props {
  model: GanttModel;
  days: DayCol[];
  dayWidth: number;
  onAddResource: (r: Resource) => void;
  onRemoveResource: (id: string) => void;
}

function hoursForResource(
  model: GanttModel,
  resourceId: string,
  ymd: string,
  holidaysOn: boolean,
  hoursPerDay: number,
): number {
  let hours = 0;
  const day = parseYmd(ymd);
  if (isNonWorking(day, holidaysOn)) return 0;
  for (const m of model.milestones) {
    for (const t of m.tasks) {
      if (!t.start || !t.resourceIds.includes(resourceId)) continue;
      const end = taskEnd(t.start, t.durationDays, holidaysOn);
      const s = parseYmd(t.start);
      if (day >= s && day <= end && !isNonWorking(day, holidaysOn)) {
        hours += hoursPerDay;
      }
    }
  }
  return hours;
}

export function ResourcesPane({
  model,
  days,
  dayWidth,
  onAddResource,
  onRemoveResource,
}: Props) {
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const holidaysOn = model.showHolidays;
  const trackW = days.length * dayWidth;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const color = DEFAULT_COLORS[model.resources.length % DEFAULT_COLORS.length];
    onAddResource({
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: n,
      team: team.trim(),
      color,
      initials: initialsFromName(n),
    });
    setName("");
    setTeam("");
  }

  return (
    <>
      <div className="pg-row pg-res-sep-row">
        <div className="pg-fixed">
          <span className="pg-res-title">Resources</span>
          <form className="res-form" onSubmit={submit}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dor Peretz" />
            </label>
            <label>
              Team
              <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Purchase Core" />
            </label>
            <button type="submit" className="gantt-btn">
              Add
            </button>
          </form>
        </div>
        <div className="pg-track" style={{ width: trackW }} />
      </div>

      {model.resources.map((r) => (
        <div className="pg-row" key={r.id}>
          <div className="pg-fixed" style={{ gap: 10, padding: "0 10px" }}>
            <span className="pg-avatar" style={{ background: r.color }}>
              {r.initials}
            </span>
            <div className="pg-name-stack">
              <span className="pg-name-text">{r.name}</span>
              <span className="pg-owner">{r.team || "—"}</span>
            </div>
            <button
              type="button"
              className="gantt-btn"
              style={{ marginLeft: "auto", padding: "4px 8px" }}
              onClick={() => onRemoveResource(r.id)}
              title="Remove resource"
            >
              ×
            </button>
          </div>
          <div className="pg-track" style={{ width: trackW }}>
            {days.map((d, i) => {
              const h = hoursForResource(model, r.id, d.ymd, holidaysOn, model.hoursPerDay);
              const off = d.isWeekend || d.isHoliday;
              let cls = "pg-hours-cell";
              if (off) cls += " off";
              else if (h > model.hoursPerDay) cls += " over";
              else if (h > 0) cls += " busy";
              return (
                <div
                  key={d.ymd}
                  className={cls}
                  style={{ left: i * dayWidth, width: dayWidth }}
                  title={`${d.ymd}: ${h}h${d.holidayLabel ? ` · ${d.holidayLabel}` : ""}`}
                >
                  {!off && h > 0 ? h : ""}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
