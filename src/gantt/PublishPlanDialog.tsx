import { useEffect } from "react";
import type { JiraPlan } from "../lib/types";
import { countPlanItems } from "../lib/planModel";

interface Props {
  open: boolean;
  plan: JiraPlan | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PublishPlanDialog({ open, plan, busy, onClose, onConfirm }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || !plan) return null;

  const counts = countPlanItems(plan);
  const alreadyPublished = plan.publishState === "published";

  return (
    <div className="pg-modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="pg-modal"
        role="dialog"
        aria-labelledby="publish-plan-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="publish-plan-title">Publish plan?</h2>
        {alreadyPublished ? (
          <p className="pg-modal-sub">
            This plan was already published on{" "}
            {plan.publishedAt
              ? new Date(plan.publishedAt).toLocaleString()
              : "a previous session"}
            .
          </p>
        ) : (
          <>
            <p className="pg-modal-sub">
              This will create <strong>{counts.epics}</strong> epic
              {counts.epics === 1 ? "" : "s"} and <strong>{counts.tasks}</strong> task
              {counts.tasks === 1 ? "" : "s"} in Jira from draft ticket{" "}
              <strong>{plan.draftTicketKey}</strong>.
            </p>
            <p className="pg-modal-sub">
              Real Jira issues will be created. You can retry safely if something fails —
              items already created will not be duplicated.
            </p>
          </>
        )}
        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn" onClick={onClose} disabled={busy}>
            {alreadyPublished ? "Close" : "Cancel"}
          </button>
          {!alreadyPublished ? (
            <button
              type="button"
              className="gantt-btn primary warn"
              disabled={busy || counts.epics === 0}
              onClick={onConfirm}
            >
              {busy ? (
                <>
                  <span className="pg-spinner pg-spinner-inline" aria-hidden />
                  Publishing…
                </>
              ) : (
                "Yes, create in Jira"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
