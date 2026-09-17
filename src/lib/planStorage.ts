import { PLAN_PROPERTY_CHUNK_PREFIX, PLAN_PROPERTY_KEY, type JiraPlan } from "./types";

/** Jira issue property payload — small plans fit in one blob; large plans use chunks. */
export interface PlanPropertyEnvelope {
  v: 1;
  chunkCount: number;
  revision: number;
  /** Inline JSON when chunkCount === 0 */
  data?: string;
}

const MAX_CHUNK_CHARS = 28000;

export function serializePlan(plan: JiraPlan): PlanPropertyEnvelope {
  const json = JSON.stringify(plan);
  if (json.length <= MAX_CHUNK_CHARS) {
    return { v: 1, chunkCount: 0, revision: plan.revision, data: json };
  }
  const chunkCount = Math.ceil(json.length / MAX_CHUNK_CHARS);
  return { v: 1, chunkCount, revision: plan.revision };
}

export function planJsonChunks(plan: JiraPlan): string[] {
  const json = JSON.stringify(plan);
  if (json.length <= MAX_CHUNK_CHARS) return [];
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += MAX_CHUNK_CHARS) {
    chunks.push(json.slice(i, i + MAX_CHUNK_CHARS));
  }
  return chunks;
}

export function chunkPropertyKey(index: number): string {
  return `${PLAN_PROPERTY_CHUNK_PREFIX}.${index}`;
}

export function deserializePlan(
  envelope: PlanPropertyEnvelope,
  chunks: string[],
): JiraPlan {
  let json: string;
  if (envelope.chunkCount === 0) {
    if (!envelope.data) throw new Error("Plan property missing inline data");
    json = envelope.data;
  } else {
    if (chunks.length !== envelope.chunkCount) {
      throw new Error(
        `Plan chunks mismatch: expected ${envelope.chunkCount}, got ${chunks.length}`,
      );
    }
    json = chunks.join("");
  }
  const parsed = JSON.parse(json) as JiraPlan;
  if (parsed.v !== 1) throw new Error(`Unsupported plan version: ${String(parsed.v)}`);
  return parsed;
}

export function emptyPlan(draftTicketKey: string, projectStart?: string): JiraPlan {
  const today = projectStart || new Date().toISOString().slice(0, 10);
  return {
    v: 1,
    draftTicketKey,
    revision: 1,
    updatedAt: new Date().toISOString(),
    publishState: "draft",
    projectStart: today,
    showHolidays: true,
    showPolishHolidays: false,
    workingWeekdays: [0, 1, 2, 3, 4],
    epics: [],
    publishedKeys: {},
  };
}

export { PLAN_PROPERTY_KEY };
