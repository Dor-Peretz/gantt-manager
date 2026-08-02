import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConfig,
  fetchHealth,
  loadCache,
  pullGantt,
  pushGantt,
  saveCache,
  saveState,
  type ScrollState,
} from "./api";
import { BrandLockup } from "./brand/BrandMark";
import { AddMilestoneDialog } from "./gantt/AddMilestoneDialog";
import { AddTaskDialog } from "./gantt/AddTaskDialog";
import { ProjectOptionsPanel } from "./gantt/ProjectOptionsPanel";
import { GanttBoard } from "./gantt/GanttBoard";
import {
  collectDraftTasks,
  draftToTask,
  injectDraftTasks,
  newDraftTaskId,
} from "./lib/draftTasks";
import {
  collectLocalMarkers,
  injectLocalMarkers,
  localMarkerToMilestone,
  newLocalMarkerId,
} from "./lib/localMarkers";
import type {
  CustomNonWorkingDay,
  DraftTask,
  GanttModel,
  GanttTask,
  LocalMarker,
  LocalState,
  PushResult,
  ThemeMode,
} from "./lib/types";
import { emptyModel } from "./lib/types";
import { dueFromStartDuration, setCustomNonWorkingDays } from "./lib/workdays";

function assigneeAccountIdForPush(t: GanttTask): string | null | undefined {
  if (!t.assigneeDirty) return undefined;
  const id = t.resourceIds[0];
  if (!id) return null;
  if (!id.startsWith("jira:")) return undefined;
  return id.slice(5);
}

function isDoneLikeStatus(status: string | null | undefined): boolean {
  return /done|closed|resolved|complete|ship/i.test(status || "");
}

/** Actual time spent entered by the user for a Done transition. */
function timeSpentForPush(t: GanttTask): string | null {
  if (t.pendingCreate || !t.transitionId || !isDoneLikeStatus(t.status)) return null;
  const entered = t.timeSpent?.trim();
  return entered || null;
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
}

function countDirty(m: GanttModel): number {
  let n = 0;
  for (const ms of m.milestones)
    for (const t of ms.tasks) if (t.dirty && !t.localOnly) n++;
  return n;
}

function prefsFromModel(next: GanttModel, jqlOverride?: string): Partial<LocalState> {
  const allocations: Record<string, string[]> = {};
  const collapsed: Record<string, boolean> = {};
  const milestoneColors: Record<string, string> = {};
  const taskOrder: Record<string, string[]> = {};
  const markers: Record<string, boolean> = {};
  for (const m of next.milestones) {
    collapsed[m.id] = !!m.collapsed;
    milestoneColors[m.id] = m.color;
    taskOrder[m.id] = m.tasks.map((t) => t.id);
    for (const t of m.tasks) {
      if (t.localOnly) continue;
      allocations[t.id] = t.resourceIds;
      if (t.isMarker) markers[t.id] = true;
    }
  }
  return {
    resources: next.resources,
    allocations,
    collapsed,
    taskOrder,
    milestoneOrder: next.milestones.map((m) => m.id),
    markers,
    localMarkers: collectLocalMarkers(next),
    draftTasks: collectDraftTasks(next),
    milestoneColors,
    projectStart: next.projectStart,
    showHolidays: next.showHolidays,
    showDeps: next.showDeps,
    customNonWorkingDays: next.customNonWorkingDays,
    dayWidthPx: next.dayWidthPx,
    leftPanelWidth: next.leftPanelWidth,
    resourcesDockHeight: next.resourcesDockHeight,
    resourcesDockCollapsed: next.resourcesDockCollapsed,
    jql: jqlOverride ?? next.jql,
  };
}

/** Keep local unpushed schedule/status edits + epic colors/collapse when a fresh Pull arrives. */
function mergeDirtySchedule(fresh: GanttModel, previous: GanttModel): GanttModel {
  const dirtyById = new Map<string, GanttTask>();
  const prevById = new Map(previous.milestones.map((m) => [m.id, m]));
  for (const m of previous.milestones) {
    for (const t of m.tasks) if (t.dirty && !t.localOnly) dirtyById.set(t.id, t);
  }
  const merged: GanttModel = {
    ...fresh,
    customNonWorkingDays:
      fresh.customNonWorkingDays ?? previous.customNonWorkingDays ?? [],
    milestones: fresh.milestones.map((m) => {
      const prev = prevById.get(m.id);
      return {
        ...m,
        collapsed: prev?.collapsed ?? m.collapsed,
        color: prev?.color ?? m.color,
        tasks: m.tasks.map((t) => {
          const prevTask = prev?.tasks.find((p) => p.id === t.id);
          const isMarker = prevTask?.isMarker ?? t.isMarker;
          const d = dirtyById.get(t.id);
          if (!d) return { ...t, isMarker };
          return {
            ...t,
            isMarker,
            start: d.scheduleDirty ? d.start : t.start,
            due: d.scheduleDirty ? d.due : t.due,
            durationDays: d.scheduleDirty ? d.durationDays : t.durationDays,
            estDays: d.scheduleDirty ? d.estDays : t.estDays,
            status: d.statusDirty ? d.status : t.status,
            pulledStatus: t.pulledStatus || t.status,
            pulledStart: t.pulledStart ?? t.start,
            pulledDue: t.pulledDue ?? t.due,
            pulledDurationDays: t.pulledDurationDays ?? t.durationDays,
            pulledEstDays: t.pulledEstDays !== undefined ? t.pulledEstDays : t.estDays,
            transitionId: d.statusDirty ? d.transitionId ?? null : null,
            timeSpent: d.statusDirty ? d.timeSpent ?? null : null,
            resourceIds: d.assigneeDirty ? d.resourceIds : t.resourceIds,
            assignee: d.assigneeDirty ? d.assignee : t.assignee,
            pulledResourceIds: t.pulledResourceIds ?? t.resourceIds,
            scheduleDirty: !!d.scheduleDirty,
            statusDirty: !!d.statusDirty,
            assigneeDirty: !!d.assigneeDirty,
            dirty: !!(d.scheduleDirty || d.statusDirty || d.assigneeDirty),
            jiraUpdated: t.jiraUpdated,
          };
        }),
      };
    }),
  };
  const orderHint = previous.milestones.map((m) => m.id);
  let withLocals = injectLocalMarkers(
    merged,
    collectLocalMarkers(previous),
    orderHint,
  );
  withLocals = injectDraftTasks(withLocals, collectDraftTasks(previous));
  return withLocals;
}

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
  const [prefsSavedAt, setPrefsSavedAt] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [scroll, setScroll] = useState<ScrollState | null>(null);
  const jqlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  const scrollRef = useRef<ScrollState | null>(null);
  modelRef.current = model;
  scrollRef.current = scroll;
  const booted = useRef(false);

  const persistCache = useCallback((nextModel: GanttModel, nextScroll?: ScrollState | null) => {
    if (!nextModel.milestones.length) return;
    if (cacheTimer.current) clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      void saveCache({
        model: nextModel,
        scroll: nextScroll || scrollRef.current || { tasksLeft: 0, tasksTop: 0, resLeft: 0 },
        savedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }, 300);
  }, []);

  const persistLocal = useCallback(async (partial: Partial<LocalState>) => {
    try {
      await saveState(partial);
      setPrefsSavedAt(new Date().toLocaleTimeString());
    } catch {
      /* non-fatal */
    }
  }, []);

  const runPull = useCallback(
    async (
      jqlValue: string,
      opts?: {
        silent?: boolean;
        previous?: GanttModel;
        localMarkers?: LocalMarker[];
        draftTasks?: DraftTask[];
      },
    ) => {
      const q = jqlValue.trim();
      if (!q) return;
      setBusy("pull");
      setError(null);
      setPushResults(null);
      if (!opts?.silent) setStatus("Pulling from Jira…");
      try {
        let next = await pullGantt(q);
        if (opts?.previous) next = mergeDirtySchedule(next, opts.previous);
        else {
          if (opts?.localMarkers?.length) {
            next = injectLocalMarkers(
              next,
              opts.localMarkers,
              opts.localMarkers.map((m) => m.id),
            );
          }
          if (opts?.draftTasks?.length) {
            next = injectDraftTasks(next, opts.draftTasks);
          }
        }
        setModel(next);
        setJql(next.jql);
        await persistLocal(prefsFromModel(next, next.jql));
        persistCache(next, scrollRef.current);
        const count = next.milestones.reduce((n, m) => n + m.tasks.length, 0);
        const locals = collectLocalMarkers(next).length;
        const dirty = countDirty(next);
        setStatus(
          dirty
            ? `Pulled ${count} tasks · kept ${dirty} local edit(s)`
            : `Pulled ${count} tasks · ${next.milestones.length} epics${
                locals ? ` · ${locals} local milestone(s)` : ""
              }`,
        );
        setHint(`Last pull ${new Date(next.pulledAt || Date.now()).toLocaleString()}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("Pull failed");
      } finally {
        setBusy(null);
      }
    },
    [persistLocal, persistCache],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const [cfg, h, cache] = await Promise.all([
          fetchConfig(),
          fetchHealth(),
          loadCache(),
        ]);
        const prefs = cfg.preferences;
        const savedJql = prefs?.jql || cfg.jql || cache?.model.jql || "";
        const savedTheme: ThemeMode = prefs?.theme === "dark" ? "dark" : "light";
        setJql(savedJql);
        setTheme(savedTheme);
        applyTheme(savedTheme);
        if (cfg.baseUrl) setJiraBaseUrl(cfg.baseUrl.replace(/\/$/, ""));

        let restored: GanttModel | null = null;
        if (cache?.model?.milestones?.length) {
          restored = {
            ...cache.model,
            jql: savedJql || cache.model.jql,
            projectStart: prefs?.projectStart || cache.model.projectStart,
            showHolidays: prefs?.showHolidays !== false,
            showDeps: prefs?.showDeps !== false,
            customNonWorkingDays:
              prefs?.customNonWorkingDays ?? cache.model.customNonWorkingDays ?? [],
            dayWidthPx: prefs?.dayWidthPx || cache.model.dayWidthPx,
            leftPanelWidth: prefs?.leftPanelWidth || cache.model.leftPanelWidth,
            resourcesDockHeight:
              prefs?.resourcesDockHeight || cache.model.resourcesDockHeight || 220,
            resourcesDockCollapsed:
              prefs?.resourcesDockCollapsed ??
              cache.model.resourcesDockCollapsed ??
              false,
          };
          if (prefs?.localMarkers?.length) {
            restored = injectLocalMarkers(
              restored,
              prefs.localMarkers,
              prefs.milestoneOrder,
            );
          }
          if (prefs?.draftTasks?.length) {
            restored = injectDraftTasks(restored, prefs.draftTasks);
          }
          setModel(restored);
          if (cache.scroll) setScroll(cache.scroll);
          const count = restored.milestones.reduce((n, m) => n + m.tasks.length, 0);
          setStatus(`Restored ${count} tasks from last session`);
          setHint(
            cache.savedAt
              ? `Restored view from ${new Date(cache.savedAt).toLocaleString()}`
              : "Restored last session",
          );
        } else {
          setModel((m) => ({
            ...m,
            jql: savedJql,
            projectStart: prefs?.projectStart || m.projectStart,
            showHolidays: prefs?.showHolidays !== false,
            showDeps: prefs?.showDeps !== false,
            customNonWorkingDays: prefs?.customNonWorkingDays ?? [],
            dayWidthPx: prefs?.dayWidthPx || m.dayWidthPx,
            leftPanelWidth: prefs?.leftPanelWidth || m.leftPanelWidth,
            resourcesDockHeight: prefs?.resourcesDockHeight || m.resourcesDockHeight,
            resourcesDockCollapsed: prefs?.resourcesDockCollapsed ?? false,
            resources: prefs?.resources || [],
          }));
        }

        setHealth(h);
        if (!h.ok) {
          setHint(h.error || "Jira auth not configured — fill in .env");
          return;
        }

        if (savedJql) {
          const dirty = restored ? countDirty(restored) : 0;
          if (dirty > 0) {
            setHint(
              `Connected: ${h.site} · ${dirty} unpushed edit(s) — skipped auto-pull. Push or Pull manually.`,
            );
          } else {
            setHint(`Connected: ${h.site} · refreshing from Jira…`);
            await runPull(savedJql, {
              silent: true,
              previous: restored || undefined,
              localMarkers: prefs?.localMarkers,
              draftTasks: prefs?.draftTasks,
            });
          }
        } else {
          setHint(`Connected: ${h.site} · enter JQL and Pull`);
        }
      } catch (err) {
        setHealth({ ok: false, error: err instanceof Error ? err.message : String(err) });
        setHint("Server not reachable. Run `npm run dev`.");
      }
    })();
  }, [runPull]);

  const dirtyTasks = useMemo(() => {
    const out: GanttTask[] = [];
    for (const m of model.milestones)
      for (const t of m.tasks) if (t.dirty && !t.localOnly) out.push(t);
    return out;
  }, [model.milestones]);

  const [addMsOpen, setAddMsOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewChromeHidden, setPreviewChromeHidden] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    setCustomNonWorkingDays(model.customNonWorkingDays || []);
  }, [model.customNonWorkingDays]);

  useEffect(() => {
    if (!previewOpen) {
      setPreviewChromeHidden(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewChromeHidden) setPreviewChromeHidden(false);
        else setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen, previewChromeHidden]);

  function toggleTheme() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    void persistLocal({ theme: next });
  }

  const updateModel = useCallback(
    (updater: (prev: GanttModel) => GanttModel) => {
      setModel((prev) => {
        const next = updater(prev);
        void persistLocal(prefsFromModel(next, jql));
        persistCache(next, scrollRef.current);
        return next;
      });
    },
    [persistLocal, persistCache, jql],
  );

  function addCustomOffDay(date: string, name?: string) {
    updateModel((prev) => {
      const existing = prev.customNonWorkingDays || [];
      if (existing.some((d) => d.date === date)) return prev;
      const next: CustomNonWorkingDay[] = [
        ...existing,
        { date, name: name || undefined },
      ].sort((a, b) => a.date.localeCompare(b.date));
      return { ...prev, customNonWorkingDays: next };
    });
  }

  function removeCustomOffDay(date: string) {
    updateModel((prev) => ({
      ...prev,
      customNonWorkingDays: (prev.customNonWorkingDays || []).filter((d) => d.date !== date),
    }));
  }

  function onJqlChange(value: string) {
    setJql(value);
    setModel((m) => ({ ...m, jql: value }));
    if (jqlTimer.current) clearTimeout(jqlTimer.current);
    jqlTimer.current = setTimeout(() => {
      void persistLocal({ jql: value });
    }, 400);
  }

  async function onPull() {
    await runPull(jql, { previous: modelRef.current });
  }

  function onClearChanges() {
    if (!dirtyTasks.length) return;
    const drafts = dirtyTasks.filter((t) => t.pendingCreate).length;
    const edits = dirtyTasks.length - drafts;
    const msg =
      drafts && edits
        ? `Discard ${edits} unpushed edit(s) and ${drafts} draft task(s)?`
        : drafts
          ? `Discard ${drafts} draft task(s)?`
          : `Discard ${edits} unpushed edit(s)?`;
    if (!window.confirm(msg)) return;

    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks
          .filter((t) => !t.pendingCreate)
          .map((t) => {
            if (t.localOnly || !t.dirty) return t;
            const resourceIds = [...(t.pulledResourceIds ?? [])];
            const resource = resourceIds[0]
              ? prev.resources.find((r) => r.id === resourceIds[0])
              : null;
            return {
              ...t,
              start: t.pulledStart !== undefined ? t.pulledStart : t.start,
              due: t.pulledDue !== undefined ? t.pulledDue : t.due,
              durationDays: t.pulledDurationDays ?? t.durationDays,
              estDays: t.pulledEstDays !== undefined ? t.pulledEstDays : t.estDays,
              status: t.pulledStatus || t.status,
              transitionId: null,
              timeSpent: null,
              resourceIds,
              assignee: resource?.name ?? null,
              scheduleDirty: false,
              statusDirty: false,
              assigneeDirty: false,
              dirty: false,
            };
          }),
      })),
    }));
    setPushResults(null);
    setError(null);
    setStatus("Local changes cleared");
  }

  async function onPush() {
    if (!dirtyTasks.length) return;
    const missingTime = dirtyTasks.filter(
      (t) =>
        !t.pendingCreate &&
        t.transitionId &&
        isDoneLikeStatus(t.status) &&
        !t.timeSpent?.trim(),
    );
    if (missingTime.length) {
      setError(
        `Enter actual time spent for Done: ${missingTime.map((t) => t.id).join(", ")}`,
      );
      setStatus("Push blocked — actual time required for Done");
      return;
    }
    setBusy("push");
    setError(null);
    const creates = dirtyTasks.filter((t) => t.pendingCreate).length;
    setStatus(
      creates
        ? `Pushing ${dirtyTasks.length} item(s) · ${creates} create…`
        : `Pushing ${dirtyTasks.length} task(s)…`,
    );
    try {
      const { results } = await pushGantt(
        dirtyTasks.map((t) => {
          // Story Points follow estDays (Jira source of truth). null clears SP.
          // Omit when schedule wasn't edited so assignee/status-only pushes leave SP alone.
          let storyPoints: number | null | undefined;
          if (t.pendingCreate) {
            storyPoints =
              t.estDays != null && t.estDays > 0
                ? Math.max(1, Math.round(t.estDays))
                : Math.max(1, Math.round(t.durationDays || 1));
          } else if (t.scheduleDirty) {
            storyPoints =
              t.estDays != null && t.estDays > 0
                ? Math.max(1, Math.round(t.estDays))
                : null;
          }
          return {
            key: t.id,
            start: t.start,
            due: t.due,
            storyPoints,
            jiraUpdated: t.jiraUpdated,
            transitionId: t.pendingCreate ? null : t.transitionId || null,
            status: t.status,
            timeSpent: timeSpentForPush(t),
            assigneeAccountId: assigneeAccountIdForPush(t),
            create: t.pendingCreate
              ? {
                  epicKey: t.createEpicId || "",
                  summary: t.title,
                  draftId: t.id,
                }
              : undefined,
          };
        }),
      );
      setPushResults(results);
      updateModel((prev) => ({
        ...prev,
        milestones: prev.milestones.map((m) => ({
          ...m,
          tasks: m.tasks.map((t) => {
            const r =
              results.find((x) => x.draftId === t.id) ||
              results.find((x) => x.key === t.id);
            if (!r) return t;
            if (r.status === "ok") {
              const newKey = r.createdKey || r.key;
              return {
                ...t,
                id: newKey,
                friendlyId: t.friendlyId === "NEW" ? newKey : t.friendlyId,
                pendingCreate: false,
                createEpicId: undefined,
                dirty: false,
                scheduleDirty: false,
                statusDirty: false,
                assigneeDirty: false,
                transitionId: null,
                timeSpent: null,
                estDays: t.estDays,
                pulledStatus: t.status,
                pulledStart: t.start,
                pulledDue: t.due,
                pulledDurationDays: t.durationDays,
                pulledEstDays: t.estDays,
                pulledResourceIds: [...(t.resourceIds || [])],
                jiraUpdated: r.jiraUpdated || t.jiraUpdated,
              };
            }
            return t;
          }),
        })),
      }));
      const ok = results.filter((r) => r.status === "ok").length;
      const created = results.filter((r) => r.status === "ok" && r.createdKey).length;
      const conflicts = results.filter((r) => r.status === "conflict").length;
      const errors = results.filter((r) => r.status === "error").length;
      setStatus(
        `Push done · ${ok} ok${created ? ` (${created} created)` : ""} · ${conflicts} conflict · ${errors} error`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("Push failed");
    } finally {
      setBusy(null);
    }
  }

  function onScheduleEdit(taskId: string, patch: Partial<GanttTask>) {
    let wasLocal = false;
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId) return t;
          wasLocal = !!t.localOnly;
          const scheduleDirty = t.localOnly ? false : true;
          const next = {
            ...t,
            ...patch,
            // Snapshot last-pulled schedule on first local edit so Clear can restore it.
            pulledStart: t.pulledStart !== undefined ? t.pulledStart : t.start,
            pulledDue: t.pulledDue !== undefined ? t.pulledDue : t.due,
            pulledDurationDays: t.pulledDurationDays ?? t.durationDays,
            pulledEstDays: t.pulledEstDays !== undefined ? t.pulledEstDays : t.estDays,
            scheduleDirty,
            dirty: !!(scheduleDirty || t.statusDirty || t.assigneeDirty),
          };
          if (patch.start !== undefined || patch.durationDays !== undefined) {
            if (t.localOnly || t.isMarker) {
              const date = next.start || next.due;
              next.start = date;
              next.due = date;
              next.durationDays = 1;
            } else if (next.start) {
              next.due = dueFromStartDuration(
                next.start,
                next.durationDays,
                prev.showHolidays,
              );
            }
          }
          // Dur / bar resize writes the estimate; empty estDays means none (matches Jira).
          if (patch.estDays !== undefined && !t.localOnly) {
            next.estDays =
              patch.estDays != null && patch.estDays > 0
                ? Math.max(1, Math.round(patch.estDays))
                : null;
            if (next.estDays != null) {
              next.durationDays = next.estDays;
              if (next.start) {
                next.due = dueFromStartDuration(
                  next.start,
                  next.durationDays,
                  prev.showHolidays,
                );
              }
            }
          } else if (patch.durationDays !== undefined && !t.localOnly) {
            next.estDays = Math.max(1, Math.round(next.durationDays || 1));
          }
          return next;
        }),
      })),
    }));
    setStatus(wasLocal ? "Local milestone updated" : "Unsaved schedule changes");
  }

  function onAddDraftTask(input: {
    epicId: string;
    title: string;
    start: string;
    durationDays: number;
  }) {
    const due = dueFromStartDuration(input.start, input.durationDays, model.showHolidays);
    const draft = {
      id: newDraftTaskId(),
      epicId: input.epicId,
      title: input.title,
      start: input.start,
      due,
      durationDays: input.durationDays,
    };
    const task = draftToTask(draft);
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) =>
        m.id === input.epicId
          ? { ...m, collapsed: false, tasks: [...m.tasks, task] }
          : m,
      ),
    }));
    setStatus(`Draft task added · Push to create in Jira`);
  }

  function onDeleteDraftTask(taskId: string) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.filter((t) => t.id !== taskId),
      })),
    }));
    setStatus("Draft task removed");
  }

  function onAddLocalMilestone(input: { title: string; start: string }) {
    const marker = {
      id: newLocalMarkerId(),
      title: input.title,
      start: input.start,
    };
    const row = localMarkerToMilestone(marker);
    updateModel((prev) => ({
      ...prev,
      milestones: [...prev.milestones, row],
    }));
    setStatus(`Milestone added · ${input.title}`);
  }

  function onDeleteLocalMilestone(milestoneId: string) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((m) => m.id !== milestoneId),
    }));
    setStatus("Milestone removed");
  }

  function onStatusEdit(
    taskId: string,
    next: {
      status: string;
      transitionId: string | null;
      timeSpent?: string | null;
    },
  ) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const statusDirty = !!next.transitionId;
          return {
            ...t,
            status: next.status,
            transitionId: next.transitionId,
            timeSpent: statusDirty ? next.timeSpent ?? null : null,
            statusDirty,
            dirty: !!(t.scheduleDirty || statusDirty || t.assigneeDirty),
          };
        }),
      })),
    }));
    setStatus(
      next.transitionId
        ? next.timeSpent
          ? `Unsaved Done + actual ${next.timeSpent} — Push to update Jira`
          : "Unsaved status change — Push to update Jira"
        : "Status reset to Jira value",
    );
  }

  function onResourceEdit(taskId: string, resourceId: string | null) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId || t.localOnly) return t;
          const resource = resourceId
            ? prev.resources.find((r) => r.id === resourceId)
            : null;
          const pulled = t.pulledResourceIds ?? [];
          const nextIds = resourceId ? [resourceId] : [];
          const assigneeDirty = (pulled[0] || null) !== (nextIds[0] || null);
          return {
            ...t,
            resourceIds: nextIds,
            assignee: resource?.name || null,
            assigneeDirty,
            dirty: !!(t.scheduleDirty || t.statusDirty || assigneeDirty),
          };
        }),
      })),
    }));
    setStatus("Unsaved assignee change — Push to update Jira");
  }

  function onToggleCollapse(milestoneId: string) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) =>
        m.id === milestoneId ? { ...m, collapsed: !m.collapsed } : m,
      ),
    }));
  }

  function onReorderTask(
    milestoneId: string,
    fromId: string,
    toId: string,
    place: "before" | "after",
  ) {
    if (fromId === toId) return;
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => {
        if (m.id !== milestoneId) return m;
        const tasks = [...m.tasks];
        const fromIndex = tasks.findIndex((t) => t.id === fromId);
        if (fromIndex < 0) return m;
        const [moved] = tasks.splice(fromIndex, 1);
        let toIndex = tasks.findIndex((t) => t.id === toId);
        if (toIndex < 0) toIndex = tasks.length;
        if (place === "after") toIndex += 1;
        tasks.splice(toIndex, 0, moved);
        return { ...m, tasks };
      }),
    }));
    setStatus("Task order updated");
  }

  function onReorderMilestone(fromId: string, toId: string, place: "before" | "after") {
    if (fromId === toId) return;
    updateModel((prev) => {
      const ms = [...prev.milestones];
      const fromIndex = ms.findIndex((m) => m.id === fromId);
      if (fromIndex < 0) return prev;
      const [moved] = ms.splice(fromIndex, 1);
      let toIndex = ms.findIndex((m) => m.id === toId);
      if (toIndex < 0) toIndex = ms.length;
      if (place === "after") toIndex += 1;
      ms.splice(toIndex, 0, moved);
      return { ...prev, milestones: ms };
    });
    setStatus("Epic order updated");
  }

  function onToggleMarker(taskId: string) {
    let nowMarker = false;
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId) return t;
          nowMarker = !t.isMarker;
          return { ...t, isMarker: nowMarker };
        }),
      })),
    }));
    setStatus(nowMarker ? "Marked as milestone" : "Milestone mark removed");
  }

  function onMilestoneColorChange(milestoneId: string, color: string) {
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) =>
        m.id === milestoneId ? { ...m, color } : m,
      ),
    }));
    setStatus("Epic color saved");
  }

  const showLoadBar = busy !== null || health == null;

  return (
    <div className={`app${previewOpen ? " is-preview" : ""}`}>
      {showLoadBar && (
        <div
          className={`pg-loadbar${busy === "push" ? " push" : ""}${health == null && !busy ? " boot" : ""}`}
          role="progressbar"
          aria-busy="true"
          aria-label={
            busy === "push"
              ? "Pushing to Jira"
              : busy === "pull"
                ? "Pulling from Jira"
                : "Loading"
          }
        />
      )}
      {previewOpen && !previewChromeHidden && (
        <div className="gantt-preview-chrome">
          <BrandLockup />
          <p className="gantt-preview-hint">
            Clean preview — screenshot this view · Esc to close
          </p>
          <button
            type="button"
            className="gantt-btn"
            onClick={() => setPreviewChromeHidden(true)}
            title="Hide this bar so your screenshot is clean (Esc brings it back)"
          >
            Hide bar
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            onClick={() => setPreviewOpen(false)}
          >
            Close
          </button>
        </div>
      )}
      <header className="app-header">
        <BrandLockup />
        <div className="app-header-actions">
          <div className="app-header-actions-row">
            <button
              type="button"
              className="gantt-btn theme-toggle"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <>
                  <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden>
                    <circle cx="12" cy="12" r="4" fill="currentColor" />
                    <path
                      fill="currentColor"
                      d="M12 2.5a1 1 0 0 1 1 1V5a1 1 0 1 1-2 0V3.5a1 1 0 0 1 1-1Zm0 14a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V17.5a1 1 0 0 1 1-1ZM3.5 11a1 1 0 0 0 0 2H5a1 1 0 1 0 0-2H3.5Zm14 0a1 1 0 1 0 0 2H19a1 1 0 1 0 0-2h-1.5ZM5.99 5.99a1 1 0 0 0 0 1.41L7.05 8.46A1 1 0 1 0 8.46 7.05L7.4 5.99a1 1 0 0 0-1.41 0Zm9.55 9.55a1 1 0 0 0 0 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06a1 1 0 0 0-1.41 0ZM18.01 5.99a1 1 0 0 0-1.41 0L15.54 7.05A1 1 0 1 0 16.95 8.46l1.06-1.06a1 1 0 0 0 0-1.41ZM8.46 15.54a1 1 0 0 0-1.41 0L5.99 16.6a1 1 0 0 0 1.41 1.41l1.06-1.06a1 1 0 0 0 0-1.41Z"
                    />
                  </svg>
                  Light
                </>
              ) : (
                <>
                  <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M12.5 3.1a1 1 0 0 0-1.05.14A8.5 8.5 0 1 0 20.76 12.55a1 1 0 0 0-1.35-1.2 6.5 6.5 0 0 1-7.96-7.96 1 1 0 0 0-.95-1.29Z"
                    />
                  </svg>
                  Dark
                </>
              )}
            </button>
            {health != null && !health.ok && (
              <a
                className="gantt-btn token-btn"
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                title="Create a Jira API token, then add it to .env as JIRA_API_TOKEN"
              >
                Get Jira token
              </a>
            )}
            <span className={`health ${health?.ok ? "ok" : "bad"}`}>
              {health == null ? "…" : health.ok ? "Jira connected" : "Jira offline"}
            </span>
          </div>
          <button
            type="button"
            className="gantt-btn"
            disabled={!model.milestones.length}
            onClick={() => setPreviewOpen(true)}
            title="Open a clean, screenshot-ready Gantt view"
          >
            Preview
          </button>
        </div>
      </header>

      <div className="pg-toolbar">
        <input
          className="pg-jql"
          value={jql}
          onChange={(e) => onJqlChange(e.target.value)}
          placeholder='JQL — e.g. project = SBT AND parent = SBT-61018'
          spellCheck={false}
          title="Saved to preferences.json as you type"
        />
        <button
          type="button"
          className={`gantt-btn primary${busy === "pull" ? " is-busy" : ""}`}
          disabled={busy !== null || !jql.trim()}
          onClick={() => void onPull()}
        >
          {busy === "pull" ? (
            <>
              <span className="pg-spinner pg-spinner-inline" aria-hidden />
              Pulling…
            </>
          ) : (
            "Pull"
          )}
        </button>
        <button
          type="button"
          className={`gantt-btn${dirtyTasks.length ? " warn" : ""}${busy === "push" ? " is-busy" : ""}`}
          disabled={busy !== null || dirtyTasks.length === 0}
          onClick={() => void onPush()}
          title="Create draft tasks in Jira and write Start/Due/Story Points (from Dur)/status/assignee. Done transitions also log actual time."
        >
          {busy === "push" ? (
            <>
              <span className="pg-spinner pg-spinner-inline" aria-hidden />
              Pushing…
            </>
          ) : (
            `Push${dirtyTasks.length ? ` (${dirtyTasks.length})` : ""}`
          )}
        </button>
        <button
          type="button"
          className="gantt-btn"
          disabled={busy !== null || dirtyTasks.length === 0}
          onClick={onClearChanges}
          title="Discard unpushed edits and draft tasks (keeps local milestones)"
        >
          Clear
        </button>
        <button
          type="button"
          className="gantt-btn"
          onClick={() => setOptionsOpen(true)}
          title="Project start, holidays, off days, and prerequisites"
        >
          Options
        </button>
        <p className="hint">{hint}</p>
        <span className={`status${dirtyTasks.length ? " dirty" : ""}`}>{status}</span>
        {prefsSavedAt && (
          <span className="status" title="Written to preferences.json">
            Prefs saved {prefsSavedAt}
          </span>
        )}
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
        initialScroll={scroll}
        preview={previewOpen}
        loading={busy}
        loadingDetail={
          busy === "push" && dirtyTasks.length
            ? `${dirtyTasks.length} change${dirtyTasks.length === 1 ? "" : "s"}`
            : null
        }
        onScheduleEdit={onScheduleEdit}
        onStatusEdit={onStatusEdit}
        onResourceEdit={onResourceEdit}
        onToggleCollapse={onToggleCollapse}
        onMilestoneColorChange={onMilestoneColorChange}
        onReorderMilestone={onReorderMilestone}
        onReorderTask={onReorderTask}
        onToggleMarker={onToggleMarker}
        onDeleteLocalMilestone={onDeleteLocalMilestone}
        onDeleteDraftTask={onDeleteDraftTask}
        onLayoutChange={(patch) => updateModel((prev) => ({ ...prev, ...patch }))}
        onScrollChange={(next) => {
          setScroll(next);
          persistCache(modelRef.current, next);
        }}
        onAddTask={() => setAddTaskOpen(true)}
        onAddMilestone={() => setAddMsOpen(true)}
      />

      <AddTaskDialog
        open={addTaskOpen}
        epics={model.milestones.filter((m) => !m.localOnly)}
        defaultDate={model.projectStart}
        onClose={() => setAddTaskOpen(false)}
        onAdd={onAddDraftTask}
      />

      <AddMilestoneDialog
        open={addMsOpen}
        defaultDate={model.projectStart}
        onClose={() => setAddMsOpen(false)}
        onAdd={onAddLocalMilestone}
      />

      <ProjectOptionsPanel
        open={optionsOpen}
        projectStart={model.projectStart}
        showHolidays={model.showHolidays}
        showDeps={model.showDeps}
        customNonWorkingDays={model.customNonWorkingDays || []}
        onClose={() => setOptionsOpen(false)}
        onProjectStartChange={(value) =>
          updateModel((prev) => ({ ...prev, projectStart: value }))
        }
        onShowHolidaysChange={(value) =>
          updateModel((prev) => ({ ...prev, showHolidays: value }))
        }
        onShowDepsChange={(value) =>
          updateModel((prev) => ({ ...prev, showDeps: value }))
        }
        onAddOffDay={addCustomOffDay}
        onRemoveOffDay={removeCustomOffDay}
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
        <span>Push writes Start date, Due date, Story Points (Dur), status, and assignee to Jira</span>
      </div>
    </div>
  );
}
