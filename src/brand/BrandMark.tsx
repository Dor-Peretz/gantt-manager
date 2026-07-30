/** App mark: staggered timeline bars in a rounded tile. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        className="brand-mark-bg"
        width="40"
        height="40"
        rx="10"
        fill="currentColor"
      />
      <rect x="7.5" y="10" width="17.5" height="5" rx="2.5" fill="#17A0E0" />
      <rect x="12.5" y="17.5" width="20" height="5" rx="2.5" fill="#5EC8F0" />
      <rect x="7.5" y="25" width="12.5" height="5" rx="2.5" fill="#17A0E0" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <a className="brand" href="/" aria-label="Gantt Manager home">
      <BrandMark className="brand-mark" />
      <span className="brand-text">
        <span className="brand-name">Gantt Manager</span>
        <span className="brand-tag">Plan timelines · sync with Jira</span>
      </span>
    </a>
  );
}
