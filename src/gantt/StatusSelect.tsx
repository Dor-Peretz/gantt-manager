import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface MenuPos {
  top: number;
  left: number;
}

export function StatusSelect({
  issueKey,
  status,
  pulledStatus,
  transitionId,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      const menu = menuRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuW = menu?.offsetWidth || 220;
      const menuH = menu?.offsetHeight || 260;
      const gap = 4;
      let top = r.bottom + gap;
      let left = r.left;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, r.top - menuH - gap);
      }
      if (left + menuW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuW - 8);
      }
      setPos({ top, left });
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, loading, transitions.length, error]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pg-status-wrap" data-status-menu={issueKey}>
      <button
        ref={btnRef}
        type="button"
        className={`pg-status-pill editable ${statusClass(status || "")}${transitionId ? " dirty" : ""}`}
        title={transitionId ? `${status} (will Push)` : `Status: ${status}. Click to change.`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {status || "—"}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pg-status-menu"
            data-status-menu-panel={issueKey}
            style={
              pos
                ? { top: pos.top, left: pos.left, visibility: "visible" }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
