import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Resource } from "../lib/types";
import { ResourceAvatar } from "./ResourceAvatar";

interface Props {
  resources: Resource[];
  selected: string[];
  pulledSelected: string[];
  disabled?: boolean;
  issueKey: string;
  onChange: (resourceId: string | null) => void;
}

interface MenuPos {
  top: number;
  left: number;
}

/** Assign a Jira assignee (single-select) — Push writes to Jira. */
export function AssignMenu({
  resources,
  selected,
  pulledSelected,
  disabled = false,
  issueKey,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentId = selected[0] || null;
  const pulledId = pulledSelected[0] || null;
  const dirty = currentId !== pulledId;
  const current = resources.find((r) => r.id === currentId);

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
      const menuH = menu?.offsetHeight || 240;
      const gap = 6;
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
  }, [open, resources.length]);

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

  if (disabled) {
    if (!current) {
      return (
        <span className="pg-assign-empty" title="Unassigned">
          —
        </span>
      );
    }
    return (
      <span className="pg-avatar-stack" title={current.name}>
        <ResourceAvatar resource={current} />
      </span>
    );
  }

  return (
    <div className="pg-assign" data-assign-menu={issueKey}>
      <button
        ref={btnRef}
        type="button"
        className={`pg-assign-trigger${dirty ? " dirty" : ""}`}
        title={
          dirty
            ? `${current?.name || "Unassigned"} (will Push)`
            : current
              ? `Assignee: ${current.name}. Click to change.`
              : "Unassigned. Click to assign."
        }
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {current ? (
          <ResourceAvatar resource={current} />
        ) : (
          <span className="pg-assign-empty">+</span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pg-assign-menu"
            data-assign-menu-panel={issueKey}
            style={
              pos
                ? { top: pos.top, left: pos.left, visibility: "visible" }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            <div className="pg-assign-hint">Assign to</div>
            <button
              type="button"
              className={`pg-assign-option${!currentId ? " current" : ""}`}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="pg-assign-empty sm">—</span>
              <span>Unassigned</span>
              {!pulledId && <span className="pg-status-meta">in Jira</span>}
            </button>
            {resources.map((r) => (
              <button
                type="button"
                key={r.id}
                className={`pg-assign-option${currentId === r.id ? " current" : ""}`}
                onClick={() => {
                  onChange(r.id);
                  setOpen(false);
                }}
              >
                <ResourceAvatar resource={r} className="sm" />
                <span>{r.name}</span>
                {pulledId === r.id && <span className="pg-status-meta">in Jira</span>}
              </button>
            ))}
            {resources.length === 0 && (
              <div className="pg-status-meta pad">
                No assignees yet — Pull to load people from Jira.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
