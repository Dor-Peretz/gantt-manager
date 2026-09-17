import {
  deleteQaItem,
  fetchChangelogs,
  fetchConfig,
  fetchHealth,
  fetchTransitions,
  loadCache,
  loadPlan,
  loadState,
  publishPlan,
  pullGantt,
  pushGantt,
  saveCache,
  savePlan,
  saveQaItem,
  saveState,
  validateDraftTicket,
  type GanttCache,
} from "../api";
import type { GanttConfig, GanttStore } from "./GanttStore";
import type {
  GanttModel,
  JiraPlan,
  LocalState,
  PushItem,
  QaItem,
} from "../lib/types";

/** Talks to the local Express server, which owns preferences.json and the Jira calls. */
export class ServerStore implements GanttStore {
  readonly kind = "local" as const;

  async getConfig(_viewerEmail: string): Promise<GanttConfig> {
    const cfg = await fetchConfig();
    const preferences = cfg.preferences ?? (await loadState());
    return { jql: cfg.jql, baseUrl: cfg.baseUrl, preferences };
  }

  getHealth() {
    return fetchHealth();
  }

  pull(jql: string, _viewerEmail: string): Promise<GanttModel> {
    return pullGantt(jql);
  }

  push(items: PushItem[]) {
    return pushGantt(items);
  }

  getTransitions(issueKey: string) {
    return fetchTransitions(issueKey);
  }

  fetchChangelogs(keys: string[]) {
    return fetchChangelogs(keys);
  }

  getPreferences(_viewerEmail: string): Promise<LocalState> {
    return loadState();
  }

  savePreferences(_viewerEmail: string, partial: Partial<LocalState>): Promise<LocalState> {
    return saveState(partial);
  }

  loadCache(_viewerEmail: string): Promise<GanttCache | null> {
    return loadCache();
  }

  async saveCache(_viewerEmail: string, cache: GanttCache): Promise<GanttCache> {
    const saved = await saveCache(cache);
    // The server echoes the stored cache; fall back to what we sent if it 204s.
    return saved ?? cache;
  }

  saveQaItem(item: QaItem, previousLinkedKeys: string[] = []) {
    return saveQaItem(item, previousLinkedKeys);
  }

  deleteQaItem(itemId: string, linkedIssueKeys: string[]) {
    return deleteQaItem(itemId, linkedIssueKeys);
  }

  validateDraftTicket(issueKey: string) {
    return validateDraftTicket(issueKey);
  }

  loadPlan(draftTicketKey: string, viewerEmail: string) {
    return loadPlan(draftTicketKey, viewerEmail);
  }

  savePlan(plan: JiraPlan, expectedRevision?: number) {
    return savePlan(plan, expectedRevision);
  }

  publishPlan(plan: JiraPlan) {
    return publishPlan(plan);
  }
}

/** Keeps a stable instance so App's `useCallback` deps never churn. */
export const serverStore = new ServerStore();
