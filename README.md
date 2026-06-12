# viz-org

**See your entire work world as a board of time.**

viz-org is a visual task-management system built on one idea: your available
work time is a finite *board*, and everything you could spend it on is a *box*
on that board. The bigger the box, the more it holds. Empty space is time you
haven't committed yet — an invitation to plan.

![concept](https://img.shields.io/badge/concept-treemap%20of%20time-6366f1)

## The model

- **The Board** — represents your complete available work time. It's filled by a
  *treemap* of project boxes, each sized in proportion to how much it holds.
- **Projects** — boxes on the board. A project's size is driven by the number of
  tasks it contains, but you can also **allocate** extra space (reserve slots)
  beyond your current tasks. That reserved-but-empty space is room to plan.
- **Unallocated time** — any board space not claimed by a project shows up as a
  dashed "free" region you can click to spin up a new project.
- **Admin box** — an always-present catch-all project for loose tasks that don't
  belong anywhere else. It can't be deleted.
- **Tasks** — live inside projects. Each has an urgency (low/normal/high/urgent),
  an optional due date, and a done state. Click any project box to expand it and
  plan its tasks.
- **Daily Plan** — a sheet that pulls the pressing tasks (overdue, due soon,
  urgent, or planned for today) from *every* project plus admin, ordered by what
  needs attention first. Drag rows to reorder; the order sticks for the day.
- **Week strip** — the next 7 days as day boxes, each with its own hours
  available, a planned-vs-capacity bar, and the tasks scheduled to it. Drag a
  task from Today onto a day to plan it there (or between days); tasks due or
  snoozed to a day appear in its box automatically.
- **Email Intake** — pull candidate action items "from email" on request, then
  file each one into a project or straight into Admin.
- **Email capture** — a `#capture` URL (and a drag-to-bookmarks-bar bookmarklet
  for Outlook on the web / Gmail) that drops an email's subject + deep link into
  Email Intake in one click.

Everything persists locally (browser `localStorage`), so your board is there
when you come back.

## Run it

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
npm run lint     # type-check only
```

## How to use the board

1. **Open a project** — click any box. The panel lets you add tasks, set urgency
   and due dates, reorder by completing them, move tasks between projects, and
   adjust how much board space the project reserves.
2. **Add a project** — click **+ New project** in the header, or click the dashed
   *Unallocated time* region on the board. Give it a name and an allocation.
3. **Plan your day** — the **Daily Plan** card on the right surfaces what's
   pressing today across the whole board. Check items off there or jump to their
   project.
4. **Pull from email** — in **Email Intake**, hit *Pull from email* to surface
   candidate tasks, then file each into a project or Admin.
5. **Capture from your real inbox** — *Email Intake → ✉ Capture setup*, drag the
   bookmarklet to your bookmarks bar. With an email open (Outlook web or Gmail),
   click it: the subject and a link back to the message arrive as a candidate
   task. Any tool can also construct the URL directly:
   `…/#capture?title=…&link=…&due=yyyy-mm-dd&urgency=high&estimate=30&notes=…&from=…`
6. **Plan the week** — give each day box the hours you have, then drag tasks
   from Today onto the days you'll actually do them.

## Architecture

A self-contained **React + TypeScript + Vite** single-page app — no backend, no
accounts. State lives in a `useReducer` store persisted to `localStorage`.

```
src/
  types.ts                 domain model (Board, Project, Task, CandidateTask)
  treemap.ts               squarified treemap layout (sizes the boxes)
  store.ts                 state, reducer, persistence, daily-plan + email logic
  App.tsx                  layout + store provider
  components/
    Board.tsx              the dashboard — projects as a treemap of time
    ProjectPanel.tsx       expanded project view: plan & edit tasks
    TodayView.tsx          today's pressing tasks across all projects
    WeekStrip.tsx          the next 7 days as droppable day boxes
    EmailIntake.tsx        pull & file candidate tasks from email + capture setup
    AddProjectDialog.tsx   create a new project
```

### Note on email intake

The app ships with a **simulated** email source: *Pull from email* returns a few
plausible action items drawn from a sample set. The data shape
(`CandidateTask`) matches what a real email-extraction backend would return, so
swapping `fetchEmailCandidates()` in `src/store.ts` for a real mailbox
integration is the only change needed to make it live.
