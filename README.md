# Gantt Manager

**Plan timelines · sync with Jira**

Local Jira-backed Gantt planner. **Jira is the source of truth** for issues; the app pulls via JQL, lets you plan on a TeamGantt-style chart, then **Push** writes schedule and status changes back to Jira.

Stack: React + Vite (UI) · Express + TypeScript (API)

Brand assets live in `public/favicon.svg`, `public/apple-touch-icon.svg`, and `src/brand/BrandMark.tsx`.

## Features

- **Pull by JQL** — Epics → milestone rows; stories/tasks → schedule bars
- **Childless epics** — Use the epic’s own Start date, Due date, and Story Points when it has no children
- **Timeline** — Month labels, day-of-month + weekday letters; drag bars to move, drag the right edge to resize
- **Work calendar** — Sun–Thu work week; optional Israeli public holidays
- **Prerequisites** — Jira “Blocks” links as dependency arrows (read-only)
- **Status** — Change status in-app; Push applies the matching Jira transition
- **Resources** — Assignees from Jira; hours dock pinned at the bottom
- **Epic colors** — Click the epic color dot to pick a palette/custom color (saved locally)
- **Theme** — Light / dark toggle
- **Session restore** — Last view + scroll cached; prefs autosaved

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|----------|-------------|
| `JIRA_BASE_URL` | e.g. `https://sunbit.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | [Create an API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_JQL` | Default JQL for Pull (editable in the toolbar) |
| `PORT` | Backend port (default `8787`) |

The token needs permission to **read** and **write** Jira issues (Start date, Due date, transitions).

Never commit `.env`.

## Run

```bash
npm run dev
```

| | URL |
|--|-----|
| UI | http://localhost:5173 (Vite proxies `/api` → backend) |
| API | http://localhost:8787 |

Production-style:

```bash
npm run build
npm start
```

Then open http://localhost:8787.

## Usage

1. Enter JQL (or use the default), e.g.

   ```
   (key = SBT-61016 OR issuekey in portfolioChildIssuesOf(SBT-61016)) AND status != Canceled ORDER BY summary ASC
   ```

2. Click **Pull** — epics become milestones; stories become tasks. Empty epics still appear and use their own dates/estimates.
3. Plan the schedule:
   - Edit **Start** / **Duration** in the left columns, or **drag / resize** bars on the timeline
   - Change **Status** via the status control (pending until Push)
   - Click an epic’s **color dot** to change its milestone color
4. Dirty rows show an amber marker. Click **Push** to write Start date, Due date, and status transitions for dirty items only.
5. Conflicts (issue updated in Jira since Pull) are skipped — re-**Pull** to reconcile.

## Field mapping

| Gantt | Jira |
|-------|------|
| Milestone | Epic (parent) |
| Task | Story / Task (or the epic itself when it has no children) |
| Friendly id | Summary prefix `[M1-T1] …` |
| Start | Start date (`customfield_10907`, auto-discovered) |
| Due / Duration | Due date ↔ working days (Sun–Thu, ± IL holidays) |
| Estimate | Story Points (shown on empty epics; used when dates are incomplete) |
| Prerequisites | “Blocks” issue links (blocked by) — read-only |
| Status | Issue status; Push via transitions |
| Assignee | Display + resource hours (not reassigned via Push) |

## Preferences & cache

### `preferences.json` (git-ignored)

Created automatically. Stores:

- `jql` — autosaved as you type
- `projectStart`, `showHolidays`, `showDeps`
- Layout: `leftPanelWidth`, `resourcesDockHeight`, `dayWidthPx`
- `theme` — `"light"` \| `"dark"`
- `milestoneColors` — epic key → color
- Assignee colors / allocations, collapsed epics

Copy [`preferences.example.json`](preferences.example.json) for a starter. An older `gantt-state.json` is migrated to `preferences.json` on first run.

### `gantt-cache.json` (git-ignored)

Last Gantt snapshot + scroll. On refresh the app:

1. Restores the cached view immediately
2. Auto-Pulls from Jira when credentials work and JQL is set
3. Skips auto-Pull if you have unpushed edits — Push or Pull manually

## Project layout

```
server/          Express API (pull, push, state, cache, transitions)
src/gantt/       Gantt board, timeline, resources, color/status UI
src/lib/         Types + workday calendar
preferences.json Local prefs (ignored)
gantt-cache.json Session snapshot (ignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API + Vite together |
| `npm run build` | Typecheck + production UI build |
| `npm start` | Serve API + built UI |
| `npm run preview` | Vite preview of the built UI |
