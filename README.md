# Gantt Manager

**Plan timelines · sync with Jira**

Local Jira-backed Gantt planner. **Jira is the source of truth** for issues; the app pulls via JQL, lets you plan on a TeamGantt-style chart, then **Push** writes schedule, status, assignee, and QA changes back to Jira.

Stack: React + Vite (UI) · Express + TypeScript (API)

Brand assets live in `public/favicon.svg`, `public/apple-touch-icon.svg`, and `src/brand/BrandMark.tsx`.

## Features

### Planning

- **Pull by JQL** — Epics → milestone rows; stories/tasks → schedule bars
- **Saved JQL** — Name and reuse queries from the toolbar dropdown; copy the current JQL to the clipboard
- **Childless epics** — Use the epic’s own Start date, Due date, and Story Points when it has no children
- **Timeline** — Month labels, day-of-month + weekday letters; drag bars to move, drag the right edge to resize
- **Work calendar** — Sun–Thu work week; optional Israeli public holidays; custom off days
- **Prerequisites** — Jira “Blocks” links as dependency arrows (read-only)
- **Status** — Change status in-app; Push applies the matching Jira transition, and logs actual time when closing as Done
- **Draft tasks** — Add a row under an epic and Push to create the Jira issue
- **Local milestones & markers** — Diamond rows that live only in your preferences; any task can be flagged as a marker
- **Reorder & hide** — Drag epics and tasks into the order you want; hidden rows fold into a *Hidden* folder

### QA rows

Integration tests and E2E flows planned as their own rows on the board. Each one links to the tickets it covers, takes its assignees from those tickets, and is stored **on those Jira issues** as the `gantt.qa` issue property — so teammates pulling the same JQL see it too. A QA row appears only when at least one of its linked tickets is on the board.

### History

Reconstructs past schedules from the Jira changelog, so you can see what the plan looked like before:

| Mode | What you get |
|------|--------------|
| **As of date — full board** | Bars replaced with that date’s schedule. Read-only, so Push is disabled. |
| **Overlay — ghosts on today** | That date’s bars drawn as ghosts behind today’s, with a count of how many moved. |

Tickets that did not exist yet on the chosen date are reported separately.

### Interface

- **Resources** — Assignees from Jira; hours dock pinned at the bottom
- **Layout** — Resizable left-panel columns, collapse/expand all epics
- **Epic colors** — Click the epic color dot to pick a palette/custom color (saved locally)
- **Preview** — Clean, screenshot-ready view of the chart
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
| `JIRA_BASE_URL` | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | [Create an API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_JQL` | Default JQL for Pull (editable in the toolbar) |
| `PORT` | Backend port (default `8787`) |

The token needs permission to **read** and **write** Jira issues (Start date, Due date, transitions, issue properties).

Replace the placeholders in `.env` with your own Jira site, email, and token. Never commit `.env`.

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
   (key = PROJ-100 OR issuekey in portfolioChildIssuesOf(PROJ-100)) AND status != Canceled ORDER BY summary ASC
   ```

   **Save JQL** stores it under a name; the dropdown switches between saved queries.

2. Click **Pull** — epics become milestones; stories become tasks. Empty epics still appear and use their own dates/estimates.
3. Plan the schedule:
   - Edit **Start** / **Duration** in the left columns, or **drag / resize** bars on the timeline
   - Change **Status** via the status control (pending until Push)
   - Click an epic’s **color dot** to change its milestone color
   - Use the **+** menu in the *Name* column header to add a task, a local milestone, an integration test, or an E2E flow — or to delete one
4. Dirty rows show an amber marker. Click **Push** to write Start date, Due date, Story Points, status transitions, assignees, QA items, and draft-task creations — for dirty items only.
5. Conflicts (issue updated in Jira since Pull) are skipped — re-**Pull** to reconcile.
6. Tick **History** and pick a date to reconstruct an earlier plan. **Clear** discards unpushed ticket edits, QA changes, and drafts, keeping local milestones.

## Field mapping

| Gantt | Jira |
|-------|------|
| Milestone | Epic (parent) |
| Task | Story / Task (or the epic itself when it has no children) |
| Friendly id | Summary prefix `[M1-T1] …` |
| Start | Start date (discovered by field name) |
| Due / Duration | Due date ↔ working days (Sun–Thu, ± IL holidays) |
| Estimate | Story Points (shown on empty epics; used when dates are incomplete) |
| Prerequisites | “Blocks” issue links (blocked by) — read-only |
| Status | Issue status; Push via transitions (Done also logs a worklog) |
| Assignee | Display + resource hours; Push reassigns when changed in-app |
| QA row | `gantt.qa` issue property on each linked issue |
| History | Issue changelog + creation date |

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Jira credentials + reachability |
| `GET /api/config` | Default JQL, base URL, saved preferences |
| `GET` · `PUT` · `POST /api/state` | Read, merge, or replace preferences |
| `GET` · `PUT /api/cache` | Session snapshot (model + scroll) |
| `GET /api/pull?jql=` | Build the board from Jira |
| `POST /api/push` | Write schedule / status / assignee changes and create drafts |
| `GET /api/transitions/:key` | Available status transitions for an issue |
| `POST /api/changelogs` | Ticket history for the History views |
| `PUT /api/qa` | Upsert a QA item on its linked issues |
| `DELETE /api/qa` | Remove a QA item from its linked issues |

## Preferences & cache

### `preferences.json` (git-ignored)

Created automatically. Stores:

- `jql` — autosaved as you type
- `savedJqls` / `activeSavedJqlId` — named JQL presets
- `projectStart`, `showHolidays`, `showDeps`, `customNonWorkingDays`
- Layout: `leftPanelWidth`, `columnWidths`, `resourcesDockHeight`, `dayWidthPx`
- `theme` — `"light"` \| `"dark"`
- `milestoneColors` — epic key → color
- `localMarkers`, `draftTasks`, `markers`, `hiddenTasks` — rows that live outside Jira
- `milestoneOrder` / `taskOrder` / `collapsed` — manual board order and fold state
- `pendingQaDeletes` — QA rows removed locally, awaiting Push to delete in Jira
- Assignee colors (`resources`) and `allocations`

Defaults are shared with the UI in `src/domain/stateDefaults.ts`. Copy [`preferences.example.json`](preferences.example.json) for a starter. An older `gantt-state.json` is migrated to `preferences.json` on first run.

### `gantt-cache.json` (git-ignored)

Last Gantt snapshot + scroll. On refresh the app:

1. Restores the cached view immediately
2. Auto-Pulls from Jira when credentials work and JQL is set
3. Skips auto-Pull if you have unpushed edits — Push or Pull manually

## Project layout

```
server/index.ts   Express routes
server/jira.ts    Jira pull/push, transitions, changelogs, QA properties
server/state.ts   preferences.json
server/cache.ts   gantt-cache.json
src/api.ts        Typed browser client for /api
src/gantt/        Board, timeline, dialogs, columns, resources, status UI
src/lib/          Types, workday calendar, QA items, Jira history + schedule
src/domain/       Shared preference defaults (UI + API)
src/brand/        Logo mark and footer
preferences.json  Local prefs (ignored)
gantt-cache.json  Session snapshot (ignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API + Vite together |
| `npm run build` | Typecheck + production UI build |
| `npm start` | Serve API + built UI |
| `npm run preview` | Vite preview of the built UI |
