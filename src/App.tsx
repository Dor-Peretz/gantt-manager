import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteQaItem,
  fetchChangelogs,
  fetchConfig,
  fetchHealth,
  loadCache,
  pullGantt,
  pushGantt,
  saveCache,
  saveQaItem,
  saveState,
  type ScrollState,
} from "./api";
import { AppFooter } from "./brand/AppFooter";
import { BrandLockup } from "./brand/BrandMark";
import { applyModelOrder } from "./lib/boardOrder";
import { AddMilestoneDialog } from "./gantt/AddMilestoneDialog";
import { AddQaItemDialog, type BoardTaskOption } from "./gantt/AddQaItemDialog";
import { AddTaskDialog } from "./gantt/AddTaskDialog";
import { ProjectOptionsPanel } from "./gantt/ProjectOptionsPanel";
import { SaveJqlDialog } from "./gantt/SaveJqlDialog";
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
import {
  collectDirtyQaItems,
  collectQaItems,
  isQaMilestone,
  mergeDirtyQaItems,
  newQaItemId,
  qaItemToMilestone,
  refreshQaAssignees,
  revertUnpushedQa,
} from "./lib/qaItems";
import {
  applyHistoryToModel,
  buildHistoryOverlay,
  countHistoryStats,
} from "./lib/jiraHistory";
import type {
  CustomNonWorkingDay,
  DraftTask,
  GanttModel,
  GanttTask,
  HistoricalSchedule,
  HistoryFieldMap,
  HistoryViewMode,
  IssueChangelog,
  LocalMarker,
  LocalState,
  PendingQaDelete,
  PushResult,
  QaItem,
  QaKind,
  SavedJql,
  ThemeMode,
} from "./lib/types";
import { emptyModel, DEFAULT_COLORS, normalizeColumnWidths } from "./lib/types";
import {
  addDays,
  dueFromStartDuration,
  formatYmd,
  initialsFromName,
  setCustomNonWorkingDays,
  todayLocal,
} from "./lib/workdays";

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return DEFAULT_COLORS[Math.abs(h) % DEFAULT_COLORS.length];
}

function newSavedJqlId(): string {
  return `jql-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const HISTORY_CHUNK = 18;

function defaultCompareDate(): string {
  return formatYmd(addDays(todayLocal(), -7));
}

function jiraTaskKeys(model: GanttModel): string[] {
  const keys = new Set<string>();
  for (const m of model.milestones) {
    for (const t of m.tasks) {
      if (t.localOnly || t.pendingCreate) continue;
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(t.id)) keys.add(t.id);
    }
  }
  return [...keys];
}

function formatCompareLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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

function prefsFromModel(
  next: GanttModel,
  jqlOverride?: string,
  pendingQaDeletes: PendingQaDelete[] = [],
): Partial<LocalState> {
  const allocations: Record<string, string[]> = {};
  const collapsed: Record<string, boolean> = {};
  const milestoneColors: Record<string, string> = {};
  const taskOrder: Record<string, string[]> = {};
  const markers: Record<string, boolean> = {};
  const hiddenTasks: Record<string, boolean> = {};
  for (const m of next.milestones) {
    collapsed[m.id] = !!m.collapsed;
    milestoneColors[m.id] = m.color;
    taskOrder[m.id] = m.tasks.map((t) => t.id);
    for (const t of m.tasks) {
      if (t.localOnly) continue;
      allocations[t.id] = t.resourceIds;
      if (t.isMarker) markers[t.id] = true;
      if (t.hidden) hiddenTasks[t.id] = true;
    }
  }
  return {
    resources: next.resources,
    allocations,
    collapsed,
    taskOrder,
    milestoneOrder: next.milestones.map((m) => m.id),
    markers,
    hiddenTasks,
    hiddenFolderCollapsed: next.hiddenFolderCollapsed !== false,
    localMarkers: collectLocalMarkers(next),
    draftTasks: collectDraftTasks(next),
    pendingQaDeletes,
    milestoneColors,
    projectStart: next.projectStart,
    showHolidays: next.showHolidays,
    showDeps: next.showDeps,
    customNonWorkingDays: next.customNonWorkingDays,
    dayWidthPx: next.dayWidthPx,
    leftPanelWidth: next.leftPanelWidth,
    columnWidths: normalizeColumnWidths(next.columnWidths),
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
    hiddenFolderCollapsed:
      previous.hiddenFolderCollapsed !== undefined
        ? previous.hiddenFolderCollapsed
        : fresh.hiddenFolderCollapsed,
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
          const hidden = prevTask?.hidden ?? t.hidden;
          const d = dirtyById.get(t.id);
          if (!d) return { ...t, isMarker, hidden };
          return {
            ...t,
            isMarker,
            hidden,
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
  const prevHidden = new Set<string>();
  for (const m of previous.milestones) {
    for (const t of m.tasks) if (t.hidden) prevHidden.add(t.id);
  }
  if (prevHidden.size) {
    withLocals = {
      ...withLocals,
      milestones: withLocals.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) =>
          prevHidden.has(t.id) ? { ...t, hidden: true } : t,
        ),
      })),
    };
  }
  return applyModelOrder(mergeDirtyQaItems(withLocals, previous), previous);
}

export default function App() {
  const [model, setModel] = useState<GanttModel>(() => emptyModel());
  const [jql, setJql] = useState("");
  const [savedJqls, setSavedJqls] = useState<SavedJql[]>([]);
  const [activeSavedJqlId, setActiveSavedJqlId] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("https://sunbit.atlassian.net");
  const [health, setHealth] = useState<{
    ok: boolean;
    site?: string;
    displayName?: string;
    error?: string;
  } | null>(null);
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [historyViewMode, setHistoryViewMode] = useState<HistoryViewMode>("asOf");
  const [compareDate, setCompareDate] = useState(defaultCompareDate);
  const [historyCache, setHistoryCache] = useState<Map<string, IssueChangelog>>(() => new Map());
  const [historyFieldMap, setHistoryFieldMap] = useState<HistoryFieldMap | null>(null);
  const historyFetchGen = useRef(0);
  const [status, setStatus] = useState("Ready");
  const [hint, setHint] = useState("Enter JQL and press Pull to load Jira tasks.");
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingQaDeletes, setPendingQaDeletes] = useState<PendingQaDelete[]>([]);
  const [prefsSavedAt, setPrefsSavedAt] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [scroll, setScroll] = useState<ScrollState | null>(null);
  const jqlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedJqlsRef = useRef(savedJqls);
  const activeSavedJqlIdRef = useRef(activeSavedJqlId);
  savedJqlsRef.current = savedJqls;
  activeSavedJqlIdRef.current = activeSavedJqlId;
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  const scrollRef = useRef<ScrollState | null>(null);
  modelRef.current = model;
  scrollRef.current = scroll;
  const pendingQaDeletesRef = useRef(pendingQaDeletes);
  pendingQaDeletesRef.current = pendingQaDeletes;
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
        await persistLocal(prefsFromModel(next, next.jql, pendingQaDeletesRef.current));
        persistCache(next, scrollRef.current);
        const count = next.milestones.reduce((n, m) => n + m.tasks.length, 0);
        const locals = collectLocalMarkers(next).length;
        const qaCount = collectQaItems(next).length;
        const dirty = countDirty(next);
        setStatus(
          dirty
            ? `Pulled ${count} tasks · kept ${dirty} local edit(s)`
            : `Pulled ${count} tasks · ${next.milestones.length} epics${
                locals ? ` · ${locals} local milestone(s)` : ""
              }${qaCount ? ` · ${qaCount} QA item(s)` : ""}`,
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
        setSavedJqls(prefs?.savedJqls ?? []);
        setActiveSavedJqlId(prefs?.activeSavedJqlId ?? null);
        setPendingQaDeletes(prefs?.pendingQaDeletes ?? []);
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
            showDeps: prefs?.showDeps === true,
            customNonWorkingDays:
              prefs?.customNonWorkingDays ?? cache.model.customNonWorkingDays ?? [],
            dayWidthPx: prefs?.dayWidthPx || cache.model.dayWidthPx,
            leftPanelWidth: prefs?.leftPanelWidth || cache.model.leftPanelWidth,
            columnWidths: normalizeColumnWidths(
              prefs?.columnWidths ?? cache.model.columnWidths,
            ),
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
          const savedHidden = prefs?.hiddenTasks || {};
          restored = {
            ...restored,
            hiddenFolderCollapsed: prefs?.hiddenFolderCollapsed !== false,
            milestones: restored.milestones.map((m) => ({
              ...m,
              tasks: m.tasks.map((t) => ({
                ...t,
                hidden: savedHidden[t.id] === true,
                isMarker: t.isMarker || prefs?.markers?.[t.id] === true,
              })),
            })),
          };
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
            showDeps: prefs?.showDeps === true,
            customNonWorkingDays: prefs?.customNonWorkingDays ?? [],
            dayWidthPx: prefs?.dayWidthPx || m.dayWidthPx,
            leftPanelWidth: prefs?.leftPanelWidth || m.leftPanelWidth,
            columnWidths: normalizeColumnWidths(prefs?.columnWidths ?? m.columnWidths),
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

  const dirtyQaItems = useMemo(() => collectDirtyQaItems(model), [model]);

  const jiraKeySetSig = useMemo(
    () => [...jiraTaskKeys(model)].sort().join(","),
    [model],
  );
  const jiraKeys = useMemo(
    () => (jiraKeySetSig ? jiraKeySetSig.split(",") : []),
    [jiraKeySetSig],
  );
  const pushPendingCount =
    dirtyTasks.length + dirtyQaItems.length + pendingQaDeletes.length;

  useEffect(() => {
    if (!compareEnabled || !jiraKeys.length) {
      setHistoryLoading(false);
      return;
    }
    const gen = ++historyFetchGen.current;
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      const cache = new Map<string, IssueChangelog>();
      let fieldMap: HistoryFieldMap | null = null;
      try {
        for (let i = 0; i < jiraKeys.length; i += HISTORY_CHUNK) {
          if (cancelled || gen !== historyFetchGen.current) return;
          const chunk = jiraKeys.slice(i, i + HISTORY_CHUNK);
          const result = await fetchChangelogs(chunk);
          if (!fieldMap) fieldMap = result.fieldMap;
          for (const entry of result.changelogs) cache.set(entry.key, entry);
        }
        if (cancelled || gen !== historyFetchGen.current) return;
        setHistoryCache(cache);
        if (fieldMap) setHistoryFieldMap(fieldMap);
      } catch (e) {
        if (!cancelled && gen === historyFetchGen.current) {
          setError(String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (!cancelled && gen === historyFetchGen.current) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [compareEnabled, jiraKeys]);

  const historyOverlay = useMemo((): Map<string, HistoricalSchedule | null> | undefined => {
    if (!compareEnabled || !historyFieldMap || historyLoading) return undefined;
    const tasks: GanttTask[] = [];
    for (const m of model.milestones) {
      for (const t of m.tasks) {
        if (t.localOnly || t.pendingCreate) continue;
        tasks.push(t);
      }
    }
    return buildHistoryOverlay(
      tasks,
      historyCache,
      compareDate,
      historyFieldMap,
      model.showHolidays !== false,
    );
  }, [
    compareEnabled,
    compareDate,
    historyCache,
    historyFieldMap,
    historyLoading,
    model.milestones,
    model.showHolidays,
  ]);

  const compareStats = useMemo(() => {
    if (!historyOverlay) return null;
    return countHistoryStats(model, historyOverlay, historyCache, compareDate);
  }, [historyOverlay, historyCache, compareDate, model]);

  const boardModel = useMemo(() => {
    if (!compareEnabled || historyViewMode !== "asOf" || !historyOverlay) return model;
    return applyHistoryToModel(model, historyOverlay, historyCache, compareDate);
  }, [compareEnabled, compareDate, historyCache, historyOverlay, historyViewMode, model]);

  const historyViewLabel =
    compareEnabled && !historyLoading
      ? historyViewMode === "overlay"
        ? `Overlay vs today · ${formatCompareLabel(compareDate)}`
        : `Board as of ${formatCompareLabel(compareDate)}`
      : null;

  const historyReadOnly = compareEnabled && historyViewMode === "asOf" && !historyLoading;

  const boardTaskOptions = useMemo((): BoardTaskOption[] => {
    const out: BoardTaskOption[] = [];
    for (const m of model.milestones) {
      if (m.localOnly) continue;
      for (const t of m.tasks) {
        if (t.localOnly || t.pendingCreate || t.isMarker) continue;
        out.push({ id: t.id, title: t.title, epicTitle: m.title });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [model.milestones]);

  const [addMsOpen, setAddMsOpen] = useState(false);
  const [addQaOpen, setAddQaOpen] = useState<QaKind | null>(null);
  const [editQaItem, setEditQaItem] = useState<QaItem | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [saveJqlOpen, setSaveJqlOpen] = useState(false);
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
        void persistLocal(prefsFromModel(next, jql, pendingQaDeletesRef.current));
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
    const active = savedJqlsRef.current.find((s) => s.id === activeSavedJqlIdRef.current);
    const nextActiveId = active && active.jql === value ? active.id : null;
    if (nextActiveId !== activeSavedJqlIdRef.current) {
      setActiveSavedJqlId(nextActiveId);
    }
    if (jqlTimer.current) clearTimeout(jqlTimer.current);
    jqlTimer.current = setTimeout(() => {
      void persistLocal({ jql: value, activeSavedJqlId: nextActiveId });
    }, 400);
  }

  function onSelectSavedJql(id: string) {
    if (!id) {
      setActiveSavedJqlId(null);
      void persistLocal({ activeSavedJqlId: null });
      return;
    }
    const preset = savedJqls.find((s) => s.id === id);
    if (!preset) return;
    setActiveSavedJqlId(preset.id);
    setJql(preset.jql);
    setModel((m) => ({ ...m, jql: preset.jql }));
    void persistLocal({ jql: preset.jql, activeSavedJqlId: preset.id });
    setStatus(`Loaded saved JQL “${preset.name}”`);
    setHint("Press Pull to load issues for this saved JQL");
  }

  function onSaveJql() {
    const q = jql.trim();
    if (!q) {
      setError("Enter a JQL query before saving");
      return;
    }
    setError(null);
    setSaveJqlOpen(true);
  }

  async function onCopyJql() {
    const q = jql.trim();
    if (!q) return;
    try {
      await navigator.clipboard.writeText(q);
      setStatus("JQL copied to clipboard");
    } catch {
      setStatus("Could not copy JQL");
    }
  }

  function commitSaveJql(name: string) {
    const q = jql.trim();
    if (!q || !name) return;
    const active = savedJqls.find((s) => s.id === activeSavedJqlId);

    let next: SavedJql[];
    let nextActiveId: string;
    if (active && active.jql === q) {
      next = savedJqls.map((s) => (s.id === active.id ? { ...s, name, jql: q } : s));
      nextActiveId = active.id;
    } else {
      const existingSame = savedJqls.find((s) => s.jql === q);
      if (existingSame) {
        next = savedJqls.map((s) => (s.id === existingSame.id ? { ...s, name } : s));
        nextActiveId = existingSame.id;
      } else {
        nextActiveId = newSavedJqlId();
        next = [...savedJqls, { id: nextActiveId, name, jql: q }];
      }
    }
    setSavedJqls(next);
    setActiveSavedJqlId(nextActiveId);
    void persistLocal({ savedJqls: next, activeSavedJqlId: nextActiveId, jql: q });
    setStatus(`Saved JQL “${name}”`);
    setError(null);
  }

  function onRemoveSavedJql() {
    if (!activeSavedJqlId) return;
    const preset = savedJqls.find((s) => s.id === activeSavedJqlId);
    if (!preset) return;
    if (!window.confirm(`Remove saved JQL “${preset.name}”?`)) return;
    const next = savedJqls.filter((s) => s.id !== activeSavedJqlId);
    setSavedJqls(next);
    setActiveSavedJqlId(null);
    void persistLocal({ savedJqls: next, activeSavedJqlId: null });
    setStatus(`Removed saved JQL “${preset.name}”`);
  }

  async function onPull() {
    await runPull(jql, { previous: modelRef.current });
  }

  function onClearChanges() {
    const qaDirty = dirtyQaItems.length;
    const qaDeletes = pendingQaDeletes.length;
    if (!dirtyTasks.length && !qaDirty && !qaDeletes) return;
    const drafts = dirtyTasks.filter((t) => t.pendingCreate).length;
    const edits = dirtyTasks.length - drafts;
    const parts: string[] = [];
    if (edits) parts.push(`${edits} unpushed edit(s)`);
    if (drafts) parts.push(`${drafts} draft task(s)`);
    if (qaDirty) parts.push(`${qaDirty} QA edit(s)`);
    if (qaDeletes) parts.push(`${qaDeletes} queued QA delete(s)`);
    if (!window.confirm(`Discard ${parts.join(" and ")}?`)) return;

    const restoreDeletes = pendingQaDeletes;
    pendingQaDeletesRef.current = [];
    setPendingQaDeletes([]);
    void persistLocal({ pendingQaDeletes: [] });

    updateModel((prev) => {
      const revertedTasks: GanttModel = {
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
      };
      return revertUnpushedQa(revertedTasks, restoreDeletes);
    });
    setPushResults(null);
    setError(null);
    setStatus("Local changes cleared");
  }

  async function onPush() {
    if (!pushPendingCount) return;
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
    const qaWrites = dirtyQaItems.length + pendingQaDeletes.length;
    setStatus(
      creates || qaWrites
        ? `Pushing ${pushPendingCount} item(s)${creates ? ` · ${creates} create` : ""}${qaWrites ? ` · ${qaWrites} QA` : ""}…`
        : `Pushing ${pushPendingCount} task(s)…`,
    );
    try {
      const { results } = dirtyTasks.length
        ? await pushGantt(
            dirtyTasks.map((t) => {
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
          )
        : { results: [] as PushResult[] };

      let qaOk = 0;
      let qaErrors = 0;
      const savedQaIds = new Set<string>();
      const deletedQaIds = new Set<string>();
      for (const { previousLinkedKeys, ...item } of dirtyQaItems) {
        try {
          await saveQaItem(item, previousLinkedKeys);
          savedQaIds.add(item.id);
          qaOk += 1;
        } catch (err) {
          qaErrors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      }
      for (const del of pendingQaDeletes) {
        try {
          await deleteQaItem(del.id, del.linkedIssueKeys);
          deletedQaIds.add(del.id);
          qaOk += 1;
        } catch (err) {
          qaErrors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      }

      setPushResults(results);
      updateModel((prev) => ({
        ...prev,
        milestones: prev.milestones
          .filter((m) => !(isQaMilestone(m) && deletedQaIds.has(m.id)))
          .map((m) => ({
            ...m,
            tasks: m.tasks.map((t) => {
              const r =
                results.find((x) => x.draftId === t.id) ||
                results.find((x) => x.key === t.id);
              if (r) {
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
              }
              if (t.qaKind && savedQaIds.has(t.id)) {
                return {
                  ...t,
                  dirty: false,
                  pulledLinkedIssueKeys: [...(t.linkedIssueKeys || [])],
                };
              }
              return t;
            }),
          })),
      }));
      if (deletedQaIds.size) {
        setPendingQaDeletes((prev) => {
          const next = prev.filter((item) => !deletedQaIds.has(item.id));
          void persistLocal({ pendingQaDeletes: next });
          return next;
        });
      }
      const ok = results.filter((r) => r.status === "ok").length + qaOk;
      const created = results.filter((r) => r.status === "ok" && r.createdKey).length;
      const conflicts = results.filter((r) => r.status === "conflict").length;
      const errors = results.filter((r) => r.status === "error").length + qaErrors;
      setStatus(
        `Push done · ${ok} ok${created ? ` (${created} created)` : ""}${qaOk ? ` · ${qaOk} QA` : ""} · ${conflicts} conflict · ${errors} error`,
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
    let wasQa = false;
    updateModel((prev) => {
      const nextModel = {
        ...prev,
        milestones: prev.milestones.map((m) => ({
          ...m,
          tasks: m.tasks.map((t) => {
            if (t.id !== taskId) return t;
            if (t.qaKind) {
              const durationDays = Math.max(
                1,
                patch.durationDays !== undefined ? patch.durationDays : t.durationDays,
              );
              const start = patch.start !== undefined ? patch.start : t.start;
              const due =
                start != null
                  ? dueFromStartDuration(start, durationDays, prev.showHolidays)
                  : patch.due !== undefined
                    ? patch.due
                    : t.due;
              const next = {
                ...t,
                ...patch,
                start,
                due,
                durationDays,
                dirty: true,
              };
              wasQa = true;
              return next;
            }
            wasLocal = !!t.localOnly;
            const scheduleDirty = t.localOnly ? false : true;
            const next = {
              ...t,
              ...patch,
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
      };
      return refreshQaAssignees(nextModel);
    });
    if (wasQa) {
      setStatus("Unsaved QA schedule — Push to save to Jira");
      return;
    }
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

  function onSaveQaItem(input: {
    id?: string;
    kind: QaKind;
    title: string;
    start: string;
    durationDays: number;
    linkedIssueKeys: string[];
  }) {
    const previous = input.id
      ? collectQaItems(model).find((i) => i.id === input.id)
      : undefined;
    const prevTask = previous
      ? model.milestones
          .find((m) => m.id === previous.id)
          ?.tasks.find((t) => t.id === previous.id)
      : undefined;
    const item: QaItem = {
      id: input.id || newQaItemId(),
      kind: input.kind,
      title: input.title,
      start: input.start,
      durationDays: Math.max(1, input.durationDays),
      linkedIssueKeys: [...input.linkedIssueKeys],
    };
    const row = qaItemToMilestone(item, model, model.showHolidays, {
      dirty: true,
      pulledLinkedIssueKeys: prevTask?.pulledLinkedIssueKeys,
      pulledStart: prevTask?.pulledStart,
      pulledDue: prevTask?.pulledDue,
      pulledDurationDays: prevTask?.pulledDurationDays,
    });
    updateModel((prev) => {
      const without = prev.milestones.filter((m) => m.id !== item.id);
      const next = refreshQaAssignees({
        ...prev,
        milestones: [...without, row],
      });
      return next;
    });
    setEditQaItem(null);
    setAddQaOpen(null);
    setStatus(
      `${item.kind === "e2e" ? "E2E flow" : "Integration test"} ${previous ? "updated" : "added"} — Push to save to Jira`,
    );
  }

  function onDeleteQaItem(milestoneId: string) {
    const milestone = model.milestones.find((m) => m.id === milestoneId);
    const prevTask = milestone?.tasks.find((t) => t.id === milestoneId);
    const wasSynced = !!(prevTask?.pulledLinkedIssueKeys?.length);

    let nextPending = pendingQaDeletesRef.current.filter((item) => item.id !== milestoneId);
    if (wasSynced && prevTask?.pulledLinkedIssueKeys?.length) {
      nextPending = [
        ...nextPending,
        {
          id: milestoneId,
          linkedIssueKeys: [...prevTask.pulledLinkedIssueKeys],
          kind: prevTask.qaKind,
          title: milestone?.title || prevTask.title,
          start: prevTask.pulledStart || prevTask.start || undefined,
          durationDays: prevTask.pulledDurationDays ?? prevTask.durationDays,
        },
      ];
    }
    pendingQaDeletesRef.current = nextPending;
    setPendingQaDeletes(nextPending);

    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((m) => m.id !== milestoneId),
    }));
    if (wasSynced) {
      setStatus("QA item removed — Push to delete from Jira");
      return;
    }
    setStatus("QA item removed");
  }

  function onEditQaItem(milestoneId: string) {
    const item = collectQaItems(model).find((i) => i.id === milestoneId);
    if (!item) return;
    setEditQaItem(item);
    setAddQaOpen(item.kind);
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
    updateModel((prev) => {
      const next: GanttModel = {
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
      };
      return refreshQaAssignees(next);
    });
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

  const allEpicsCollapsed =
    boardModel.milestones.length > 0 && boardModel.milestones.every((m) => m.collapsed);

  function onCollapseOrExpandAll() {
    const collapse = !allEpicsCollapsed;
    updateModel((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => ({ ...m, collapsed: collapse })),
    }));
    setStatus(collapse ? "All epics collapsed" : "All epics expanded");
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

  function onToggleHidden(taskId: string) {
    let nowHidden = false;
    updateModel((prev) => {
      const milestones = prev.milestones.map((m) => ({
        ...m,
        tasks: m.tasks.map((t) => {
          if (t.id !== taskId || t.localOnly) return t;
          nowHidden = !t.hidden;
          return { ...t, hidden: nowHidden };
        }),
      }));
      return {
        ...prev,
        milestones,
        // Expand the folder when hiding so the task is easy to find again.
        hiddenFolderCollapsed: nowHidden ? false : prev.hiddenFolderCollapsed,
      };
    });
    setStatus(nowHidden ? "Task hidden" : "Task shown");
  }

  function onToggleHiddenFolder() {
    updateModel((prev) => ({
      ...prev,
      hiddenFolderCollapsed: !(prev.hiddenFolderCollapsed !== false),
    }));
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
        {health?.ok && health.displayName && (
          <span
            className="app-profile"
            style={{ background: colorForName(health.displayName) }}
            title={health.displayName}
            aria-label={`Signed in as ${health.displayName}`}
          >
            {initialsFromName(health.displayName)}
          </span>
        )}
      </header>

      <div className="pg-toolbar">
        <select
          className="pg-jql-select"
          value={activeSavedJqlId || ""}
          onChange={(e) => onSelectSavedJql(e.target.value)}
          title="Switch between your saved JQL queries"
          aria-label="Saved JQL"
        >
          <option value="">Saved JQL…</option>
          {savedJqls.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
          className="gantt-btn pg-jql-copy"
          disabled={!jql.trim()}
          onClick={() => void onCopyJql()}
          title="Copy JQL to clipboard"
          aria-label="Copy JQL to clipboard"
        >
          <svg className="pg-jql-copy-icon" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
            />
          </svg>
        </button>
        <button
          type="button"
          className="gantt-btn"
          disabled={!jql.trim()}
          onClick={onSaveJql}
          title="Save the current JQL under a name for quick reuse"
        >
          Save JQL
        </button>
        <button
          type="button"
          className="gantt-btn"
          disabled={!activeSavedJqlId}
          onClick={onRemoveSavedJql}
          title="Remove the selected saved JQL"
        >
          Remove
        </button>
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
          className={`gantt-btn${pushPendingCount ? " warn" : ""}${busy === "push" ? " is-busy" : ""}`}
          disabled={busy !== null || pushPendingCount === 0 || historyReadOnly}
          onClick={() => void onPush()}
          title="Create draft tasks in Jira and write Start/Due/Story Points (from Dur)/status/assignee/QA items. Done transitions also log actual time."
        >
          {busy === "push" ? (
            <>
              <span className="pg-spinner pg-spinner-inline" aria-hidden />
              Pushing…
            </>
          ) : (
            `Push${pushPendingCount ? ` (${pushPendingCount})` : ""}`
          )}
        </button>
        <button
          type="button"
          className="gantt-btn"
          disabled={busy !== null || pushPendingCount === 0}
          onClick={onClearChanges}
          title="Discard unpushed ticket edits, QA changes, and draft tasks (keeps local milestones)"
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
        <label
          className="pg-compare-toggle"
          title="Reconstruct schedules from Jira ticket history"
        >
          <input
            type="checkbox"
            checked={compareEnabled}
            onChange={(e) => setCompareEnabled(e.target.checked)}
            disabled={!model.milestones.length}
          />
          History
        </label>
        <input
          type="date"
          className="pg-compare-date"
          value={compareDate}
          max={formatYmd(todayLocal())}
          disabled={!compareEnabled || !model.milestones.length}
          onChange={(e) => {
            if (e.target.value) setCompareDate(e.target.value);
          }}
          title="Past date to reconstruct from Jira changelog"
          aria-label="History date"
        />
        <select
          className="pg-history-mode"
          value={historyViewMode}
          disabled={!compareEnabled || !model.milestones.length}
          onChange={(e) => setHistoryViewMode(e.target.value as HistoryViewMode)}
          title="Overlay shows ghosts on today's board; As of date replaces bars with the historical schedule"
          aria-label="History view mode"
        >
          <option value="asOf">As of date — full board</option>
          <option value="overlay">Overlay — ghosts on today</option>
        </select>
        {compareEnabled && compareStats && !historyLoading ? (
          <span className="pg-compare-stats" title="Reconstructed from Jira changelog">
            {historyViewMode === "overlay" ? "Comparing" : "Viewing"} {formatCompareLabel(compareDate)}
            {historyViewMode === "overlay" && compareStats.moved
              ? ` · ${compareStats.moved} bars moved`
              : historyViewMode === "asOf" && compareStats.scheduled
                ? ` · ${compareStats.scheduled} scheduled`
                : ""}
            {compareStats.notCreated ? ` · ${compareStats.notCreated} not yet created` : ""}
          </span>
        ) : null}
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
        model={boardModel}
        jiraBaseUrl={jiraBaseUrl}
        initialScroll={scroll}
        preview={previewOpen}
        historyReadOnly={historyReadOnly}
        historyViewMode={compareEnabled ? historyViewMode : null}
        historyViewLabel={historyViewLabel}
        loading={busy || (historyLoading ? "history" : null)}
        loadingDetail={
          busy === "push" && dirtyTasks.length
            ? `${dirtyTasks.length} change${dirtyTasks.length === 1 ? "" : "s"}`
            : historyLoading
              ? `${jiraKeys.length} ticket${jiraKeys.length === 1 ? "" : "s"}`
              : null
        }
        compareDate={
          compareEnabled && historyViewMode === "overlay" && !historyLoading
            ? compareDate
            : null
        }
        historyOverlay={
          compareEnabled && historyViewMode === "overlay" ? historyOverlay : undefined
        }
        onScheduleEdit={onScheduleEdit}
        onStatusEdit={onStatusEdit}
        onResourceEdit={onResourceEdit}
        onToggleCollapse={onToggleCollapse}
        onMilestoneColorChange={onMilestoneColorChange}
        onReorderMilestone={onReorderMilestone}
        onReorderTask={onReorderTask}
        onToggleMarker={onToggleMarker}
        onToggleHidden={onToggleHidden}
        onToggleHiddenFolder={onToggleHiddenFolder}
        onDeleteLocalMilestone={onDeleteLocalMilestone}
        onDeleteQaItem={onDeleteQaItem}
        onEditQaItem={onEditQaItem}
        onDeleteDraftTask={onDeleteDraftTask}
        onLayoutChange={(patch) => updateModel((prev) => ({ ...prev, ...patch }))}
        onScrollChange={(next) => {
          setScroll(next);
          persistCache(modelRef.current, next);
        }}
        onCollapseOrExpandAll={onCollapseOrExpandAll}
        onAddTask={() => setAddTaskOpen(true)}
        onAddMilestone={() => setAddMsOpen(true)}
        onAddIntegrationTest={() => {
          setEditQaItem(null);
          setAddQaOpen("integration");
        }}
        onAddE2eFlow={() => {
          setEditQaItem(null);
          setAddQaOpen("e2e");
        }}
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

      <AddQaItemDialog
        open={addQaOpen !== null}
        kind={addQaOpen || editQaItem?.kind || "integration"}
        defaultDate={model.projectStart}
        tasks={boardTaskOptions}
        editing={editQaItem}
        onClose={() => {
          setAddQaOpen(null);
          setEditQaItem(null);
        }}
        onSave={onSaveQaItem}
      />

      <SaveJqlDialog
        open={saveJqlOpen}
        defaultName={
          savedJqls.find((s) => s.id === activeSavedJqlId)?.name || ""
        }
        jqlPreview={jql}
        onClose={() => setSaveJqlOpen(false)}
        onSave={commitSaveJql}
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
        <span>Push writes schedule, status, assignee, and QA items to Jira</span>
      </div>

      <AppFooter />
    </div>
  );
}
