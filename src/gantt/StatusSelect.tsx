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

function isDoneLikeStatus(status: string): boolean {
  return /done|closed|resolved|complete|ship/i.test(status || "");
}

/** Basic Jira timeSpent validation: e.g. 3d, 4h, 2d 4h, 30m */
function isValidTimeSpent(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return /^(\d+\s*[wdhm]\s*)+$/i.test(v);
}

interface Props {
  issueKey: string;
  status: string;
  pulledStatus: string;
  transitionId?: string | null;
  /** Suggested default when asking for actual time (working days). */
  durationDays?: number;
  /** Previously entered actual time (if any). */
  timeSpent?: string | null;
  onChange: (next: {
    status: string;
    transitionId: string | null;
    timeSpent?: string | null;
  }) => void;
}

interface MenuPos {
  top: number;
  left: number;
}

interface PendingDone {
  transitionId: string;
  status: string;
  transitionName: string;
}

export function StatusSelect({
  issueKey,
  status,
  pulledStatus,
  transitionId,
  durationDays = 1,
  timeSpent,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const [pendingDone, setPendingDone] = useState<PendingDone | null>(null);
  const [timeInput, setTimeInput] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) {
      setPendingDone(null);
      setTimeError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!pendingDone) return;
    requestAnimationFrame(() => timeInputRef.current?.focus());
  }, [pendingDone]);

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
      const menuW = menu?.offsetWidth || 240;
      const menuH = menu?.offsetHeight || 280;
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
  }, [open, loading, transitions.length, error, pendingDone, timeError]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pendingDone) {
          setPendingDone(null);
          setTimeError(null);
        } else {
          setOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pendingDone]);

  function selectTransition(tr: StatusTransition) {
    if (isDoneLikeStatus(tr.to.name)) {
      const suggested = `${Math.max(1, Math.round(durationDays || 1))}d`;
      setPendingDone({
        transitionId: tr.id,
        status: tr.to.name,
        transitionName: tr.name,
      });
      setTimeInput(timeSpent?.trim() || suggested);
      setTimeError(null);
      return;
    }
    onChange({ status: tr.to.name, transitionId: tr.id, timeSpent: null });
    setOpen(false);
  }

  function confirmDoneTime() {
    if (!pendingDone) return;
    const value = timeInput.trim();
    if (!isValidTimeSpent(value)) {
      setTimeError("Enter time like 3d, 4h, or 2d 4h");
      return;
    }
    onChange({
      status: pendingDone.status,
      transitionId: pendingDone.transitionId,
      timeSpent: value.replace(/\s+/g, " "),
    });
    setPendingDone(null);
    setOpen(false);
  }

  const title = transitionId
    ? timeSpent
      ? `${status} (will Push · actual ${timeSpent})`
      : `${status} (will Push)`
    : `Status: ${status}. Click to change.`;

  return (
    <div className="pg-status-wrap" data-status-menu={issueKey}>
      <button
        ref={btnRef}
        type="button"
        className={`pg-status-pill editable ${statusClass(status || "")}${transitionId ? " dirty" : ""}`}
        title={title}
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
            {pendingDone ? (
              <>
                <div className="pg-assign-hint">Actual time spent</div>
                <p className="pg-status-time-copy">
                  Moving to <strong>{pendingDone.status}</strong> requires actual
                  time spent on this story.
                </p>
                <label className="pg-status-time-field">
                  Time spent
                  <input
                    ref={timeInputRef}
                    type="text"
                    value={timeInput}
                    onChange={(e) => {
                      setTimeInput(e.target.value);
                      setTimeError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirmDoneTime();
                      }
                    }}
                    placeholder="e.g. 3d or 2d 4h"
                    spellCheck={false}
                  />
                </label>
                {timeError && <div className="pg-status-meta pad error">{timeError}</div>}
                <div className="pg-status-meta pad">
                  Suggested from duration: {Math.max(1, Math.round(durationDays || 1))}d
                </div>
                <div className="pg-status-time-actions">
                  <button
                    type="button"
                    className="gantt-btn"
                    onClick={() => {
                      setPendingDone(null);
                      setTimeError(null);
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="gantt-btn primary"
                    onClick={confirmDoneTime}
                  >
                    Confirm
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pg-assign-hint">Change status</div>
                <button
                  type="button"
                  className={`pg-status-option${!transitionId ? " current" : ""}`}
                  onClick={() => {
                    onChange({ status: pulledStatus, transitionId: null, timeSpent: null });
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
                      onClick={() => selectTransition(tr)}
                    >
                      {tr.to.name}
                      <span className="pg-status-meta">
                        {tr.name}
                        {isDoneLikeStatus(tr.to.name) ? " · asks for time" : ""}
                      </span>
                    </button>
                  ))}
                {!loading && !error && transitions.length === 0 && (
                  <div className="pg-status-meta pad">No transitions available</div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
