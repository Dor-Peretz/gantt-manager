# Gantt Manager

Local Jira-backed Gantt planner. **Jira is the source of truth** for tasks; the app pulls issues via JQL, lets you plan Start / Duration on a TeamGantt-style chart (Sun–Thu work week, IL holidays, prerequisites, resource hours), then **Push** writes only **Start date** + **Due date** back to Jira.

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
| `JIRA_API_TOKEN` | [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_JQL` | Default JQL for Pull (editable in the toolbar) |
| `PORT` | Backend port (default `8787`) |

Token needs **read:jira-work** and **write:jira-work** (create/update issues for Start date + Due date).

## Run

```bash
npm run dev
```

- UI: http://localhost:5173 (Vite, proxies `/api` → backend)
- API: http://localhost:8787

Production-style:

```bash
npm run build
npm start
```

Then open http://localhost:8787.

## Usage

1. Enter JQL (or use the default), e.g. `project = SBT AND parent = SBT-61018 ORDER BY rank ASC`.
2. Click **Pull** — epics become milestone rows; stories/tasks become schedule rows.
3. Edit Start / Duration (or drag/resize bars). Dirty tasks show an amber marker.
4. Click **Push** — writes Start date (`customfield_10907`) and Due date for dirty tasks only. Conflicts (issue updated in Jira since pull) are skipped; re-Pull to reconcile.
5. Assign people in the Resources pane — stored locally in `gantt-state.json` (not pushed to Jira).

## Field mapping

| Gantt | Jira |
|-------|------|
| Milestone | Parent Epic |
| Task | Story / Task |
| Friendly id | Summary prefix `[M1-T1] …` |
| Start | Start date (`customfield_10907`, auto-discovered) |
| Due / Duration | Due date ↔ working days (Sun–Thu, ± IL holidays) |
| Prerequisites | “Blocks” issue links (is blocked by) — read-only |
| Assignee / Team | Display only |

## Local state

`gantt-state.json` (git-ignored) holds resources, allocations, collapsed epics, project start, and toggles.
