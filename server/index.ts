import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dotenv from "dotenv";
import { healthCheck, pullFromJira, pushToJira } from "./jira.ts";
import { mergeState, readState, writeState } from "./state.ts";
import type { LocalState, PushItem } from "../src/lib/types.ts";

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

const dist = path.resolve(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(dist, "index.html"), (err) => {
    if (err) res.status(404).send("Build the UI with `npm run build`, or use `npm run dev`.");
  });
});

app.listen(PORT, () => {
  console.log(`Gantt Manager API on http://localhost:${PORT}`);
});
