import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { qaKindLabel } from "../lib/qaItems";

export interface DeletableTimelineItem {
  id: string;
  label: string;
  kind: "milestone" | "integration" | "e2e" | "draft";
  confirmMessage: string;
  onDelete: () => void;
}

interface Props {
  hasEpics: boolean;
  hasBoardTasks: boolean;
  deletableItems: DeletableTimelineItem[];
  onAddTask: () => void;
  onAddMilestone: () => void;
  onAddIntegrationTest: () => void;
  onAddE2eFlow: () => void;
}

interface MenuPos {
  top: number;
  left: number;
}

function deleteKindLabel(kind: DeletableTimelineItem["kind"]): string {
  if (kind === "milestone") return "Milestone";
  if (kind === "draft") return "Draft task";
  return qaKindLabel(kind);
}

export function AddTimelineMenu({
  hasEpics,
  hasBoardTasks,
  deletableItems,
  onAddTask,
  onAddMilestone,
  onAddIntegrationTest,
  onAddE2eFlow,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeletableTimelineItem | null>(null);
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
      const menuW = menu?.offsetWidth || 220;
      const menuH = menu?.offsetHeight || 200;
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
  }, [open, deletableItems.length]);

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

  useEffect(() => {
    if (!pendingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPendingDelete(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  function pick(action: () => void) {
    action();
    setOpen(false);
  }

  function pickDelete(item: DeletableTimelineItem) {
    setPendingDelete(item);
    setOpen(false);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    pendingDelete.onDelete();
    setPendingDelete(null);
  }

  return (
    <div className="pg-add-menu-wrap">
      <button
        ref={btnRef}
        type="button"
        className="pg-add-menu-btn"
        title="Add or remove timeline items"
        aria-label="Add or remove timeline items"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pg-add-menu"
            role="menu"
            style={
              pos
                ? { top: pos.top, left: pos.left, visibility: "visible" }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            <div className="pg-assign-hint">Add to timeline</div>
            <button
              type="button"
              role="menuitem"
              className="pg-add-menu-item"
              disabled={!hasEpics}
              title="Add a draft task under an epic — Push creates it in Jira"
              onClick={() => pick(onAddTask)}
            >
              <span className="pg-add-menu-item-label">Task</span>
              <span className="pg-add-menu-item-meta">Draft under epic</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="pg-add-menu-item"
              title="Add a top-level milestone (red star) — not synced to Jira"
              onClick={() => pick(onAddMilestone)}
            >
              <span className="pg-add-menu-item-label">Milestone</span>
              <span className="pg-add-menu-item-meta">Local red star</span>
            </button>
            <div className="pg-add-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="pg-add-menu-item pg-add-menu-item-qa qa-integration"
              disabled={!hasBoardTasks}
              title="Add an integration test bar — Push saves on linked Jira issues"
              onClick={() => pick(onAddIntegrationTest)}
            >
              <span className="pg-add-menu-item-icon" aria-hidden>
                ⊞
              </span>
              <span className="pg-add-menu-item-text">
                <span className="pg-add-menu-item-label">Integration test</span>
                <span className="pg-add-menu-item-meta">Linked Jira tasks</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="pg-add-menu-item pg-add-menu-item-qa qa-e2e"
              disabled={!hasBoardTasks}
              title="Add an end-to-end flow bar — Push saves on linked Jira issues"
              onClick={() => pick(onAddE2eFlow)}
            >
              <span className="pg-add-menu-item-icon" aria-hidden>
                ➜
              </span>
              <span className="pg-add-menu-item-text">
                <span className="pg-add-menu-item-label">E2E flow</span>
                <span className="pg-add-menu-item-meta">Linked Jira tasks</span>
              </span>
            </button>

            <div className="pg-add-menu-divider" role="separator" />
            <div className="pg-assign-hint">Remove from timeline</div>
            {deletableItems.length === 0 ? (
              <div className="pg-add-menu-empty">No local milestones, QA items, or drafts</div>
            ) : (
              deletableItems.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  role="menuitem"
                  className="pg-add-menu-item pg-add-menu-item-delete"
                  title={`Delete ${deleteKindLabel(item.kind)}`}
                  onClick={() => pickDelete(item)}
                >
                  <span className="pg-add-menu-item-label">{item.label}</span>
                  <span className="pg-add-menu-item-meta">{deleteKindLabel(item.kind)}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
      {pendingDelete &&
        createPortal(
          <div className="pg-modal-backdrop" onMouseDown={() => setPendingDelete(null)}>
            <div
              className="pg-modal"
              role="dialog"
              aria-labelledby="remove-timeline-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 id="remove-timeline-title">Remove from timeline?</h2>
              <p className="pg-modal-sub">{pendingDelete.confirmMessage}</p>
              <div className="pg-modal-actions">
                <button
                  type="button"
                  className="gantt-btn"
                  onClick={() => setPendingDelete(null)}
                >
                  Cancel
                </button>
                <button type="button" className="gantt-btn primary" onClick={confirmDelete}>
                  Remove
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
