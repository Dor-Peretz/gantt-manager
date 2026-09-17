import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HistoryViewMode } from "../lib/types";

interface Props {
  onOpenOptions: () => void;
  onOpenGuide: () => void;
  /** History is the live Jira board only — hide it while Plan mode is open. */
  showHistory?: boolean;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  date: string;
  maxDate: string;
  onDateChange: (next: string) => void;
  viewMode: HistoryViewMode;
  onViewModeChange: (next: HistoryViewMode) => void;
  /** No board to reconstruct yet — history controls stay disabled. */
  disabled: boolean;
  loading: boolean;
  /** Summary of the reconstructed board, shown while history is on. */
  statsLabel: string | null;
}

interface MenuPos {
  top: number;
  right: number;
}

export function HistoryMenu({
  onOpenOptions,
  onOpenGuide,
  showHistory = true,
  enabled,
  onEnabledChange,
  date,
  maxDate,
  onDateChange,
  viewMode,
  onViewModeChange,
  disabled,
  loading,
  statsLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      const menuH = menu?.offsetHeight || 220;
      const gap = 6;
      let top = r.bottom + gap;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, r.top - menuH - gap);
      }
      setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, enabled, statsLabel, showHistory]);

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
    <div className="pg-burger-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`gantt-btn pg-burger-btn${enabled && showHistory ? " on" : ""}`}
        title="Options and history"
        aria-label="Options and history menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pg-burger-icon" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        {enabled && showHistory ? <span className="pg-burger-dot" aria-hidden /> : null}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pg-burger-menu"
            role="dialog"
            aria-label="Options and history"
            style={
              pos
                ? { top: pos.top, right: pos.right, visibility: "visible" }
                : { top: 0, right: 8, visibility: "hidden" }
            }
          >
            <div className="pg-assign-hint">Board</div>
            <button
              type="button"
              className="pg-add-menu-item"
              title="Project start, working days, holidays, off days, and prerequisites"
              onClick={() => {
                setOpen(false);
                onOpenOptions();
              }}
            >
              <span className="pg-add-menu-item-label">Options</span>
              <span className="pg-add-menu-item-meta">Calendar, holidays, off days</span>
            </button>
            <button
              type="button"
              className="pg-add-menu-item"
              title="See pictures and instructions for every app feature"
              onClick={() => {
                setOpen(false);
                onOpenGuide();
              }}
            >
              <span className="pg-add-menu-item-label">App guide</span>
              <span className="pg-add-menu-item-meta">Features, pictures, and how-to</span>
            </button>
            {showHistory ? (
              <>
                <div className="pg-add-menu-divider" role="separator" />
                <div className="pg-assign-hint">History</div>
                <p className="pg-burger-menu-help">
                  Reconstruct schedules from the Jira changelog to see how the
                  board looked on a past date.
                </p>
                <label className="pg-compare-toggle pg-burger-row">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={disabled}
                    onChange={(e) => onEnabledChange(e.target.checked)}
                  />
                  Show history
                </label>
                <label className="pg-burger-field">
                  Date
                  <input
                    type="date"
                    className="pg-compare-date"
                    value={date}
                    max={maxDate}
                    disabled={!enabled || disabled}
                    onChange={(e) => {
                      if (e.target.value) onDateChange(e.target.value);
                    }}
                    title="Past date to reconstruct from Jira changelog"
                    aria-label="History date"
                  />
                </label>
                <label className="pg-burger-field">
                  View
                  <select
                    className="pg-history-mode"
                    value={viewMode}
                    disabled={!enabled || disabled}
                    onChange={(e) =>
                      onViewModeChange(e.target.value as HistoryViewMode)
                    }
                    title="Overlay shows ghosts on today's board; As of date replaces bars with the historical schedule"
                    aria-label="History view mode"
                  >
                    <option value="asOf">As of date — full board</option>
                    <option value="overlay">Overlay — ghosts on today</option>
                  </select>
                </label>
                {disabled ? (
                  <p className="pg-burger-menu-help">Pull a board first.</p>
                ) : loading && enabled ? (
                  <p className="pg-burger-menu-help">Loading Jira changelog…</p>
                ) : statsLabel ? (
                  <p
                    className="pg-compare-stats pg-burger-stats"
                    title="Reconstructed from Jira changelog"
                  >
                    {statsLabel}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
