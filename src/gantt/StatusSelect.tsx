import { useEffect, useState } from "react";
import { fetchTransitions } from "../api";
import type { StatusTransition } from "../lib/types";

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/cancel|won't|wont|reject|fail/.test(s)) return "canceled";
  if (/block|imped|hold|wait/.test(s)) return "blocked";
  if (/done|closed|resolved|complete|ship/.test(s)) return "done";
  if (/progress|review|dev|doing|active|qa|test/.test(s)) return "progress";
  return "todo";
}

interface Props {
  issueKey: string;
  status: string;
  pulledStatus: string;
  transitionId?: string | null;
  onChange: (next: { status: string; transitionId: string | null }) => void;
}

export function StatusSelect({
  issueKey,
  status,
  pulledStatus,
  transitionId,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTransitions(issueKey)
      .then((res) => {
        if (!cancelled) setTransitions(res.transitions);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, issueKey]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(`[data-status-menu="${issueKey}"]`)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, issueKey]);

  return (
    <div className="pg-status-wrap" data-status-menu={issueKey}>
      <button
        type="button"
        className={`pg-status-pill editable ${statusClass(status || "")}${transitionId ? " dirty" : ""}`}
        title={transitionId ? `${status} (will Push)` : `Status: ${status}. Click to change.`}
        onClick={() => setOpen((v) => !v)}
      >
        {status || "—"}
      </button>
      {open && (
        <div className="pg-status-menu">
          <div className="pg-assign-hint">Change status</div>
          <button
            type="button"
            className={`pg-status-option${!transitionId ? " current" : ""}`}
            onClick={() => {
              onChange({ status: pulledStatus, transitionId: null });
              setOpen(false);
            }}
          >
            {pulledStatus}
            <span className="pg-status-meta">current in Jira</span>
          </button>
          {loading && <div className="pg-status-meta pad">Loading transitions…</div>}
          {error && <div className="pg-status-meta pad error">{error}</div>}
          {!loading &&
            !error &&
            transitions.map((tr) => (
              <button
                type="button"
                key={tr.id}
                className={`pg-status-option${transitionId === tr.id ? " current" : ""}`}
                onClick={() => {
                  onChange({ status: tr.to.name, transitionId: tr.id });
                  setOpen(false);
                }}
              >
                {tr.to.name}
                <span className="pg-status-meta">{tr.name}</span>
              </button>
            ))}
          {!loading && !error && transitions.length === 0 && (
            <div className="pg-status-meta pad">No transitions available</div>
          )}
        </div>
      )}
    </div>
  );
}
