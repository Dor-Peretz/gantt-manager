import { useEffect } from "react";
import { APP_VERSION } from "../app/version";

type GuidePictureKind =
  | "sync"
  | "timeline"
  | "status"
  | "filters"
  | "items"
  | "prerequisites"
  | "calendar"
  | "resources"
  | "plan"
  | "history"
  | "display";

interface GuideSection {
  id: string;
  title: string;
  picture: GuidePictureKind;
  summary: string;
  points: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: GuideSection[] = [
  {
    id: "jira",
    title: "Load and save Jira work",
    picture: "sync",
    summary: "Use JQL to build the board, then push approved schedule changes back to Jira.",
    points: [
      "Enter JQL, or select a saved query, and choose Pull.",
      "Save, share, copy, switch, and remove frequently used JQL queries.",
      "Push writes schedule, status, assignee, draft tasks, and QA items to Jira.",
      "Clear discards unpushed Jira edits while keeping local milestones.",
    ],
  },
  {
    id: "timeline",
    title: "Plan directly on the timeline",
    picture: "timeline",
    summary: "Edit dates and ownership without leaving the Gantt board.",
    points: [
      "Drag a task bar to change its start date.",
      "Drag the right edge to change duration and due date.",
      "Click an empty track to schedule work that has no start date yet.",
      "Zoom the timeline in or out, and drag column or panel edges to resize.",
      "Collapse epics, hide tasks, reorder rows, and recolor an epic.",
    ],
  },
  {
    id: "status",
    title: "Set status, owners, and time",
    picture: "status",
    summary: "Keep Jira status and ownership current straight from the board.",
    points: [
      "Change status from the row; available transitions come from Jira.",
      "Moving work to Done can log the actual time spent on the ticket.",
      "Assign a resource, or clear it back to Unassigned, in the Res column.",
      "Status and assignee changes are written to Jira on the next Push.",
    ],
  },
  {
    id: "filters",
    title: "Focus the board with filters",
    picture: "filters",
    summary: "Narrow a large board without changing the Jira query.",
    points: [
      "Filter by text, resource, epic, status, or schedule condition.",
      "Select multiple values and choose Include or Exclude.",
      "Find scheduled, unscheduled, overdue, late-to-start, or blocked work.",
      "The board shows how many items remain visible and can clear all filters at once.",
    ],
  },
  {
    id: "items",
    title: "Add tasks, milestones, and QA work",
    picture: "items",
    summary: "Use the + menu in the board header to add or remove timeline items.",
    points: [
      "Create draft Jira tasks under an epic; Push creates them in Jira.",
      "Create local milestones and link each one to multiple Jira epics.",
      "Create Integration tests and E2E flows linked to Jira tasks.",
      "Edit with the pencil, or delete beside it, inside the edit dialog, or from the + menu.",
    ],
  },
  {
    id: "prerequisites",
    title: "Understand prerequisites",
    picture: "prerequisites",
    summary: "See what must finish before a task can proceed.",
    points: [
      "Turn on Prerequisites in Options to show dependency arrows across the board.",
      "Hover any chained task to show its blockers even when arrows are turned off.",
      "Hover highlights the prerequisite bars, draws bold arrows, and shows status and dates.",
      "Prerequisites outside the current JQL are clearly identified.",
    ],
  },
  {
    id: "calendar",
    title: "Configure the work calendar",
    picture: "calendar",
    summary: "Make every date calculation match the team's real working calendar.",
    points: [
      "Choose working weekdays; the default is Sunday through Thursday.",
      "Toggle Israel and Poland holidays independently.",
      "Add named one-off non-working days and remove them later.",
      "Set the project start date and choose whether sprint bands are visible.",
    ],
  },
  {
    id: "resources",
    title: "Review resources and capacity",
    picture: "resources",
    summary: "Spot ownership gaps and over-allocation while planning.",
    points: [
      "See each resource's scheduled work in the Resources panel.",
      "Allocated hours and overbooked days are highlighted on the timeline.",
      "Resize, minimize, or expand the Resources panel to fit the current task.",
      "Use resource filters to isolate one person or find unassigned work.",
    ],
  },
  {
    id: "plan",
    title: "Design work safely in Plan mode",
    picture: "plan",
    summary: "Build a draft hierarchy before creating real Jira epics and tasks.",
    points: [
      "Start Plan mode with a Jira draft ticket that stores the plan.",
      "Add, edit, reorder, and remove planned epics and tasks.",
      "Changes autosave to the draft ticket instead of creating Jira work immediately.",
      "Publish when ready to create the planned epics and tasks in Jira.",
    ],
  },
  {
    id: "history",
    title: "Travel through Jira history",
    picture: "history",
    summary: "Reconstruct the board as it looked on a previous date.",
    points: [
      "Open the top-right hamburger menu and turn on History.",
      "As of date replaces the board with a read-only historical snapshot.",
      "Overlay keeps today's board and adds faded historical bars for comparison.",
      "The history summary reports moved, scheduled, and not-yet-created work.",
    ],
  },
  {
    id: "display",
    title: "Share and personalize the view",
    picture: "display",
    summary: "Keep the board comfortable to use and easy to share.",
    points: [
      "Switch between Dark and Light mode from the header.",
      "Preview opens a clean, screenshot-ready, read-only board.",
      "The hamburger menu stays pinned at the top-right at every screen size.",
      "Calendar, layout, filters, and local milestone choices are remembered locally.",
    ],
  },
];

function GuidePicture({ kind }: { kind: GuidePictureKind }) {
  if (kind === "sync") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="JQL pull and push illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <rect className="guide-field" x="22" y="28" width="190" height="26" rx="6" />
        <text x="32" y="45">project = SBT AND type = Epic</text>
        <rect className="guide-action" x="220" y="28" width="40" height="26" rx="13" />
        <text className="guide-action-text" x="240" y="45">Pull</text>
        <rect className="guide-action warn" x="266" y="28" width="34" height="26" rx="13" />
        <text className="guide-action-text" x="283" y="45">Push</text>
        <path className="guide-line" d="M46 78h76m76 0h76" />
        <path className="guide-arrow" d="M124 78l-8-5v10zM196 78l8-5v10z" />
        <rect className="guide-card" x="28" y="68" width="88" height="52" rx="8" />
        <text className="guide-label" x="72" y="91">Jira</text>
        <text className="guide-small" x="72" y="107">issues</text>
        <rect className="guide-card accent" x="204" y="68" width="88" height="52" rx="8" />
        <text className="guide-label" x="248" y="91">Gantt</text>
        <text className="guide-small" x="248" y="107">schedule</text>
      </svg>
    );
  }
  if (kind === "timeline") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Editable timeline illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        {[42, 72, 102].map((y) => <path key={y} className="guide-grid" d={`M18 ${y}h284`} />)}
        {[112, 142, 172, 202, 232, 262].map((x) => <path key={x} className="guide-grid" d={`M${x} 24v102`} />)}
        <text className="guide-label left" x="24" y="38">Tasks</text>
        <rect className="guide-bar blue" x="118" y="50" width="76" height="16" rx="5" />
        <rect className="guide-bar green" x="164" y="80" width="92" height="16" rx="5" />
        <rect className="guide-bar purple" x="210" y="110" width="62" height="16" rx="5" />
        <path className="guide-drag" d="M104 58h22m-6-5l6 5-6 5M266 88h18m-6-5l6 5-6 5" />
      </svg>
    );
  }
  if (kind === "status") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Status and assignee illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <rect className="guide-card" x="24" y="26" width="128" height="98" rx="9" />
        <text className="guide-title left" x="38" y="45">CHANGE STATUS</text>
        <rect className="guide-pill" x="38" y="54" width="86" height="20" rx="10" />
        <text className="guide-small" x="81" y="68">In Progress</text>
        <rect className="guide-pill selected" x="38" y="80" width="86" height="20" rx="10" />
        <text className="guide-small" x="81" y="94">Done ✓</text>
        <rect className="guide-card" x="168" y="26" width="128" height="98" rx="9" />
        <text className="guide-title left" x="182" y="45">TIME SPENT</text>
        <rect className="guide-field" x="182" y="54" width="62" height="22" rx="6" />
        <text className="guide-small" x="213" y="69">4h</text>
        <rect className="guide-action" x="250" y="54" width="34" height="22" rx="11" />
        <text className="guide-action-text" x="267" y="69">OK</text>
        <circle className="guide-avatar" cx="198" cy="102" r="13" />
        <text className="guide-avatar-text" x="198" y="106">DP</text>
        <text className="guide-small left" x="218" y="106">Assignee</text>
      </svg>
    );
  }
  if (kind === "filters") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Board filters illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <path className="guide-funnel" d="M26 30h78L75 64v26l-20 10V64z" />
        <rect className="guide-pill selected" x="126" y="30" width="68" height="24" rx="12" />
        <text className="guide-label" x="160" y="46">Include</text>
        <rect className="guide-pill" x="200" y="30" width="68" height="24" rx="12" />
        <text className="guide-label" x="234" y="46">Exclude</text>
        <rect className="guide-card" x="124" y="68" width="72" height="24" rx="6" />
        <text className="guide-small" x="160" y="84">Overdue ✓</text>
        <rect className="guide-card" x="202" y="68" width="72" height="24" rx="6" />
        <text className="guide-small" x="238" y="84">Blocked ✓</text>
        <text className="guide-label" x="199" y="116">12 of 48 shown</text>
      </svg>
    );
  }
  if (kind === "items") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Milestone and QA item illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <circle className="guide-plus" cx="42" cy="40" r="17" />
        <text className="guide-plus-text" x="42" y="46">+</text>
        <path className="guide-line" d="M68 40h28" />
        <rect className="guide-card" x="96" y="24" width="190" height="92" rx="9" />
        <text className="guide-star" x="112" y="49">★</text>
        <text className="guide-label left" x="136" y="47">Milestone</text>
        <text className="guide-qa" x="112" y="77">⊞</text>
        <text className="guide-label left" x="136" y="76">Integration test</text>
        <text className="guide-qa purple-text" x="112" y="104">➜</text>
        <text className="guide-label left" x="136" y="103">E2E flow</text>
        <text className="guide-edit" x="258" y="48">✎</text>
        <text className="guide-delete" x="276" y="48">⌫</text>
      </svg>
    );
  }
  if (kind === "prerequisites") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Prerequisite hover illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <rect className="guide-bar green strong" x="24" y="38" width="78" height="18" rx="5" />
        <rect className="guide-bar blue strong dashed" x="206" y="94" width="82" height="18" rx="5" />
        <path className="guide-dep" d="M102 47h46v56h58" />
        <path className="guide-dep-arrow" d="M206 103l-10-6v12z" />
        <rect className="guide-pop" x="116" y="20" width="164" height="60" rx="8" />
        <text className="guide-title" x="128" y="39">BLOCKED BY 1</text>
        <rect className="guide-key" x="128" y="48" width="55" height="20" rx="5" />
        <text className="guide-key-text" x="155" y="62">PROJ-42</text>
        <text className="guide-small left" x="191" y="61">API complete</text>
      </svg>
    );
  }
  if (kind === "calendar") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Working calendar illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <rect className="guide-card" x="24" y="24" width="272" height="100" rx="9" />
        <text className="guide-title left" x="38" y="45">WORKING DAYS</text>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <g key={`${d}-${i}`}>
            <circle className={i < 5 ? "guide-day on" : "guide-day"} cx={50 + i * 35} cy="70" r="13" />
            <text className="guide-day-text" x={50 + i * 35} y="75">{d}</text>
          </g>
        ))}
        <rect className="guide-check on" x="40" y="96" width="13" height="13" rx="3" />
        <text className="guide-small left" x="60" y="107">IL holidays</text>
        <rect className="guide-check" x="160" y="96" width="13" height="13" rx="3" />
        <text className="guide-small left" x="180" y="107">PL holidays</text>
      </svg>
    );
  }
  if (kind === "resources") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Resource capacity illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <circle className="guide-avatar" cx="48" cy="48" r="18" />
        <text className="guide-avatar-text" x="48" y="53">DP</text>
        <text className="guide-label left" x="76" y="45">Dor</text>
        <text className="guide-small left" x="76" y="61">32h allocated</text>
        <rect className="guide-capacity" x="28" y="82" width="254" height="18" rx="6" />
        <rect className="guide-capacity-fill" x="28" y="82" width="182" height="18" rx="6" />
        <rect className="guide-over" x="210" y="82" width="72" height="18" rx="6" />
        <text className="guide-small left" x="28" y="118">Mon 6h</text>
        <text className="guide-small left" x="120" y="118">Tue 8h</text>
        <text className="guide-small left" x="218" y="118">Wed 11h !</text>
      </svg>
    );
  }
  if (kind === "plan") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="Plan mode illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <rect className="guide-plan-banner" x="20" y="24" width="280" height="28" rx="7" />
        <text className="guide-label left" x="32" y="43">Plan mode</text>
        <text className="guide-small left" x="110" y="43">Saved on PROJ-123</text>
        <path className="guide-tree" d="M44 68v48m0-40h26m-26 32h26" />
        <rect className="guide-card accent" x="70" y="62" width="198" height="26" rx="6" />
        <text className="guide-label left" x="82" y="79">New checkout epic</text>
        <rect className="guide-card" x="70" y="96" width="164" height="24" rx="6" />
        <text className="guide-small left" x="82" y="112">Implement payment flow</text>
        <rect className="guide-action" x="242" y="96" width="50" height="24" rx="12" />
        <text className="guide-action-text" x="267" y="112">Publish</text>
      </svg>
    );
  }
  if (kind === "history") {
    return (
      <svg viewBox="0 0 320 150" role="img" aria-label="History comparison illustration">
        <rect className="guide-bg" x="8" y="12" width="304" height="126" rx="12" />
        <circle className="guide-clock" cx="64" cy="72" r="34" />
        <path className="guide-clock-hand" d="M64 50v23l17 10" />
        <rect className="guide-bar ghost" x="124" y="42" width="86" height="16" rx="5" />
        <rect className="guide-bar blue" x="158" y="42" width="86" height="16" rx="5" />
        <rect className="guide-bar ghost" x="152" y="82" width="62" height="16" rx="5" />
        <rect className="guide-bar purple" x="184" y="82" width="78" height="16" rx="5" />
        <text className="guide-small left" x="124" y="119">faded = then</text>
        <text className="guide-small left" x="214" y="119">solid = today</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="Display settings illustration">
      <rect className="guide-bg dark-preview" x="8" y="12" width="304" height="126" rx="12" />
      <circle className="guide-moon" cx="52" cy="46" r="20" />
      <path className="guide-moon-cut" d="M59 29a19 19 0 1 0 12 29A17 17 0 0 1 59 29z" />
      <rect className="guide-window" x="94" y="28" width="190" height="94" rx="9" />
      <circle className="guide-window-dot red" cx="108" cy="40" r="3" />
      <circle className="guide-window-dot yellow" cx="118" cy="40" r="3" />
      <circle className="guide-window-dot green" cx="128" cy="40" r="3" />
      <rect className="guide-bar blue" x="112" y="62" width="74" height="13" rx="4" />
      <rect className="guide-bar purple" x="158" y="84" width="96" height="13" rx="4" />
      <text className="guide-label" x="189" y="113">Clean preview</text>
    </svg>
  );
}

export function AppGuideDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pg-modal-backdrop pg-guide-backdrop" onMouseDown={onClose}>
      <section
        className="pg-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-guide-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="pg-guide-header">
          <div>
            <span className="pg-guide-kicker">Gantt Manager · v{APP_VERSION}</span>
            <h2 id="app-guide-title">Feature guide</h2>
            <p>Everything you can do—from pulling Jira work to publishing a complete plan.</p>
          </div>
          <button type="button" className="pg-guide-close" onClick={onClose} aria-label="Close guide">
            ×
          </button>
        </header>

        <nav className="pg-guide-nav" aria-label="Guide sections">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#guide-${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <div className="pg-guide-content">
          {SECTIONS.map((section, index) => (
            <article id={`guide-${section.id}`} className="pg-guide-section" key={section.id}>
              <div className="pg-guide-picture">
                <GuidePicture kind={section.picture} />
              </div>
              <div className="pg-guide-copy">
                <span className="pg-guide-number">{String(index + 1).padStart(2, "0")}</span>
                <h3>{section.title}</h3>
                <p>{section.summary}</p>
                <ul>
                  {section.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <footer className="pg-guide-footer">
          <span>Tip: press Esc at any time to close this guide.</span>
          <button type="button" className="gantt-btn primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
