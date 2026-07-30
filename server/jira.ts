import type {
  GanttModel,
  GanttTask,
  Milestone,
  PushItem,
  PushResult,
} from "../src/lib/types.ts";
import { DEFAULT_COLORS, MILESTONE_COLORS } from "../src/lib/types.ts";
import { durationFromStartDue } from "../src/lib/workdays.ts";
import { readState } from "./state.ts";

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
      storyPoints: byName.get("story points") || FALLBACK_FIELDS.storyPoints,
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

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
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

  // Exclude epics themselves from task rows; group children under parent/epic
  const tasksByEpic = new Map<string, GanttTask[]>();
  const epicKeysNeeded: string[] = [];

  for (const issue of issues) {
    const f = issue.fields;
    const type = f.issuetype as { name?: string; hierarchyLevel?: number } | undefined;
    if (type?.name === "Epic" || type?.hierarchyLevel === 1) continue;

    const parent = f.parent as { key?: string; fields?: { summary?: string } } | null;
    const epicLink = f[fieldMap.epicLink] as string | null;
    const epicKey = parent?.key || epicLink || "_ungrouped";
    if (epicKey !== "_ungrouped") epicKeysNeeded.push(epicKey);

    const { friendlyId, title } = parseSummary(String(f.summary || ""));
    const start = (f[fieldMap.startDate] as string | null) || null;
    const due = (f.duedate as string | null) || null;
    const durationDays = durationFromStartDue(start, due, holidaysOn);
    const sp = f[fieldMap.storyPoints] as number | null;
    const assignee = f.assignee as { displayName?: string } | null;
    const status = (f.status as { name?: string } | null)?.name || "—";

    const task: GanttTask = {
      id: issue.key,
      friendlyId: friendlyId || issue.key,
      title,
      owner: ownerLabel(f, fieldMap),
      start,
      due,
      durationDays,
      estDays: typeof sp === "number" ? sp : null,
      resourceIds: local.allocations[issue.key] || [],
      status,
      assignee: assignee?.displayName || null,
      blockedBy: blockedByKeys(f),
      jiraUpdated: String(f.updated || ""),
      dirty: false,
    };

    if (!tasksByEpic.has(epicKey)) tasksByEpic.set(epicKey, []);
    tasksByEpic.get(epicKey)!.push(task);
  }

  const epicSummaries = await fetchEpicSummaries(epicKeysNeeded);
  // Prefer parent.fields.summary when present in search results
  for (const issue of issues) {
    const parent = issue.fields.parent as { key?: string; fields?: { summary?: string } } | null;
    if (parent?.key && parent.fields?.summary) epicSummaries.set(parent.key, parent.fields.summary);
  }

  const milestones: Milestone[] = [];
  for (const [epicKey, tasks] of tasksByEpic) {
    const summary = epicSummaries.get(epicKey) || epicKey;
    milestones.push({
      id: epicKey,
      title: summary,
      color: milestoneColor(epicKey, summary, local.milestoneColors),
      collapsed: !!local.collapsed[epicKey],
      tasks,
    });
  }

  // Stable order: by first task start, then key
  milestones.sort((a, b) => a.id.localeCompare(b.id));

  const projectStart =
    local.projectStart ||
    milestones
      .flatMap((m) => m.tasks.map((t) => t.start).filter(Boolean) as string[])
      .sort()[0] ||
    new Date().toISOString().slice(0, 10);

  return {
    title: "Jira Gantt",
    projectStart,
    dayWidthPx: local.dayWidthPx || 28,
    leftPanelWidth: local.leftPanelWidth || 680,
    hoursPerDay: 8,
    showHolidays: local.showHolidays !== false,
    showDeps: local.showDeps !== false,
    jql,
    resources: local.resources || [],
    milestones,
    pulledAt: new Date().toISOString(),
  };
}

export async function pushToJira(items: PushItem[]): Promise<PushResult[]> {
  const fieldMap = await discoverFields();
  const results: PushResult[] = [];

  for (const item of items) {
    if (!item.key) {
      results.push({ key: "?", status: "skipped", message: "missing key" });
      continue;
    }
    try {
      // Optimistic lock: re-fetch updated
      const getRes = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(item.key)}?fields=updated`,
      );
      if (!getRes.ok) {
        results.push({
          key: item.key,
          status: "error",
          message: `fetch failed (${getRes.status})`,
        });
        continue;
      }
      const current = (await getRes.json()) as { fields: { updated: string } };
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

      const putRes = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.key)}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
      if (!putRes.ok && putRes.status !== 204) {
        const text = await putRes.text();
        results.push({
          key: item.key,
          status: "error",
          message: `update failed (${putRes.status}): ${text.slice(0, 300)}`,
        });
        continue;
      }

      // Re-read updated stamp
      const afterRes = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(item.key)}?fields=updated`,
      );
      let jiraUpdated = remoteUpdated;
      if (afterRes.ok) {
        const after = (await afterRes.json()) as { fields: { updated: string } };
        jiraUpdated = after.fields.updated;
      }
      results.push({ key: item.key, status: "ok", jiraUpdated });
    } catch (err) {
      results.push({
        key: item.key,
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
