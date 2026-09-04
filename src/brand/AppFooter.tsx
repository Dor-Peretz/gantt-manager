const GITHUB_REPO_URL = "https://github.com/Dor-Peretz/gantt-manager";
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
const GITHUB_PROFILE_URL = "https://github.com/Dor-Peretz";

function GitHubIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.9-1.32 2.74-1.05 2.74-1.05.55 1.4.21 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  );
}

function HeartIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        d="M12 20.5s-6.8-4.2-9.1-8.1C1.2 9.7 2.2 6.5 5.2 5.5c1.8-.6 3.7.1 4.8 1.5 1.1-1.4 3-2.1 4.8-1.5 3 .9 4 4.2 2.3 6.9-2.3 3.9-9.1 8.1-9.1 8.1Z"
      />
    </svg>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <a
        className="app-footer-quote"
        href={GITHUB_ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Open a GitHub issue"
      >
        Questions or feedback? Open an issue
      </a>
      <span className="app-footer-sep" aria-hidden="true" />
      <a
        className="app-footer-credit"
        href={GITHUB_PROFILE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Dor Peretz on GitHub"
      >
        Made with <HeartIcon className="app-footer-heart" /> by Dor Peretz
      </a>
      <a
        className="app-footer-github"
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View Gantt Manager on GitHub"
        title="View Gantt Manager on GitHub"
      >
        <GitHubIcon className="app-footer-github-icon" />
        <span>GitHub</span>
      </a>
    </footer>
  );
}
