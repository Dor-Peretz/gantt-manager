import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import { mergeCache, readCache, writeCache, type GanttCache } from "./cache.ts";
import {
  deleteQaItem,
  fetchChangelogs,
  getTransitions,
  healthCheck,
  pullFromJira,
  pushToJira,
  saveQaItem,
} from "./jira.ts";
import { mergeState, readState, writeState } from "./state.ts";
import { loadPlanFromDraft, publishPlan, savePlanToDraft, validateDraftTicket } from "./plan.ts";
import {
  DEMO_BASE_URL,
  DEMO_JQL,
  demoDeleteQaItem,
  demoHealth,
  demoLoadPlan,
  demoPublishPlan,
  demoPull,
  demoPush,
  demoSavePlan,
  demoSaveQaItem,
  demoTransitions,
  demoValidateDraftTicket,
  isDemo,
} from "./demo.ts";
import type { JiraPlan, LocalState, PushItem, QaItem } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  if (isDemo()) {
    res.json(demoHealth());
    return;
  }
  const h = await healthCheck();
  res.status(h.ok ? 200 : 503).json(h);
});

app.get("/api/config", (_req, res) => {
  const state = readState();
  res.json({
    jql: state.jql || (isDemo() ? DEMO_JQL : process.env.JIRA_JQL || ""),
    baseUrl: isDemo() ? DEMO_BASE_URL : process.env.JIRA_BASE_URL || "",
    prefsFile: "preferences.json",
    preferences: state,
  });
});

app.get("/api/state", (_req, res) => {
  res.json(readState());
});

app.put("/api/state", (req, res) => {
  try {
    const body = req.body as Partial<LocalState>;
    const next = mergeState(body);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/state", (req, res) => {
  try {
    const next = writeState(req.body as LocalState);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/cache", (_req, res) => {
  const cache = readCache();
  if (!cache) {
    res.status(204).end();
    return;
  }
  res.json(cache);
});

app.put("/api/cache", (req, res) => {
  try {
    const body = req.body as Partial<GanttCache>;
    if (body.model) {
      res.json(writeCache({
        model: body.model,
        scroll: body.scroll || { tasksLeft: 0, tasksTop: 0, resLeft: 0 },
        savedAt: new Date().toISOString(),
      }));
      return;
    }
    const next = mergeCache(body);
    if (!next) {
      res.status(400).json({ error: "No cache to update" });
      return;
    }
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/pull", async (req, res) => {
  try {
    const jql =
      (typeof req.query.jql === "string" && req.query.jql.trim()) ||
      readState().jql ||
      (isDemo() ? DEMO_JQL : process.env.JIRA_JQL) ||
      "";
    if (!jql) {
      res.status(400).json({ error: "Missing JQL. Set JIRA_JQL in .env or pass ?jql=" });
      return;
    }
    if (isDemo()) {
      const pulled = demoPull(jql, readState());
      mergeState({ resources: pulled.resources, allocations: pulled.allocations, jql });
      res.json(pulled.model);
      return;
    }
    mergeState({ jql });
    const model = await pullFromJira(jql);
    res.json(model);
  } catch (err) {
    console.error("pull failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/push", async (req, res) => {
  try {
    const items = (req.body?.items || []) as PushItem[];
    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: "body.items required" });
      return;
    }
    const results = isDemo() ? demoPush(items) : await pushToJira(items);
    res.json({ results });
  } catch (err) {
    console.error("push failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/transitions/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) {
      res.status(400).json({ error: "issue key required" });
      return;
    }
    const transitions = isDemo() ? demoTransitions() : await getTransitions(key);
    res.json({ key, transitions });
  } catch (err) {
    console.error("transitions failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/changelogs", async (req, res) => {
  try {
    const keys = (req.body?.keys || []) as string[];
    if (!Array.isArray(keys) || !keys.length) {
      res.status(400).json({ error: "body.keys required" });
      return;
    }
    if (isDemo()) {
      res.json({
        changelogs: [],
        fieldMap: { startDate: "customfield_10907", storyPoints: "customfield_10008" },
      });
      return;
    }
    res.json(await fetchChangelogs(keys));
  } catch (err) {
    console.error("changelogs failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/qa", async (req, res) => {
  try {
    const item = req.body?.item as QaItem | undefined;
    if (!item?.id || !Array.isArray(item.linkedIssueKeys)) {
      res.status(400).json({ error: "body.item with linkedIssueKeys required" });
      return;
    }
    const previousLinkedKeys = (req.body?.previousLinkedKeys || []) as string[];
    if (isDemo()) demoSaveQaItem(item);
    else await saveQaItem(item, previousLinkedKeys);
    res.json({ ok: true });
  } catch (err) {
    console.error("qa save failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/qa", async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || "").trim();
    const linkedIssueKeys = (req.body?.linkedIssueKeys || []) as string[];
    if (!itemId) {
      res.status(400).json({ error: "body.itemId required" });
      return;
    }
    if (isDemo()) demoDeleteQaItem(itemId);
    else await deleteQaItem(itemId, linkedIssueKeys);
    res.json({ ok: true });
  } catch (err) {
    console.error("qa delete failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/plan/validate", async (req, res) => {
  try {
    const key = String(req.query.key || "").trim();
    res.json(isDemo() ? demoValidateDraftTicket(key) : await validateDraftTicket(key));
  } catch (err) {
    console.error("plan validate failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/plan/load", async (req, res) => {
  try {
    const draftTicketKey = String(req.body?.draftTicketKey || "").trim();
    const viewerEmail =
      typeof req.body?.viewerEmail === "string" ? req.body.viewerEmail : undefined;
    if (!draftTicketKey) {
      res.status(400).json({ error: "body.draftTicketKey required" });
      return;
    }
    res.json(
      isDemo()
        ? demoLoadPlan(draftTicketKey, viewerEmail)
        : await loadPlanFromDraft(draftTicketKey, viewerEmail),
    );
  } catch (err) {
    console.error("plan load failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/plan/save", async (req, res) => {
  try {
    const plan = req.body?.plan as JiraPlan | undefined;
    if (!plan?.draftTicketKey) {
      res.status(400).json({ error: "body.plan with draftTicketKey required" });
      return;
    }
    const expectedRevision =
      typeof req.body?.expectedRevision === "number" ? req.body.expectedRevision : undefined;
    res.json(isDemo() ? demoSavePlan(plan) : await savePlanToDraft(plan, expectedRevision));
  } catch (err) {
    console.error("plan save failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/plan/publish", async (req, res) => {
  try {
    const plan = req.body?.plan as JiraPlan | undefined;
    if (!plan?.draftTicketKey) {
      res.status(400).json({ error: "body.plan with draftTicketKey required" });
      return;
    }
    res.json(isDemo() ? demoPublishPlan(plan) : await publishPlan(plan));
  } catch (err) {
    console.error("plan publish failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const dist = path.resolve(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(dist, "index.html"), (err) => {
    if (err) res.status(404).send("Build the UI with `npm run build`, or use `npm run dev`.");
  });
});

app.listen(PORT, () => {
  console.log(`Gantt Manager · API http://localhost:${PORT}`);
  if (isDemo()) {
    console.log("Demo mode — fake Jira data, preferences.demo.json, no real Jira calls");
  }
});
