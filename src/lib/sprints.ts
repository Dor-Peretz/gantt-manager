import type { Sprint, SprintState } from "./types";
import { formatYmd } from "./workdays";

interface RawSprint {
  id?: number | string;
  name?: string;
  state?: string;
  boardId?: number;
  startDate?: string | null;
  endDate?: string | null;
}

function sprintState(raw: string | undefined): SprintState {
  const state = String(raw || "").toLowerCase();
  if (state === "active" || state === "closed" || state === "future") return state;
  return "future";
}

function localYmd(iso: string | null | undefined, offsetMs = 0): string | null {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  if (Number.isNaN(ms)) return null;
  return formatYmd(new Date(ms + offsetMs));
}

/**
 * Jira serializes sprints as objects on modern sites and as
 * `...Sprint@1a2b[id=10,name=Foo,...]` strings on older ones.
 */
function parseLegacySprint(value: string): RawSprint | null {
  const body = value.match(/\[(.*)\]\s*$/)?.[1];
  if (!body) return null;
  const raw: Record<string, string> = {};
  for (const pair of body.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    raw[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const nullable = (key: string) => (raw[key] && raw[key] !== "<null>" ? raw[key] : null);
  if (!raw.id && !raw.name) return null;
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state,
    boardId: raw.rapidViewId ? Number(raw.rapidViewId) : undefined,
    startDate: nullable("startDate"),
    endDate: nullable("endDate"),
  };
}

function toSprint(raw: RawSprint): Sprint | null {
  const id = raw.id != null ? String(raw.id) : "";
  const name = String(raw.name || "").trim();
  if (!id && !name) return null;
  return {
    id: id || name,
    name: name || `Sprint ${id}`,
    state: sprintState(raw.state),
    start: localYmd(raw.startDate),
    // Jira ends a sprint at an exclusive instant (often local midnight) — step back
    // so the band stops on the last day the sprint actually covers.
    end: localYmd(raw.endDate, -1),
    boardId: raw.boardId ?? null,
  };
}

/** Reads one issue's Sprint field value (array of objects, legacy strings, or a single value). */
export function parseSprintField(value: unknown): Sprint[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const out: Sprint[] = [];
  for (const entry of values) {
    if (!entry) continue;
    const raw =
      typeof entry === "string" ? parseLegacySprint(entry) : (entry as RawSprint);
    if (!raw) continue;
    const sprint = toSprint(raw);
    if (sprint) out.push(sprint);
  }
  return out;
}

/** Dedupes sprints by id and orders them by start date so bands render left to right. */
export function dedupeSprints(sprints: Sprint[]): Sprint[] {
  const byId = new Map<string, Sprint>();
  for (const sprint of sprints) {
    const prev = byId.get(sprint.id);
    // Prefer the entry that carries dates — some issues return a bare sprint stub.
    if (!prev || (!prev.start && sprint.start)) byId.set(sprint.id, sprint);
  }
  return [...byId.values()].sort(
    (a, b) => (a.start || "").localeCompare(b.start || "") || a.name.localeCompare(b.name),
  );
}
