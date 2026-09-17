/**
 * Plan mode storage: a whole plan (epics + tasks that are not Jira issues yet) is
 * persisted as an issue property on one Jira "draft ticket", then published as real
 * issues on request. Large plans are split across numbered chunk properties.
 */
import type {
  JiraPlan,
  PlanLoadResult,
  PlanPublishItemResult,
  PlanPublishResult,
  PlanSaveResult,
  PlanValidateResult,
} from "../src/lib/types.ts";
import {
  chunkPropertyKey,
  deserializePlan,
  emptyPlan,
  planJsonChunks,
  serializePlan,
  PLAN_PROPERTY_KEY,
  type PlanPropertyEnvelope,
} from "../src/lib/planStorage.ts";
import { jiraFetch } from "./jira.ts";

interface PlanFieldMap {
  startDate: string;
  storyPoints: string;
  team: string;
  epicLink: string;
  epicName: string;
}

const FALLBACK_FIELDS: PlanFieldMap = {
  startDate: "customfield_10907",
  storyPoints: "customfield_10008",
  team: "customfield_10500",
  epicLink: "customfield_10004",
  epicName: "customfield_10011",
};

let cachedFields: PlanFieldMap | null = null;

async function discoverPlanFields(): Promise<PlanFieldMap> {
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
        FALLBACK_FIELDS.storyPoints,
      team: byName.get("team") || FALLBACK_FIELDS.team,
      epicLink: byName.get("epic link") || FALLBACK_FIELDS.epicLink,
      epicName:
        byName.get("epic name") || byName.get("epic title") || FALLBACK_FIELDS.epicName,
    };
  } catch {
    cachedFields = { ...FALLBACK_FIELDS };
  }
  return cachedFields;
}

function projectKeyFromIssueKey(issueKey: string): string {
  const i = issueKey.lastIndexOf("-");
  return i > 0 ? issueKey.slice(0, i) : issueKey;
}

function adfParagraph(text: string): Record<string, unknown> {
  const body = text.trim() || "Gantt Manager plan.";
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
  };
}

function propertyPath(issueKey: string, key: string): string {
  return `/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(key)}`;
}

async function readPlanProperty(issueKey: string): Promise<JiraPlan | null> {
  const res = await jiraFetch(propertyPath(issueKey, PLAN_PROPERTY_KEY));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`read plan failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { value?: PlanPropertyEnvelope };
  const envelope = data.value;
  if (!envelope || envelope.v !== 1) return null;
  if (envelope.chunkCount === 0) return deserializePlan(envelope, []);

  const chunks: string[] = [];
  for (let i = 0; i < envelope.chunkCount; i++) {
    const chunkRes = await jiraFetch(propertyPath(issueKey, chunkPropertyKey(i)));
    if (!chunkRes.ok) throw new Error(`read plan chunk ${i} failed (${chunkRes.status})`);
    const chunkData = (await chunkRes.json()) as { value?: string };
    chunks.push(String(chunkData.value || ""));
  }
  return deserializePlan(envelope, chunks);
}

async function writePlanProperty(issueKey: string, plan: JiraPlan): Promise<void> {
  const envelope = serializePlan(plan);
  const mainRes = await jiraFetch(propertyPath(issueKey, PLAN_PROPERTY_KEY), {
    method: "PUT",
    body: JSON.stringify(envelope),
  });
  if (!mainRes.ok) {
    throw new Error(
      `write plan failed (${mainRes.status}): ${(await mainRes.text()).slice(0, 200)}`,
    );
  }

  const chunks = planJsonChunks(plan);
  for (let i = 0; i < chunks.length; i++) {
    const chunkRes = await jiraFetch(propertyPath(issueKey, chunkPropertyKey(i)), {
      method: "PUT",
      body: JSON.stringify(chunks[i]),
    });
    if (!chunkRes.ok) throw new Error(`write plan chunk ${i} failed (${chunkRes.status})`);
  }
}

async function appendPublishedComment(issueKey: string, lines: string[]): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: adfParagraph(lines.join("\n")) }),
  });
}

export async function validateDraftTicket(issueKey: string): Promise<PlanValidateResult> {
  const key = issueKey.trim();
  if (!key) return { ok: false, error: "Enter a Jira draft ticket key or URL" };
  try {
    const res = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`,
    );
    if (!res.ok) return { ok: false, error: `Could not load ${key} (${res.status})` };
    const data = (await res.json()) as {
      key?: string;
      fields?: { summary?: string };
    };
    return { ok: true, key: data.key || key, summary: data.fields?.summary || key };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPlanFromDraft(
  issueKey: string,
  viewerEmail?: string,
): Promise<PlanLoadResult> {
  const validation = await validateDraftTicket(issueKey);
  if (!validation.ok || !validation.key) {
    throw new Error(validation.error || "Invalid draft ticket");
  }
  const existing = await readPlanProperty(validation.key);
  if (existing) {
    if (existing.draftTicketKey !== validation.key) {
      existing.draftTicketKey = validation.key;
    }
    return { plan: existing, created: false };
  }
  const plan = emptyPlan(validation.key);
  if (viewerEmail) plan.updatedBy = viewerEmail;
  await writePlanProperty(validation.key, plan);
  return { plan, created: true };
}

export async function savePlanToDraft(
  plan: JiraPlan,
  expectedRevision?: number,
): Promise<PlanSaveResult> {
  const key = plan.draftTicketKey;
  const remote = await readPlanProperty(key);
  if (remote && expectedRevision != null && remote.revision !== expectedRevision) {
    throw new Error(
      `Plan was updated elsewhere (revision ${remote.revision} vs ${expectedRevision}). Reload to continue.`,
    );
  }
  const next: JiraPlan = {
    ...plan,
    revision: (remote?.revision || plan.revision) + 1,
    updatedAt: new Date().toISOString(),
  };
  await writePlanProperty(key, next);
  return { plan: next };
}

async function creatableEpicType(projectKey: string): Promise<string> {
  try {
    const res = await jiraFetch(
      `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    );
    if (!res.ok) return "Epic";
    const data = (await res.json()) as {
      issueTypes?: Array<{ name?: string; hierarchyLevel?: number }>;
    };
    const epic = (data.issueTypes || []).find(
      (t) => t.name === "Epic" || t.hierarchyLevel === 1,
    );
    return epic?.name || "Epic";
  } catch {
    return "Epic";
  }
}

async function creatableTaskTypes(projectKey: string): Promise<string[]> {
  const preferred = ["Story", "Eng Story", "Task"];
  try {
    const res = await jiraFetch(
      `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    );
    if (!res.ok) return preferred;
    const data = (await res.json()) as {
      issueTypes?: Array<{ name?: string; subtask?: boolean; hierarchyLevel?: number }>;
    };
    const available = (data.issueTypes || [])
      .filter((t) => t.name && !t.subtask && (t.hierarchyLevel ?? 0) === 0)
      .map((t) => t.name as string);
    return [
      ...preferred.filter((n) => available.includes(n)),
      ...available.filter((n) => !preferred.includes(n)),
    ];
  } catch {
    return preferred;
  }
}

async function teamIdFromEpic(epicKey: string, teamField: string): Promise<string | null> {
  try {
    const res = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(epicKey)}?fields=${encodeURIComponent(teamField)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { fields?: Record<string, unknown> };
    const team = data.fields?.[teamField] as { id?: string } | string | null;
    if (typeof team === "string" && team) return team;
    if (team && typeof team === "object" && typeof team.id === "string") return team.id;
  } catch {
    /* non-fatal */
  }
  return null;
}

async function createEpic(
  projectKey: string,
  title: string,
  fieldMap: PlanFieldMap,
  teamId: string | null,
): Promise<{ key: string } | { error: string }> {
  const epicType = await creatableEpicType(projectKey);
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    issuetype: { name: epicType },
    summary: title,
    description: adfParagraph(`Planned epic: ${title}`),
  };
  if (fieldMap.epicName) fields[fieldMap.epicName] = title;
  if (teamId) fields[fieldMap.team] = teamId;

  const res = await jiraFetch("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    return { error: `epic create failed (${res.status}): ${(await res.text()).slice(0, 300)}` };
  }
  const data = (await res.json()) as { key?: string };
  if (!data.key) return { error: "epic create succeeded but no key returned" };
  return { key: data.key };
}

async function createTaskUnderEpic(
  epicKey: string,
  title: string,
  start: string | null,
  due: string | null,
  storyPoints: number | null,
  assigneeAccountId: string | null,
  fieldMap: PlanFieldMap,
  teamId: string | null,
): Promise<{ key: string } | { error: string }> {
  const projectKey = projectKeyFromIssueKey(epicKey);
  const issueTypes = await creatableTaskTypes(projectKey);

  const baseFields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: title,
    description: adfParagraph(title),
    priority: { name: "Medium" },
    [fieldMap.startDate]: start,
    duedate: due,
  };
  if (storyPoints != null && storyPoints > 0) {
    baseFields[fieldMap.storyPoints] = Math.max(1, Math.round(storyPoints));
  }
  if (teamId) baseFields[fieldMap.team] = teamId;
  if (assigneeAccountId) baseFields.assignee = { accountId: assigneeAccountId };

  for (const typeName of issueTypes) {
    const attempts: Array<Record<string, unknown>> = [
      { ...baseFields, issuetype: { name: typeName }, parent: { key: epicKey } },
      { ...baseFields, issuetype: { name: typeName }, [fieldMap.epicLink]: epicKey },
    ];
    for (const fields of attempts) {
      const res = await jiraFetch("/rest/api/3/issue", {
        method: "POST",
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        const data = (await res.json()) as { key?: string };
        if (data.key) return { key: data.key };
      }
    }
  }
  return { error: "task create failed for all issue types" };
}

export async function publishPlan(plan: JiraPlan): Promise<PlanPublishResult> {
  if (plan.publishState === "published") {
    return { plan, results: [], allOk: true };
  }

  const fieldMap = await discoverPlanFields();
  const projectKey = projectKeyFromIssueKey(plan.draftTicketKey);
  const teamId = await teamIdFromEpic(plan.draftTicketKey, fieldMap.team);
  const publishedKeys: Record<string, string> = { ...(plan.publishedKeys || {}) };
  const results: PlanPublishItemResult[] = [];
  const epics = plan.epics.map((e) => ({ ...e, tasks: [...e.tasks] }));

  for (const epic of epics) {
    let epicKey = epic.publishedKey || publishedKeys[epic.id];
    if (!epicKey) {
      const created = await createEpic(projectKey, epic.title, fieldMap, teamId);
      if ("error" in created) {
        results.push({
          planId: epic.id,
          kind: "epic",
          title: epic.title,
          status: "error",
          message: created.error,
        });
        return { plan, results, allOk: false };
      }
      epicKey = created.key;
      epic.publishedKey = epicKey;
      publishedKeys[epic.id] = epicKey;
      results.push({
        planId: epic.id,
        kind: "epic",
        title: epic.title,
        status: "ok",
        jiraKey: epicKey,
      });
    } else {
      results.push({
        planId: epic.id,
        kind: "epic",
        title: epic.title,
        status: "skipped",
        jiraKey: epicKey,
        message: "Already created",
      });
    }

    for (const task of epic.tasks) {
      const existingKey = publishedKeys[task.id];
      if (existingKey) {
        results.push({
          planId: task.id,
          kind: "task",
          title: task.title,
          status: "skipped",
          jiraKey: existingKey,
          message: "Already created",
        });
        continue;
      }
      const sp =
        task.estDays != null && task.estDays > 0
          ? Math.max(1, Math.round(task.estDays))
          : Math.max(1, Math.round(task.durationDays || 1));
      const created = await createTaskUnderEpic(
        epicKey,
        task.title,
        task.start,
        task.due,
        sp,
        task.assigneeAccountId,
        fieldMap,
        teamId,
      );
      if ("error" in created) {
        results.push({
          planId: task.id,
          kind: "task",
          title: task.title,
          status: "error",
          message: created.error,
        });
        // Keep the keys created so far so a retry does not duplicate them.
        const partialPlan: JiraPlan = {
          ...plan,
          epics,
          publishedKeys,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        await writePlanProperty(plan.draftTicketKey, partialPlan);
        return { plan: partialPlan, results, allOk: false };
      }
      publishedKeys[task.id] = created.key;
      results.push({
        planId: task.id,
        kind: "task",
        title: task.title,
        status: "ok",
        jiraKey: created.key,
      });
    }
  }

  const linkLines = results
    .filter((r) => r.status === "ok" && r.jiraKey)
    .map((r) => `${r.kind === "epic" ? "Epic" : "Task"}: ${r.jiraKey} — ${r.title}`);

  const publishedPlan: JiraPlan = {
    ...plan,
    epics,
    publishedKeys,
    publishState: "published",
    publishedAt: new Date().toISOString(),
    revision: plan.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writePlanProperty(plan.draftTicketKey, publishedPlan);

  if (linkLines.length) {
    try {
      await appendPublishedComment(plan.draftTicketKey, [
        "Gantt Manager — plan published",
        ...linkLines,
        `Published at ${publishedPlan.publishedAt}`,
      ]);
    } catch {
      /* comment is best-effort */
    }
  }

  return { plan: publishedPlan, results, allOk: true };
}
