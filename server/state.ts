import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalState } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, "..", "gantt-state.json");

const DEFAULT_STATE: LocalState = {
  resources: [],
  allocations: {},
  collapsed: {},
  projectStart: new Date().toISOString().slice(0, 10),
  showHolidays: true,
  showDeps: true,
  dayWidthPx: 28,
  leftPanelWidth: 680,
  jql: process.env.JIRA_JQL || "",
  milestoneColors: {},
};

export function readState(): LocalState {
  try {
    if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE, jql: process.env.JIRA_JQL || "" };
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<LocalState>;
    return {
      ...DEFAULT_STATE,
      ...raw,
      resources: raw.resources ?? [],
      allocations: raw.allocations ?? {},
      collapsed: raw.collapsed ?? {},
      milestoneColors: raw.milestoneColors ?? {},
      jql: raw.jql ?? process.env.JIRA_JQL ?? "",
    };
  } catch {
    return { ...DEFAULT_STATE, jql: process.env.JIRA_JQL || "" };
  }
}

export function writeState(state: LocalState): LocalState {
  const next: LocalState = {
    ...DEFAULT_STATE,
    ...state,
    resources: state.resources ?? [],
    allocations: state.allocations ?? {},
    collapsed: state.collapsed ?? {},
    milestoneColors: state.milestoneColors ?? {},
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function mergeState(partial: Partial<LocalState>): LocalState {
  const current = readState();
  return writeState({ ...current, ...partial });
}
