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
import type { LocalState, PushItem, QaItem } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  const h = await healthCheck();
  res.status(h.ok ? 200 : 503).json(h);
});

app.get("/api/config", (_req, res) => {
  const state = readState();
  res.json({
    jql: state.jql || process.env.JIRA_JQL || "",
    baseUrl: process.env.JIRA_BASE_URL || "",
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
      process.env.JIRA_JQL ||
      "";
    if (!jql) {
      res.status(400).json({ error: "Missing JQL. Set JIRA_JQL in .env or pass ?jql=" });
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
    const results = await pushToJira(items);
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
    const transitions = await getTransitions(key);
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
    await saveQaItem(item, previousLinkedKeys);
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
    await deleteQaItem(itemId, linkedIssueKeys);
    res.json({ ok: true });
  } catch (err) {
    console.error("qa delete failed", err);
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
});
