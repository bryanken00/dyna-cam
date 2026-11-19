# CR-008 · Venue health and alerts

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** PLAN-001 (heartbeat, Dashboard), PLAN-002 (recorder boxes from `.env`)

## Requested change

Staff should find out that a camera or recorder box is down before a player does. When a box
goes offline, a camera stops recording, a box's disk is filling up, its clock is wrong, or its
uploads are piling up, a message goes to the staff Discord channel, and another when it's fixed.
Email to the staff responsible is built in too, and starts once the server can send email. The
web Dashboard shows how the venues are doing today and lists every problem that's still open.

## Today

- Each box sends a heartbeat every 30 seconds with each camera's state. The Setup pages show
  that state, but only if someone opens them.
- Nobody is told when a box stops sending heartbeats or a camera goes into error. Staff usually
  learn about it when a player says their clip never came.
- The box doesn't report on itself: there's no disk space, clock, memory or upload backlog in the
  heartbeat. A full disk means recording quietly stops.
- The web Dashboard is still the template's: total users, active users, roles, audit events.

## Why

A missed clip or a game with no video is the one failure players remember, and it's usually
caused by something staff could have fixed in five minutes (a camera unplugged, a box off, a
full disk). The 6-court load test was never run (PLAN-001), so the box's own numbers on the real
hardware are the next best thing.

## Scope

**In**

- The box reports its own health in the heartbeat: free disk space, memory, CPU load, uptime,
  how far its clock is from the server's, and how many clips and game videos it still has to
  send.
- The server opens a **problem** when one of these holds for a few minutes, and closes it when
  it clears:
  - box offline (no heartbeat)
  - camera not recording (error state)
  - disk almost full
  - clock off by more than 2 seconds
  - upload backlog growing (clips or game videos not sent)
- A message to the staff **Discord** channel (a webhook) when a problem opens, and again when
  it's resolved. Each run sends one message covering every change, never one per heartbeat.
- The same as an **email** to staff with the new **Venue alerts** permission. It's built but
  stays off until SMTP is set up on the server (2026-11-19: "not functional yet").
- A message only counts as sent when Discord or email actually took it.
- A new Dashboard: games recording now, clips today, cash taken today, boxes and cameras online,
  and the list of open problems (venue, court, what, since when).

**Out**

- SMS, Messenger or push alerts (Discord and email only; another channel can be added later).
- Quiet hours or venue opening times (see Open questions).
- Alerts for players.
- A page for the history of past problems (they're kept in the database for later).

## Acceptance criteria

- Unplug a camera: within about 5 minutes, the Discord channel gets a message naming the venue,
  court and camera. Plug it back in, and a "fixed" message follows.
- Stop the recorder box: within about 5 minutes, a Discord message says the box is offline. Start
  it again, and a "fixed" message follows.
- Once SMTP is set up, staff with Venue alerts get the same by email.
- A box with less than 10% disk left raises a "disk almost full" problem.
- The Dashboard shows today's games, clips and cash, which boxes and cameras are up, and every
  open problem with how long it has been open.
- Someone without Venue alerts gets no emails and doesn't see the problem list or box health.
- A box that hasn't been updated keeps working; its disk and clock just don't show.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web Dashboard (rebuilt). Roles page lists the new permission. |
| Data | New `venue_alerts` table (migration `019`). Box health goes into the existing `devices.lastStatus` JSON, so no column is needed for it. |
| Build / rollout | **Recorder box update** for disk, clock and backlog. Old boxes keep working: the new `system` field is optional, and offline/camera alerts work from what they already send. No app build. |
| Permissions | New `alerts` permission ("Venue alerts"): `read` sees the problem list and box health, and receives the emails. Seeded `Active`; nobody has it until a role or user is given it (the Owner always has it). |
| Existing users | The Dashboard's user/role/audit cards are replaced by venue figures. Nothing else changes. |
| Size | L: edge health sampling, a new alert job and table, Discord + email, a Dashboard rebuild, tests. |
| Configuration | `ALERT_DISCORD_WEBHOOK_URL` (secret) in the API's `.env`; email needs `SMTP_HOST` …; thresholds `ALERT_*`. |

## Open questions

- [ ] **Boxes switched off at night** will send one "offline" email each evening and an "all
      clear" each morning. Fine for now, or should venues get opening hours and alerts only
      within them?
- [x] **Channel:** Discord webhook now, email once SMTP works (2026-11-19, bryanken00).
- [ ] **Emails need SMTP** (`SMTP_HOST` …) in the API's `.env`. Which mailbox sends them?
- [ ] Which Discord channel gets the webhook?

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly ("Keeping it running") |

## Revisions

- 2026-11-19: Alerts go to a **Discord webhook**. Email stays in, but only sends once SMTP is set
  up (requester: "not email … add discord webhook", then "continue with email, but not functional
  yet, also implement discord webhook").
- 2026-11-19: The Dashboard is redesigned for pickleball (requester: "update the UI UX … like use
  for the pickleball", "also the title"). It's now **Today on court**: four figures (games on
  court, replays saved, cash today, cameras rolling), a **court board** with every court drawn
  from above (kitchen, net, a camera at each baseline in its status colour, the outline lit while
  a game is on), what's happening on each court ("Game on · 23 min left", "Next game at 4:30 PM",
  "Court open") and today's replays, then "Needs attention" first when anything is wrong. No
  player names on the board. The browser tab now reads "Dyna Cam".
