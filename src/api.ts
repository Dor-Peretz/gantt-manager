import type { GanttModel, LocalState, PushItem, PushResult } from "./lib/types";

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

export async function fetchConfig(): Promise<{ jql: string; baseUrl: string }> {
  return json(await fetch("/api/config"));
}

export async function fetchHealth(): Promise<{ ok: boolean; site?: string; error?: string }> {
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
