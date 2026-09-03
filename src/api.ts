import type {
  GanttModel,
  HistoryFieldMap,
  IssueChangelog,
  LocalState,
  PushItem,
  PushResult,
  QaItem,
  StatusTransition,
} from "./lib/types";

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function fetchConfig(): Promise<{
  jql: string;
  baseUrl: string;
  prefsFile?: string;
  preferences?: import("./lib/types").LocalState;
}> {
  return json(await fetch("/api/config"));
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  site?: string;
  displayName?: string;
  error?: string;
}> {
  return json(await fetch("/api/health"));
}

export async function pullGantt(jql: string): Promise<GanttModel> {
  const q = new URLSearchParams({ jql });
  return json(await fetch(`/api/pull?${q}`));
}

export async function pushGantt(items: PushItem[]): Promise<{ results: PushResult[] }> {
  return json(
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),
  );
}

export async function saveState(partial: Partial<LocalState>): Promise<LocalState> {
  return json(
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }),
  );
}

export async function loadState(): Promise<LocalState> {
  return json(await fetch("/api/state"));
}

export async function loadCache(): Promise<GanttCache | null> {
  const res = await fetch("/api/cache");
  if (res.status === 204) return null;
  return json(res);
}

export async function saveCache(partial: Partial<GanttCache>): Promise<GanttCache> {
  return json(
    await fetch("/api/cache", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }),
  );
}

export async function fetchTransitions(
  issueKey: string,
): Promise<{ key: string; transitions: StatusTransition[] }> {
  return json(await fetch(`/api/transitions/${encodeURIComponent(issueKey)}`));
}

export async function fetchChangelogs(
  keys: string[],
): Promise<{ changelogs: IssueChangelog[]; fieldMap: HistoryFieldMap }> {
  return json(
    await fetch("/api/changelogs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }),
  );
}

/** QA items live on their linked Jira issues as an issue property. */
export async function saveQaItem(
  item: QaItem,
  previousLinkedKeys: string[] = [],
): Promise<void> {
  await json(
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, previousLinkedKeys }),
    }),
  );
}

export async function deleteQaItem(
  itemId: string,
  linkedIssueKeys: string[],
): Promise<void> {
  await json(
    await fetch("/api/qa", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, linkedIssueKeys }),
    }),
  );
}
