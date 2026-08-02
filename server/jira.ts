import type {
  GanttModel,
  GanttTask,
  Milestone,
  PushItem,
  PushResult,
  Resource,
} from "../src/lib/types.ts";
import { DEFAULT_COLORS, MILESTONE_COLORS } from "../src/lib/types.ts";
import {
  dueFromStartDuration,
  durationFromStartDue,
  initialsFromName,
  setCustomNonWorkingDays,
  startFromDueDuration,
} from "../src/lib/workdays.ts";
import { mergeState, readState } from "./state.ts";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function colorForAssignee(accountId: string, used: Set<string>): string {
  // Stable preferred slot from account id, then walk the palette for uniqueness
  const idx = Math.abs(hash(accountId)) % DEFAULT_COLORS.length;
  for (let i = 0; i < DEFAULT_COLORS.length; i++) {
    const c = DEFAULT_COLORS[(idx + i) % DEFAULT_COLORS.length];
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  const fallback = DEFAULT_COLORS[idx];
  used.add(fallback);
  return fallback;
}

const FALLBACK_FIELDS = {
  startDate: "customfield_10907",
  storyPoints: "customfield_10008",
  team: "customfield_10500",
  epicLink: "customfield_10004",
};

interface FieldMap {
  startDate: string;
  storyPoints: string;
  team: string;
  epicLink: string;
}

interface JiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

function authHeader(): string {
  const email = requireEnv("JIRA_EMAIL");
  const token = requireEnv("JIRA_API_TOKEN");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

function baseUrl(): string {
  return requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
}

async function jiraFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const url = pathname.startsWith("http") ? pathname : `${baseUrl()}${pathname}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader());
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  return res;
}

let cachedFields: FieldMap | null = null;

export async function discoverFields(): Promise<FieldMap> {
  if (cachedFields) return cachedFields;
  try {
    const res = await jiraFetch("/rest/api/3/field");
    if (!res.ok) throw new Error(`field discovery failed: ${res.status}`);
    const fields = (await res.json()) as Array<{ id: string; name: string }>;
    const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
    cachedFields = {
      startDate: byName.get("start date") || FALLBACK_FIELDS.startDate,
      storyPoints:
        byName.get("story points") ||
        byName.get("story point estimate") ||
        byName.get("storypoint") ||
        FALLBACK_FIELDS.storyPoints,
      team: byName.get("team") || FALLBACK_FIELDS.team,
      epicLink: byName.get("epic link") || FALLBACK_FIELDS.epicLink,
    };
    // Prefer the verified Start date field when multiple "Start date" exist
    const startCandidates = fields.filter((f) => f.name.toLowerCase() === "start date");
    const preferred = startCandidates.find((f) => f.id === FALLBACK_FIELDS.startDate);
    if (preferred) cachedFields.startDate = preferred.id;
  } catch {
    cachedFields = { ...FALLBACK_FIELDS };
  }
  return cachedFields;
}

function parseSummary(summary: string): { friendlyId: string; title: string } {
  const m = String(summary || "").match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) return { friendlyId: m[1], title: m[2] || m[1] };
  return { friendlyId: "", title: summary || "(untitled)" };
}

function milestoneColor(epicKey: string, summary: string, overrides: Record<string, string>): string {
  if (overrides[epicKey]) return overrides[epicKey];
  const m = summary.match(/\[M(\d+)\]/i) || summary.match(/\bM(\d+)\b/i);
  if (m) {
    const key = `M${m[1]}`;
    if (MILESTONE_COLORS[key]) return MILESTONE_COLORS[key];
  }
  const idx = Math.abs(hash(epicKey)) % DEFAULT_COLORS.length;
  return DEFAULT_COLORS[idx];
}

function blockedByKeys(fields: Record<string, unknown>): string[] {
  const links = (fields.issuelinks as Array<Record<string, unknown>>) || [];
  const keys: string[] = [];
  for (const link of links) {
    const type = link.type as { name?: string } | undefined;
    if (!type || type.name !== "Blocks") continue;
    const inward = link.inwardIssue as { key?: string } | undefined;
    if (inward?.key) keys.push(inward.key);
  }
  return keys;
}

function ownerLabel(fields: Record<string, unknown>, fieldMap: FieldMap): string {
  const parts: string[] = [];
  const team = fields[fieldMap.team] as { name?: string; title?: string } | null;
  if (team?.name || team?.title) parts.push(String(team.name || team.title));
  const components = (fields.components as Array<{ name: string }>) || [];
  for (const c of components) if (c.name) parts.push(c.name);
  return parts.join(" · ") || "—";
}

function parseStoryPoints(raw: unknown): number | null {
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
function scheduleFromFields(
  start: string | null,
  due: string | null,
  sp: number | null,
  holidaysOn: boolean,
): { start: string | null; due: string | null; durationDays: number; estDays: number | null } {
  // Jira is source of truth: missing / non-positive SP means no estimate in the app.
  const estDays = sp != null && Number.isFinite(sp) && sp > 0 ? sp : null;
  const estDur = estDays != null ? Math.max(1, Math.round(estDays)) : null;

  // Prefer Story Points as Dur — keep Start, derive Due to match the estimate.
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

  // No Story Points — fall back to date span / defaults.
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

function taskFromIssue(
  issue: JiraIssue,
  fieldMap: FieldMap,
  holidaysOn: boolean,
  resourceId: string | null,
): GanttTask {
  const f = issue.fields;
  const { friendlyId, title } = parseSummary(String(f.summary || ""));
  const startRaw = (f[fieldMap.startDate] as string | null) || null;
  const dueRaw = (f.duedate as string | null) || null;
  const sp = parseStoryPoints(f[fieldMap.storyPoints]);
  const schedule = scheduleFromFields(startRaw, dueRaw, sp, holidaysOn);
  const assignee = f.assignee as { accountId?: string; displayName?: string } | null;
  const status = (f.status as { name?: string } | null)?.name || "—";

  return {
    id: issue.key,
    friendlyId: friendlyId || issue.key,
    title,
    owner: ownerLabel(f, fieldMap),
    start: schedule.start,
    due: schedule.due,
    durationDays: schedule.durationDays,
    estDays: schedule.estDays,
    resourceIds: resourceId ? [resourceId] : [],
    pulledResourceIds: resourceId ? [resourceId] : [],
    status,
    pulledStatus: status,
    pulledStart: schedule.start,
    pulledDue: schedule.due,
    pulledDurationDays: schedule.durationDays,
    pulledEstDays: schedule.estDays,
    transitionId: null,
    assignee: assignee?.displayName || null,
    blockedBy: blockedByKeys(f),
    jiraUpdated: String(f.updated || ""),
    dirty: false,
  };
}

async function searchAll(jql: string, fields: string[]): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  // Prefer new /search/jql; fall back to classic /search
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: 100,
      fields,
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    let res = await jiraFetch("/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.status === 404 || res.status === 410) {
      // Classic search with startAt
      const classicBody = {
        jql,
        startAt: issues.length,
        maxResults: 100,
        fields,
      };
      res = await jiraFetch("/rest/api/3/search", {
        method: "POST",
        body: JSON.stringify(classicBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jira search failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as {
        issues: JiraIssue[];
        total: number;
        startAt: number;
        maxResults: number;
      };
      issues.push(...(data.issues || []));
      if (issues.length >= data.total) break;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira search failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      issues: JiraIssue[];
      nextPageToken?: string;
      isLast?: boolean;
      total?: number;
    };
    issues.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken || !(data.issues || []).length) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
}

async function fetchEpicSummaries(keys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(keys)].filter(Boolean);
  if (!unique.length) return map;
  // Batch by chunk of 50
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const jql = `key in (${chunk.join(",")})`;
    const issues = await searchAll(jql, ["summary"]);
    for (const iss of issues) {
      map.set(iss.key, String((iss.fields as { summary?: string }).summary || iss.key));
    }
  }
  return map;
}

export async function pullFromJira(jql: string): Promise<GanttModel> {
  const fieldMap = await discoverFields();
  const local = readState();
  const holidaysOn = local.showHolidays !== false;
  setCustomNonWorkingDays(local.customNonWorkingDays || []);

  const fields = [
    "summary",
    "parent",
    "duedate",
    "issuelinks",
    "assignee",
    "components",
    "status",
    "updated",
    "issuetype",
    fieldMap.startDate,
    fieldMap.storyPoints,
    fieldMap.team,
    fieldMap.epicLink,
  ];

  const issues = await searchAll(jql, fields);

  // Group stories under parent epic. Childless epics use their own start/due/estimate.
  const tasksByEpic = new Map<string, GanttTask[]>();
  const epicKeysNeeded: string[] = [];
  const epicSummaries = new Map<string, string>();
  const epicIssues = new Map<string, JiraIssue>();
  const resourceById = new Map<string, Resource>();
  const prevColor = new Map((local.resources || []).map((r) => [r.id, r.color]));
  const usedColors = new Set<string>([...prevColor.values()]);

  function ensureEpic(epicKey: string, summary?: string) {
    if (!tasksByEpic.has(epicKey)) tasksByEpic.set(epicKey, []);
    if (summary) epicSummaries.set(epicKey, summary);
  }

  function resourceFromAssignee(assignee: {
    accountId?: string;
    displayName?: string;
  } | null): string | null {
    if (!assignee?.accountId) return null;
    const id = `jira:${assignee.accountId}`;
    if (!resourceById.has(id)) {
      const name = assignee.displayName || assignee.accountId;
      const color = prevColor.get(id) || colorForAssignee(assignee.accountId, usedColors);
      if (prevColor.has(id)) usedColors.add(color);
      resourceById.set(id, {
        id,
        name,
        team: "Jira assignee",
        color,
        initials: initialsFromName(name),
      });
    }
    return id;
  }

  for (const issue of issues) {
    const f = issue.fields;
    const type = f.issuetype as { name?: string; hierarchyLevel?: number } | undefined;
    const hierarchy = type?.hierarchyLevel ?? 0;
    const isEpic = type?.name === "Epic" || hierarchy === 1;

    // Epics: milestone rows. Schedule comes from children, or the epic itself if none.
    // Initiatives / higher hierarchy: skip (not task rows).
    if (hierarchy >= 1) {
      if (isEpic) {
        ensureEpic(issue.key, String(f.summary || issue.key));
        epicIssues.set(issue.key, issue);
      }
      continue;
    }

    const parent = f.parent as { key?: string; fields?: { summary?: string } } | null;
    const epicLink = f[fieldMap.epicLink] as string | null;
    const epicKey = parent?.key || epicLink || "_ungrouped";
    if (epicKey !== "_ungrouped") {
      epicKeysNeeded.push(epicKey);
      if (parent?.fields?.summary) epicSummaries.set(epicKey, parent.fields.summary);
    }

    const assignee = f.assignee as {
      accountId?: string;
      displayName?: string;
    } | null;
    const resourceId = resourceFromAssignee(assignee);
    const task = taskFromIssue(issue, fieldMap, holidaysOn, resourceId);

    ensureEpic(epicKey);
    tasksByEpic.get(epicKey)!.push(task);
  }

  // Childless epics: use the epic's own start/due/story points as a schedule task.
  for (const [epicKey, tasks] of tasksByEpic) {
    if (tasks.length > 0) continue;
    const epicIssue = epicIssues.get(epicKey);
    if (!epicIssue) continue;
    const f = epicIssue.fields;
    const start = (f[fieldMap.startDate] as string | null) || null;
    const due = (f.duedate as string | null) || null;
    const sp = parseStoryPoints(f[fieldMap.storyPoints]);
    if (!start && !due && sp == null) continue;
    const assignee = f.assignee as {
      accountId?: string;
      displayName?: string;
    } | null;
    const resourceId = resourceFromAssignee(assignee);
    tasks.push(taskFromIssue(epicIssue, fieldMap, holidaysOn, resourceId));
  }

  // Fill titles for epics that only appeared as parents of stories
  const missingTitles = epicKeysNeeded.filter((k) => !epicSummaries.has(k));
  if (missingTitles.length) {
    const fetched = await fetchEpicSummaries(missingTitles);
    for (const [k, v] of fetched) epicSummaries.set(k, v);
  }

  const milestones: Milestone[] = [];
  for (const [epicKey, tasks] of tasksByEpic) {
    if (epicKey === "_ungrouped" && tasks.length === 0) continue;
    const summary = epicSummaries.get(epicKey) || epicKey;
    // Epic self-schedule task shares the epic key — don't nest a duplicate row under it.
    const childTasks = tasks.filter((t) => t.id !== epicKey);
    const scheduleTasks = childTasks.length ? childTasks : tasks;
    milestones.push({
      id: epicKey,
      title: summary,
      color: milestoneColor(epicKey, summary, local.milestoneColors),
      collapsed: local.collapsed[epicKey] ?? false,
      tasks: scheduleTasks,
    });
  }

  // Prefer human titles (M0/M1/M2…) over raw keys
  milestones.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));

  // Apply saved manual epic order; unknown/new epics keep title order at the end.
  const msOrder = local.milestoneOrder || [];
  if (msOrder.length) {
    const msPos = new Map(msOrder.map((id, i) => [id, i]));
    milestones.sort((a, b) => {
      const pa = msPos.has(a.id) ? (msPos.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const pb = msPos.has(b.id) ? (msPos.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.title.localeCompare(b.title, undefined, { numeric: true });
    });
  }

  // Restore saved milestone-marker flags.
  const savedMarkers = local.markers || {};
  for (const m of milestones) {
    for (const t of m.tasks) t.isMarker = savedMarkers[t.id] === true;
  }

  // Apply saved manual task order; unknown/new tasks keep Jira order at the end.
  const savedOrder = local.taskOrder || {};
  for (const m of milestones) {
    const ord = savedOrder[m.id];
    if (!ord || !ord.length) continue;
    const pos = new Map(ord.map((id, i) => [id, i]));
    m.tasks = m.tasks
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const pa = pos.has(a.t.id) ? (pos.get(a.t.id) as number) : Number.MAX_SAFE_INTEGER;
        const pb = pos.has(b.t.id) ? (pos.get(b.t.id) as number) : Number.MAX_SAFE_INTEGER;
        return pa - pb || a.i - b.i;
      })
      .map((x) => x.t);
  }

  const projectStart =
    local.projectStart ||
    milestones
      .flatMap((m) => m.tasks.map((t) => t.start).filter(Boolean) as string[])
      .sort()[0] ||
    new Date().toISOString().slice(0, 10);

  const resources = [...resourceById.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const allocations: Record<string, string[]> = {};
  for (const m of milestones) {
    for (const t of m.tasks) allocations[t.id] = t.resourceIds;
  }
  // Persist Jira-derived roster (colors) so they stay stable across pulls
  mergeState({ resources, allocations, jql });

  return {
    title: "Jira Gantt",
    projectStart,
    dayWidthPx: local.dayWidthPx || 28,
    leftPanelWidth: local.leftPanelWidth || 680,
    resourcesDockHeight: local.resourcesDockHeight || 220,
    resourcesDockCollapsed: local.resourcesDockCollapsed === true,
    hoursPerDay: 8,
    showHolidays: local.showHolidays !== false,
    showDeps: local.showDeps !== false,
    customNonWorkingDays: local.customNonWorkingDays ?? [],
    jql,
    resources,
    milestones,
    pulledAt: new Date().toISOString(),
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

export async function getTransitions(issueKey: string): Promise<JiraTransition[]> {
  const res = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`transitions failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    transitions?: Array<{
      id: string;
      name: string;
      to?: { id?: string; name?: string };
    }>;
  };
  return (data.transitions || []).map((t) => ({
    id: t.id,
    name: t.name,
    to: { id: t.to?.id || "", name: t.to?.name || t.name },
  }));
}

function projectKeyFromIssueKey(issueKey: string): string {
  const i = issueKey.lastIndexOf("-");
  return i > 0 ? issueKey.slice(0, i) : issueKey;
}

function worklogStartedIso(startYmd: string | null | undefined): string {
  const ymd = startYmd && /^\d{4}-\d{2}-\d{2}$/.test(startYmd)
    ? startYmd
    : new Date().toISOString().slice(0, 10);
  return `${ymd}T09:00:00.000+0000`;
}

/** Transition payload — includes actual time spent when closing as Done. */
function buildTransitionBody(item: PushItem): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transition: { id: item.transitionId },
  };
  if (!item.timeSpent) return body;
  body.update = {
    worklog: [
      {
        add: {
          timeSpent: item.timeSpent,
          started: worklogStartedIso(item.start),
        },
      },
    ],
  };
  body.fields = {
    timetracking: { remainingEstimate: "0m" },
  };
  return body;
}

async function addWorklog(
  issueKey: string,
  timeSpent: string,
  startYmd: string | null | undefined,
): Promise<{ ok: boolean; message?: string }> {
  const res = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`,
    {
      method: "POST",
      body: JSON.stringify({
        timeSpent,
        started: worklogStartedIso(startYmd),
      }),
    },
  );
  if (res.ok) return { ok: true };
  return {
    ok: false,
    message: `worklog failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
  };
}

/** Transition to the target status; for Done, log actual time spent first. */
async function transitionIssue(item: PushItem): Promise<string | null> {
  const key = item.key;
  const transitionId = item.transitionId!;
  const withTime = buildTransitionBody(item);

  let res = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body: JSON.stringify(withTime),
  });
  if (res.ok || res.status === 204) return null;

  const firstErr = `status transition failed (${res.status}): ${(await res.text()).slice(0, 300)}`;
  if (!item.timeSpent) return firstErr;

  // Some workflows reject worklog-in-transition — log separately, then transition.
  const logged = await addWorklog(key, item.timeSpent, item.start);
  if (!logged.ok) {
    return `${firstErr} · ${logged.message || "could not log actual time"}`;
  }

  res = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body: JSON.stringify({
      transition: { id: transitionId },
      fields: { timetracking: { remainingEstimate: "0m" } },
    }),
  });
  if (res.ok || res.status === 204) return null;
  return `status transition failed after worklog (${res.status}): ${(await res.text()).slice(0, 300)}`;
}

async function createIssueInJira(
  item: PushItem,
  fieldMap: FieldMap,
): Promise<PushResult> {
  const create = item.create!;
  const projectKey = projectKeyFromIssueKey(create.epicKey);
  const issueTypes = ["Story", "Task"];
  let lastError = "create failed";

  for (const typeName of issueTypes) {
    // Prefer parent (next-gen / hierarchy); fall back to Epic Link (classic).
    const sp =
      item.storyPoints != null && Number.isFinite(item.storyPoints) && item.storyPoints > 0
        ? Math.max(1, Math.round(item.storyPoints))
        : null;
    const attempts: Array<Record<string, unknown>> = [
      {
        project: { key: projectKey },
        summary: create.summary,
        issuetype: { name: typeName },
        parent: { key: create.epicKey },
        [fieldMap.startDate]: item.start,
        duedate: item.due,
        ...(sp != null ? { [fieldMap.storyPoints]: sp } : {}),
      },
      {
        project: { key: projectKey },
        summary: create.summary,
        issuetype: { name: typeName },
        [fieldMap.epicLink]: create.epicKey,
        [fieldMap.startDate]: item.start,
        duedate: item.due,
        ...(sp != null ? { [fieldMap.storyPoints]: sp } : {}),
      },
    ];

    for (const fields of attempts) {
      if (item.assigneeAccountId) {
        fields.assignee = { accountId: item.assigneeAccountId };
      }
      const res = await jiraFetch("/rest/api/3/issue", {
        method: "POST",
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        const data = (await res.json()) as { key?: string };
        const createdKey = data.key || "";
        if (!createdKey) {
          return {
            key: create.draftId,
            draftId: create.draftId,
            status: "error",
            message: "create succeeded but no key returned",
          };
        }
        const afterRes = await jiraFetch(
          `/rest/api/3/issue/${encodeURIComponent(createdKey)}?fields=updated`,
        );
        let jiraUpdated = "";
        if (afterRes.ok) {
          const after = (await afterRes.json()) as { fields: { updated: string } };
          jiraUpdated = after.fields.updated;
        }
        return {
          key: createdKey,
          draftId: create.draftId,
          createdKey,
          status: "ok",
          jiraUpdated,
          message: `Created ${createdKey} under ${create.epicKey}`,
        };
      }
      lastError = `create failed (${res.status}): ${(await res.text()).slice(0, 400)}`;
      // Try next shape / issue type
    }
  }

  return {
    key: create.draftId,
    draftId: create.draftId,
    status: "error",
    message: lastError,
  };
}

export async function pushToJira(items: PushItem[]): Promise<PushResult[]> {
  const fieldMap = await discoverFields();
  const results: PushResult[] = [];

  for (const item of items) {
    if (!item.key && !item.create) {
      results.push({ key: "?", status: "skipped", message: "missing key" });
      continue;
    }
    try {
      if (item.create) {
        results.push(await createIssueInJira(item, fieldMap));
        continue;
      }

      // Optimistic lock: re-fetch updated
      const getRes = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(item.key)}?fields=updated,status`,
      );
      if (!getRes.ok) {
        results.push({
          key: item.key,
          status: "error",
          message: `fetch failed (${getRes.status})`,
        });
        continue;
      }
      const current = (await getRes.json()) as {
        fields: { updated: string; status?: { name?: string } };
      };
      const remoteUpdated = current.fields.updated;
      if (item.jiraUpdated && remoteUpdated && remoteUpdated !== item.jiraUpdated) {
        results.push({
          key: item.key,
          status: "conflict",
          message: "Jira was updated since last pull — re-pull to reconcile",
          jiraUpdated: remoteUpdated,
        });
        continue;
      }

      const fields: Record<string, unknown> = {};
      fields[fieldMap.startDate] = item.start;
      fields.duedate = item.due;
      // `null` clears Story Points in Jira; `undefined` leaves the field untouched.
      if (item.storyPoints !== undefined) {
        fields[fieldMap.storyPoints] =
          item.storyPoints != null && Number.isFinite(item.storyPoints) && item.storyPoints > 0
            ? Math.max(1, Math.round(item.storyPoints))
            : null;
      }
      if (item.assigneeAccountId !== undefined) {
        fields.assignee = item.assigneeAccountId
          ? { accountId: item.assigneeAccountId }
          : null;
      }

      const putRes = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.key)}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
      if (!putRes.ok && putRes.status !== 204) {
        const text = await putRes.text();
        results.push({
          key: item.key,
          status: "error",
          message: `schedule update failed (${putRes.status}): ${text.slice(0, 300)}`,
        });
        continue;
      }

      if (item.transitionId) {
        const trErr = await transitionIssue(item);
        if (trErr) {
          results.push({
            key: item.key,
            status: "error",
            message: trErr,
          });
          continue;
        }
      }

      // Re-read updated stamp + status
      const afterRes = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(item.key)}?fields=updated,status`,
      );
      let jiraUpdated = remoteUpdated;
      if (afterRes.ok) {
        const after = (await afterRes.json()) as {
          fields: { updated: string; status?: { name?: string } };
        };
        jiraUpdated = after.fields.updated;
      }
      results.push({ key: item.key, status: "ok", jiraUpdated });
    } catch (err) {
      results.push({
        key: item.key || item.create?.draftId || "?",
        draftId: item.create?.draftId,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function healthCheck(): Promise<{ ok: boolean; site?: string; error?: string }> {
  try {
    requireEnv("JIRA_BASE_URL");
    requireEnv("JIRA_EMAIL");
    requireEnv("JIRA_API_TOKEN");
    const res = await jiraFetch("/rest/api/3/myself");
    if (!res.ok) return { ok: false, error: `auth failed (${res.status})` };
    const me = (await res.json()) as { displayName?: string };
    return { ok: true, site: `${baseUrl()} as ${me.displayName || "user"}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
