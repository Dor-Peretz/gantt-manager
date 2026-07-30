import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchConfig, fetchHealth, pullGantt, pushGantt, saveState } from "./api";
import { GanttBoard } from "./gantt/GanttBoard";
import type { GanttModel, GanttTask, PushResult, Resource } from "./lib/types";
import { emptyModel } from "./lib/types";
import { dueFromStartDuration } from "./lib/workdays";

export default function App() {
  const [model, setModel] = useState<GanttModel>(() => emptyModel());
  const [jql, setJql] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("https://sunbit.atlassian.net");
  const [health, setHealth] = useState<{ ok: boolean; site?: string; error?: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [status, setStatus] = useState("Ready");
  const [hint, setHint] = useState("Enter JQL and press Pull to load Jira tasks.");
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [cfg, h] = await Promise.all([fetchConfig(), fetchHealth()]);
        setJql(cfg.jql || "");
        if (cfg.baseUrl) setJiraBaseUrl(cfg.baseUrl.replace(/\/$/, ""));
        setModel((m) => ({ ...m, jql: cfg.jql || m.jql }));
        setHealth(h);
        if (!h.ok) setHint(h.error || "Jira auth not configured — fill in .env");
        else setHint(`Connected: ${h.site}`);
      } catch (err) {
        setHealth({ ok: false, error: err instanceof Error ? err.message : String(err) });
        setHint("Server not reachable. Run `npm run dev`.");
      }
    })();
  }, []);

  const dirtyTasks = useMemo(() => {
    const out: GanttTask[] = [];
    for (const m of model.milestones) for (const t of m.tasks) if (t.dirty) out.push(t);
    return out;
  }, [model.milestones]);

  const persistLocal = useCallback(
    async (next: GanttModel) => {
      const allocations: Record<string, string[]> = {};
      const collapsed: Record<string, boolean> = {};
      for (const m of next.milestones) {
        collapsed[m.id] = !!m.collapsed;
        for (const t of m.tasks) allocations[t.id] = t.resourceIds;
      }
      try {
        await saveState({
          resources: next.resources,
          allocations,
          collapsed,
          projectStart: next.projectStart,
          showHolidays: next.showHolidays,
          showDeps: next.showDeps,
          dayWidthPx: next.dayWidthPx,
          leftPanelWidth: next.leftPanelWidth,
          jql: next.jql,
        });
      } catch {
        /* non-fatal */
      }
    },
    [],
  );

  const updateModel = useCallback(
    (updater: (prev: GanttModel) => GanttModel) => {
      setModel((prev) => {
        const next = updater(prev);
        void persistLocal(next);
        return next;
      });
    },
    [persistLocal],
  );

  async function onPull() {
    setBusy("pull");
    setError(null);
    setPushResults(null);
    setStatus("Pulling from Jira…");
    try {
      const next = await pullGantt(jql.trim());
      setModel(next);
      setJql(next.jql);
      await persistLocal(next);
      const count = next.milestones.reduce((n, m) => n + m.tasks.length, 0);
      setStatus(`Pulled ${count} tasks · ${next.milestones.length} epics`);
      setHint(`Last pull ${new Date(next.pulledAt || Date.now()).toLocaleString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("Pull failed");
    } finally {
      setBusy(null);
    }
  }

  async function onPush() {
    if (!dirtyTasks.length) return;
    setBusy("push");
    setError(null);
    setStatus(`Pushing ${dirtyTasks.length} task(s)…`);
    try {
      const { results } = await pushGantt(
        dirtyTasks.map((t) => ({
          key: t.id,
          start: t.start,
          due: t.due,
          jiraUpdated: t.jiraUpdated,
        })),
      );
      setPushResults(results);
      updateModel((prev) => ({
        ...prev,
        milestones: prev.milestones.map((m) => ({
          ...m,
          tasks: m.tasks.map((t) => {
            const r = results.find((x) => x.key === t.id);
            if (!r) return t;
            if (r.status === "ok") {
              return { ...t, dirty: false, jiraUpdated: r.jiraUpdated || t.jiraUpdated };
            }
            return t;
          }),
        })),
      }));
      const ok = results.filter((r) => r.status === "ok").length;
      const conflicts = results.filter((r) => r.status === "conflict").length;
      const errors = results.filter((r) => r.status === "error").length;
      setStatus(`Push done · ${ok} ok · ${conflicts} conflict · ${errors} error`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("Push failed");
    } finally {
      setBusy(null);
    }
  }

  function onScheduleEdit(taskId: string, patch: Partial<GanttTask>) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const next = { ...t, ...patch, dirty: true };
          if (patch.start !== undefined || patch.durationDays !== undefined) {
            next.due = dueFromStartDuration(
              next.start,
              next.durationDays,
              prev.showHolidays,
            );
          }
          return next;
        }),
      })),
    }));
    setStatus("Unsaved schedule changes");
  }

  function onToggleCollapse(milestoneId: string) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) =>
        m.id === milestoneId ? { ...m, collapsed: !m.collapsed } : m,
      ),
    }));
  }

  function onAllocations(taskId: string, resourceIds: string[]) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => (t.id === taskId ? { ...t, resourceIds } : t)),
      })),
    }));
  }

  function onAddResource(r: Resource) {
    updateModel((prev) => ({ ...prev, resources: [...prev.resources, r] }));
  }

  function onRemoveResource(id: string) {
    updateModel((prev) => ({
      ...prev,
      resources: prev.resources.filter((r) => r.id !== id),
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => ({
          ...t,
          resourceIds: t.resourceIds.filter((x) => x !== id),
        })),
      })),
    }));
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gantt Manager</h1>
        <p className="sub">
          Jira is the source of truth. Pull tasks, plan the schedule, then Push Start date + Due
          date back.
        </p>
        <span className={`health ${health?.ok ? "ok" : "bad"}`}>
          {health == null ? "…" : health.ok ? "Jira connected" : "Jira offline"}
        </span>
      </header>

      <div className="pg-toolbar">
        <input
          className="pg-jql"
          value={jql}
          onChange={(e) => setJql(e.target.value)}
          placeholder='JQL — e.g. project = SBT AND parent = SBT-61018'
          spellCheck={false}
        />
        <button
          type="button"
          className="gantt-btn primary"
          disabled={busy !== null || !jql.trim()}
          onClick={() => void onPull()}
        >
          {busy === "pull" ? "Pulling…" : "Pull"}
        </button>
        <button
          type="button"
          className={`gantt-btn${dirtyTasks.length ? " warn" : ""}`}
          disabled={busy !== null || dirtyTasks.length === 0}
          onClick={() => void onPush()}
          title="Write Start date + Due date to Jira for dirty tasks"
        >
          {busy === "push" ? "Pushing…" : `Push${dirtyTasks.length ? ` (${dirtyTasks.length})` : ""}`}
        </button>
        <label className="pg-field">
          Project start
          <input
            type="date"
            value={model.projectStart}
            onChange={(e) =>
              updateModel((prev) => ({ ...prev, projectStart: e.target.value }))
            }
          />
        </label>
        <label className="pg-field pg-check" title="Israeli public holidays (0 hours when on)">
          <input
            type="checkbox"
            checked={model.showHolidays}
            onChange={(e) =>
              updateModel((prev) => ({ ...prev, showHolidays: e.target.checked }))
            }
          />
          IL holidays
        </label>
        <label className="pg-field pg-check" title="Prerequisite arrows from Jira Blocks links">
          <input
            type="checkbox"
            checked={model.showDeps}
            onChange={(e) => updateModel((prev) => ({ ...prev, showDeps: e.target.checked }))}
          />
          Prerequisites
        </label>
        <p className="hint">{hint}</p>
        <span className={`status${dirtyTasks.length ? " dirty" : ""}`}>{status}</span>
      </div>

      {error && (
        <div className="push-results">
          <strong className="error">Error:</strong> {error}
        </div>
      )}
      {pushResults && (
        <ul className="push-results">
          {pushResults.map((r) => (
            <li key={r.key} className={r.status}>
              {r.key}: {r.status}
              {r.message ? ` — ${r.message}` : ""}
            </li>
          ))}
        </ul>
      )}

      <GanttBoard
        model={model}
        jiraBaseUrl={jiraBaseUrl}
        onModelChange={setModel}
        onScheduleEdit={onScheduleEdit}
        onToggleCollapse={onToggleCollapse}
        onAllocations={onAllocations}
        onAddResource={onAddResource}
        onRemoveResource={onRemoveResource}
      />

      <div className="pg-legend">
        <span>
          <i className="m-start" /> Project start / end
        </span>
        <span>
          <i className="m-today" /> Today
        </span>
        <span>
          <i className="m-busy" /> Allocated hours
        </span>
        <span>
          <i className="m-over" /> Overbooked (&gt; 8h)
        </span>
        <span>
          <i className="m-off" /> Off (Fri–Sat)
        </span>
        <span>
          <i className="m-hol" /> IL holiday
        </span>
        <span>
          <i className="m-dep" /> Prerequisite
        </span>
        <span>Push writes only Start date + Due date to Jira</span>
      </div>
    </div>
  );
}
