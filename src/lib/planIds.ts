export function newPlanEpicId(): string {
  return `plan:epic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newPlanTaskId(): string {
  return `plan:task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

/** Parse a Jira browse URL or bare issue key. */
export function parseDraftTicketInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (JIRA_KEY_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const browseIdx = parts.indexOf("browse");
    if (browseIdx >= 0 && parts[browseIdx + 1] && JIRA_KEY_RE.test(parts[browseIdx + 1])) {
      return parts[browseIdx + 1];
    }
    const last = parts[parts.length - 1];
    if (last && JIRA_KEY_RE.test(last)) return last;
  } catch {
    /* not a URL */
  }
  const m = trimmed.match(/([A-Z][A-Z0-9]+-\d+)/);
  return m ? m[1] : null;
}
