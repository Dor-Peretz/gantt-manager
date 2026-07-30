import type { Resource } from "../lib/types";

interface Props {
  resources: Resource[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function AssignMenu({ resources, selected, onChange }: Props) {
  const set = new Set(selected);
  const shown = resources.filter((r) => set.has(r.id)).slice(0, 3);

  return (
    <details className="pg-assign">
      <summary title="Assign resources">
        {shown.length === 0 ? (
          <span className="pg-assign-empty">+</span>
        ) : (
          <span className="pg-avatar-stack">
            {shown.map((r) => (
              <span
                key={r.id}
                className="pg-avatar"
                style={{ background: r.color }}
                title={r.name}
              >
                {r.initials}
              </span>
            ))}
          </span>
        )}
      </summary>
      <div className="pg-assign-menu">
        <div className="pg-assign-hint">Resources (local)</div>
        {resources.length === 0 ? (
          <div className="pg-assign-hint" style={{ textTransform: "none", fontWeight: 500 }}>
            Add people in the Resources pane below
          </div>
        ) : (
          resources.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={set.has(r.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  onChange([...next]);
                }}
              />
              <span
                className="pg-avatar"
                style={{ background: r.color, width: 20, height: 20, fontSize: 9 }}
              >
                {r.initials}
              </span>
              {r.name}
            </label>
          ))
        )}
      </div>
    </details>
  );
}
