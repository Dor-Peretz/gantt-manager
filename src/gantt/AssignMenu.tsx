import type { Resource } from "../lib/types";

interface Props {
  resources: Resource[];
  selected: string[];
}

/** Read-only avatar stack from Jira assignee (set on Pull). */
export function AssignMenu({ resources, selected }: Props) {
  const set = new Set(selected);
  const shown = resources.filter((r) => set.has(r.id)).slice(0, 3);

  if (shown.length === 0) {
    return (
      <span className="pg-assign-empty" title="Unassigned in Jira">
        —
      </span>
    );
  }

  return (
    <span className="pg-avatar-stack" title={shown.map((r) => r.name).join(", ")}>
      {shown.map((r) => (
        <span key={r.id} className="pg-avatar" style={{ background: r.color }} title={r.name}>
          {r.initials}
        </span>
      ))}
    </span>
  );
}
