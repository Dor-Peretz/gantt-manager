/** Slack DM deep link for Dor Peretz (sunbitteam workspace). */
export const DOR_SLACK_DM_URL =
  "https://sunbitteam.slack.com/app_redirect?channel=U02R9NHP2FP";

function SlackIcon({ className = "" }: { className?: string }) {
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
        fill="#E01E5A"
        d="M5.5 15.05a1.75 1.75 0 1 1-1.75-1.75h1.75v1.75Zm.88 0a1.75 1.75 0 1 1 3.5 0v4.38a1.75 1.75 0 1 1-3.5 0v-4.38Z"
      />
      <path
        fill="#36C5F0"
        d="M8.88 5.5a1.75 1.75 0 1 1 1.75-1.75v1.75H8.88Zm0 .88a1.75 1.75 0 1 1 0 3.5H4.5a1.75 1.75 0 1 1 0-3.5h4.38Z"
      />
      <path
        fill="#2EB67D"
        d="M18.5 8.88a1.75 1.75 0 1 1 1.75 1.75h-1.75V8.88Zm-.88 0a1.75 1.75 0 1 1-3.5 0V4.5a1.75 1.75 0 1 1 3.5 0v4.38Z"
      />
      <path
        fill="#ECB22E"
        d="M15.12 18.5a1.75 1.75 0 1 1-1.75 1.75v-1.75h1.75Zm0-.88a1.75 1.75 0 1 1 0-3.5h4.38a1.75 1.75 0 1 1 0 3.5h-4.38Z"
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
        href={DOR_SLACK_DM_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Message Dor Peretz on Slack"
      >
        Questions or feedback? Message me on Slack
      </a>
      <span className="app-footer-sep" aria-hidden="true" />
      <a
        className="app-footer-credit"
        href={DOR_SLACK_DM_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Message Dor Peretz on Slack"
      >
        Made with <HeartIcon className="app-footer-heart" /> by Dor Peretz
      </a>
      <a
        className="app-footer-slack"
        href={DOR_SLACK_DM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Message Dor Peretz on Slack"
        title="Message Dor Peretz on Slack"
      >
        <SlackIcon className="app-footer-slack-icon" />
        <span>Slack</span>
      </a>
    </footer>
  );
}
