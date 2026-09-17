import { useEffect, useState } from "react";
import { buildGanttShareUrl } from "../lib/shareLink";

interface Props {
  open: boolean;
  jql: string;
  onClose: () => void;
}

export function ShareJqlDialog({ open, jql, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const shareUrl = buildGanttShareUrl(jql);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open, shareUrl]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function onCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="pg-modal-backdrop" onMouseDown={onClose}>
      <div
        className="pg-modal pg-modal-wide"
        role="dialog"
        aria-labelledby="share-jql-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="share-jql-title">Share Gantt view</h2>
        <p className="pg-modal-sub">
          Anyone with this local Gantt Manager URL can open the same query. The JQL
          below will be filled in automatically.
        </p>
        <label className="pg-modal-field">
          Share link
          <input type="text" value={shareUrl} readOnly spellCheck={false} />
        </label>
        <p className="pg-modal-sub pg-save-jql-preview" title={jql}>
          JQL: {jql}
        </p>
        <div className="pg-modal-actions">
          <button type="button" className="gantt-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="gantt-btn primary"
            disabled={!shareUrl}
            onClick={() => void onCopy()}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}
