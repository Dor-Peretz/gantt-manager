import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalState } from "../src/lib/types.ts";
import { normalizeState } from "../src/domain/stateDefaults.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREFS_PATH = path.resolve(ROOT, "preferences.json");
const LEGACY_PATH = path.resolve(ROOT, "gantt-state.json");

function migrateLegacyIfNeeded(): void {
  if (fs.existsSync(PREFS_PATH) || !fs.existsSync(LEGACY_PATH)) return;
  try {
    fs.renameSync(LEGACY_PATH, PREFS_PATH);
    console.log("Migrated gantt-state.json → preferences.json");
  } catch {
    try {
      fs.copyFileSync(LEGACY_PATH, PREFS_PATH);
    } catch {
      /* ignore */
    }
  }
}

/** Shared defaults with the UI, plus the .env fallback for the initial JQL. */
function normalize(raw: Partial<LocalState> | null | undefined): LocalState {
  const state = normalizeState(raw);
  return { ...state, jql: state.jql || process.env.JIRA_JQL || "" };
}

export function prefsPath(): string {
  return PREFS_PATH;
}

export function readState(): LocalState {
  migrateLegacyIfNeeded();
  try {
    if (!fs.existsSync(PREFS_PATH)) {
      return normalize({ jql: process.env.JIRA_JQL || "" });
    }
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8")) as Partial<LocalState>;
    return normalize(raw);
  } catch {
    return normalize({ jql: process.env.JIRA_JQL || "" });
  }
}

export function writeState(state: LocalState): LocalState {
  const next = normalize(state);
  fs.writeFileSync(PREFS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function mergeState(partial: Partial<LocalState>): LocalState {
  const current = readState();
  return writeState({ ...current, ...partial });
}
