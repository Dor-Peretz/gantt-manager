import type { GanttModel } from "../lib/types";
import { isNonWorking, parseYmd, taskEnd } from "../lib/workdays";
import { ResourceAvatar } from "./ResourceAvatar";
import type { DayCol } from "./timeline";

interface Props {
  model: GanttModel;
  days: DayCol[];
  dayWidth: number;
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

export function ResourcesPane({ model, days, dayWidth }: Props) {
  const holidaysOn = model.showHolidays;
  const trackW = days.length * dayWidth;

  return (
    <>
      <div className="pg-row pg-res-sep-row">
        <div className="pg-fixed">
          <span className="pg-res-title">Resources</span>
          <span className="pg-owner" style={{ fontWeight: 600 }}>
            From Jira assignees · assign in the Res column, then Push
          </span>
        </div>
        <div className="pg-track" style={{ width: trackW }} />
      </div>

      {model.resources.length === 0 ? (
        <div className="pg-row">
          <div className="pg-fixed" style={{ padding: "8px 12px" }}>
            <span className="pg-owner">No assignees on pulled issues — assign people in Jira, then Pull again.</span>
          </div>
          <div className="pg-track" style={{ width: trackW }} />
        </div>
      ) : (
        model.resources.map((r) => (
          <div className="pg-row" key={r.id}>
            <div className="pg-fixed" style={{ gap: 10, padding: "0 10px" }}>
              <ResourceAvatar resource={r} />
              <div className="pg-name-stack">
                <span className="pg-name-text">{r.name}</span>
                <span className="pg-owner">{r.team || "Assignee"}</span>
              </div>
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
        ))
      )}
    </>
  );
}
