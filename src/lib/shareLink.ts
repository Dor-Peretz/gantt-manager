const JQL_PARAM = "jql";

/** Build a local Gantt Manager link with the JQL query pre-filled. */
export function buildGanttShareUrl(jql: string): string {
  const q = jql.trim();
  if (!q || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set(JQL_PARAM, q);
  url.hash = "";
  return url.toString();
}

function jqlFromHref(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.searchParams.get(JQL_PARAM)?.trim() || null;
  } catch {
    return null;
  }
}

/** Read JQL passed through a shared local app link (`?jql=`). */
export function jqlFromShareUrl(): string | null {
  if (typeof window === "undefined") return null;
  return jqlFromHref(window.location.href);
}
