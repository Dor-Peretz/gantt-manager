import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GanttModel } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, "..", "gantt-cache.json");

export interface ScrollState {
  tasksLeft: number;
  tasksTop: number;
  resLeft: number;
}

export interface GanttCache {
  model: GanttModel;
  scroll: ScrollState;
  savedAt: string;
}

const EMPTY_SCROLL: ScrollState = { tasksLeft: 0, tasksTop: 0, resLeft: 0 };

export function readCache(): GanttCache | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Partial<GanttCache>;
    if (!raw?.model?.milestones) return null;
    return {
      model: raw.model,
      scroll: { ...EMPTY_SCROLL, ...(raw.scroll || {}) },
      savedAt: raw.savedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCache(cache: GanttCache): GanttCache {
  const next: GanttCache = {
    model: cache.model,
    scroll: { ...EMPTY_SCROLL, ...(cache.scroll || {}) },
    savedAt: cache.savedAt || new Date().toISOString(),
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function mergeCache(partial: Partial<GanttCache>): GanttCache | null {
  const current = readCache();
  if (!partial.model && !current) return null;
  return writeCache({
    model: partial.model || current!.model,
    scroll: { ...EMPTY_SCROLL, ...(current?.scroll || {}), ...(partial.scroll || {}) },
    savedAt: new Date().toISOString(),
  });
}
