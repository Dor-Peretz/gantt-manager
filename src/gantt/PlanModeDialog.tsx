import { useEffect, useState } from "react";
import { parseDraftTicketInput } from "../lib/planIds";

interface Props {
  open: boolean;
  jiraBaseUrl: string;
  busy: boolean;
  error: string | null;
  /** Last-used draft ticket from viewer preferences — pre-fills the field. */
  savedDraftTicket?: string | null;
  onClose: () => void;
  onContinue: (draftTicketInput: string) => void;
}

export function PlanModeDialog({
  open,
  jiraBaseUrl,
  busy,
  error,
  savedDraftTicket,
  onClose,
  onContinue,
}: Props) {
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setInput(
      savedDraftTicket
        ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${savedDraftTicket}`
        : "",
    );
  }, [open, savedDraftTicket, jiraBaseUrl]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const parsed = parseDraftTicketInput(input);
  const canContinue = !!parsed && !busy;

  return (
    <div className="pg-modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="pg-modal pg-modal-wide"
        role="dialog"
        aria-labelledby="plan-mode-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="plan-mode-title">
          Plan mode
          <span className="pg-plan-beta-badge">Beta</span>
        </h2>
        <div className="pg-plan-beta-notice" role="note">
          <strong>Experimental feature.</strong> Plan mode is in beta and has not been fully
          tested. Review all published epics and tasks in Jira before relying on this workflow.
        </div>
        <p className="pg-modal-sub">
          Plan mode lets you design epics and tasks on the Gantt board without creating
          real Jira issues yet. Everything is saved on <strong>one Jira draft ticket</strong>{" "}
          so you won&apos;t lose your work.
        </p>
        <ul className="pg-plan-steps">
          <li>Edit epics and tasks freely — changes autosave to the draft ticket.</li>
          <li>Normal Pull / Push is disabled while planning.</li>
          <li>
            When ready, use <strong>Publish plan</strong> to create all epics and tasks in
            Jira (with confirmation).
          </li>
        </ul>
        <label className="pg-modal-field">
          Draft Jira ticket (required)
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`e.g. ${jiraBaseUrl}/browse/SBT-12345 or SBT-12345`}
            spellCheck={false}
            autoFocus
            disabled={busy}
          />
        </label>
        <p className="pg-modal-sub">
          Paste a link to an existing Jira task you use as the plan container. The app
          validates it before continuing — you cannot enter Plan mode without a valid
          draft ticket.
          {savedDraftTicket ? " Your last draft ticket is filled in below." : ""}
        </p>
        {parsed && !busy ? (
          <p className="pg-plan-key-preview">Will use draft ticket: <strong>{parsed}</strong></p>
        ) : null}
        {error ? <p className="pg-plan-error">{error}</p> : null}
        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            disabled={!canContinue}
            onClick={() => {
              if (!parsed) return;
              onContinue(input);
            }}
          >
            {busy ? (
              <>
                <span className="pg-spinner pg-spinner-inline" aria-hidden />
                Validating…
              </>
            ) : (
              "Continue to Plan mode"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
