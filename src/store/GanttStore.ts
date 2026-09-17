import type {
  GanttModel,
  HistoryFieldMap,
  IssueChangelog,
  JiraPlan,
  LocalState,
  PlanLoadResult,
  PlanPublishResult,
  PlanSaveResult,
  PlanValidateResult,
  PushItem,
  PushResult,
  QaItem,
  StatusTransition,
} from "../lib/types";

import type { GanttCache, ScrollState } from "../api";

export interface GanttConfig {
  jql: string;
  baseUrl: string;
  preferences: LocalState;
}

/**
 * Data layer the board talks to. The local app has a single implementation backed by
 * the Express server; the `viewerEmail` arguments exist so the shape stays identical
 * to the Datadog build, where preferences are stored per viewer.
 */
export interface GanttStore {
  readonly kind: "local" | "datadog";

  getConfig(viewerEmail: string): Promise<GanttConfig>;
  getHealth(): Promise<{ ok: boolean; site?: string; displayName?: string; error?: string }>;
  pull(jql: string, viewerEmail: string): Promise<GanttModel>;
  push(items: PushItem[]): Promise<{ results: PushResult[] }>;
  getTransitions(issueKey: string): Promise<{ key: string; transitions: StatusTransition[] }>;
  fetchChangelogs(
    keys: string[],
  ): Promise<{ changelogs: IssueChangelog[]; fieldMap: HistoryFieldMap }>;
  getPreferences(viewerEmail: string): Promise<LocalState>;
  savePreferences(viewerEmail: string, partial: Partial<LocalState>): Promise<LocalState>;
  loadCache(viewerEmail: string): Promise<GanttCache | null>;
  saveCache(viewerEmail: string, cache: GanttCache): Promise<GanttCache>;
  saveQaItem(item: QaItem, previousLinkedKeys?: string[]): Promise<void>;
  deleteQaItem(itemId: string, linkedIssueKeys: string[]): Promise<void>;
  validateDraftTicket(issueKey: string): Promise<PlanValidateResult>;
  loadPlan(draftTicketKey: string, viewerEmail: string): Promise<PlanLoadResult>;
  savePlan(plan: JiraPlan, expectedRevision?: number): Promise<PlanSaveResult>;
  publishPlan(plan: JiraPlan): Promise<PlanPublishResult>;
}

export type { GanttCache, ScrollState };
