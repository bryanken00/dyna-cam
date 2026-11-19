---
type: added
impact: minor
audience: user
ref: CR-008
---

Staff now hear about trouble at a venue before players do. If a recorder box goes offline, a
camera stops recording, or a box runs low on disk space, has the wrong time, or can't send its
clips, a message goes to the staff Discord channel within about five minutes, and another when
it's fixed. The Dashboard is now **Today on court**: today's games, replays and cash, every
court drawn as a pickleball court showing whether a game is on, how long is left and whether its
cameras are recording, and anything that needs attention at the top.

## Dev notes

- back/: run `npm run db:migrate` (migration `019_venue_alerts.sql`: `venue_alerts` table and the
  new `alerts` permission, given to the Owner role). Give "Venue alerts" to the roles that should
  see problems on the Dashboard.
- back/: set `ALERT_DISCORD_WEBHOOK_URL` in `.env` (a channel webhook; keep it secret). Without it
  problems are only logged and shown on the Dashboard. Optional: `ALERT_DISCORD_USERNAME`,
  `ALERT_GRACE_MINUTES` (4), `ALERT_DISK_FREE_PERCENT` (10), `ALERT_CLOCK_MS` (2000),
  `ALERT_BACKLOG_MINUTES` (60), `ALERTS_ENABLED=false` to turn the job off.
- back/: email alerts to users with Venue alerts are built in, but only sent once `SMTP_HOST` is
  set (`ALERT_EMAIL=false` keeps them off even then).
- back/: new `GET /api/v1/admin/dashboard/venues` (dashboard) and `/dashboard/alerts` (alerts);
  the heartbeat accepts an optional `system` field. Job `jobs/venueAlerts.js` runs every minute.
- front/: Dashboard rebuilt as "Today on court" (court board, figures, problems). The user, role
  and audit-count cards and the two charts are gone; recent activity stays. Browser tab title is
  now "Dyna Cam".
- edge/: update the recorder box at every venue to report disk, memory, clock and upload backlog.
  Boxes not yet updated keep working; only their offline and camera alerts work.
