# CR-008 · Venue health and alerts — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [ ] Open questions answered *(defaults used: alert any time; Discord now, email once SMTP is set)*

## Build

### Recorder box (`edge/`)

- [x] Sample box health each heartbeat: disk free/total for `DATA_DIR`, memory, load, CPU count,
      uptime, clock offset from the last `serverTime`, pending clip jobs and game uploads
      (`src/health.js`)
- [x] Send it as the heartbeat's optional `system` field (`sync.js`, wired in `index.js`)
- [x] Unit tests for the sampler (`test/health.test.js`); `npm run lint && npm test` (256/256)

### API (`back/`)

- [x] Migration `019`: `venue_alerts` table + `alerts` permission (Owner role granted)
- [x] Heartbeat validator accepts `system` (optional); stored in `devices.lastStatus`
- [x] `utils/venueHealth.js`: work out the current problems from devices + courts
- [x] `jobs/venueAlerts.js`: every minute, open/resolve `venue_alerts` rows with a grace period,
      send on open and on resolve; scheduled in `bin/www.js` (`ALERTS_ENABLED=false` turns it off)
- [x] Discord webhook sender (`lib/discord/webhook.js`): mentions off, 10 embeds, one 429 retry,
      URL validated and never logged
- [x] Email to users with `alerts` read (+ the Owner) — only when `SMTP_HOST` is set
      (`ALERT_EMAIL=false` keeps it off); template `venueAlertsEmail`
- [x] `GET /admin/dashboard/venues` (dashboard read): today's figures;
      `GET /admin/dashboard/alerts` (alerts read): open problems + box/camera health
- [x] Tests (`tests/venue-alerts.test.js`, 14): grace period, sent once, offline box keeps camera
      problems, resolve, cleared silently, disk/clock/backlog, email recipients, nothing marked
      sent when no channel delivered, Dashboard permission, Discord sender

### Web (`front/`)

- [x] Dashboard rebuilt: stat cards (recording now, clips today, cash today, boxes online,
      cameras recording, games today) + open problems + recorder boxes with health, refreshing
      every 30 s; recent activity kept
- [x] Pickleball redesign (revision 2026-11-19): title "Today on court", tab title "Dyna Cam",
      four figures, court board by venue (`components/CourtBoard.jsx`, `CourtDiagram.jsx`, to
      scale), problems shown first; API `venues.courts` (cameras, game on court / next, replays
      today; no player names) + test

### Docs

- [x] `edge/README.md`: what the box reports; `back/.env.example`: alert settings; edge and
      backend skills updated

## Acceptance

- [ ] Unplugged camera → Discord message within ~5 min; plugged back → "fixed" message
- [ ] Stopped box → offline message within ~5 min; started → "fixed" message
- [ ] Once SMTP is set: the same by email
- [x] Disk under 10% → "disk almost full" problem *(API test)*
- [ ] Dashboard shows today's games, clips, cash, boxes/cameras up, each court, open problems
- [x] No Venue alerts permission → no emails, no problem list *(API test)*
- [x] An old box keeps working *(API test: heartbeat without `system`)*

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (243/243; lint 0 errors, only older warnings)
- [x] `cd front && npm run lint && npm run build` passes (only older warnings)
- [x] `cd edge && npm run lint && npm test` passes
- [ ] Migration applied, or noted as pending for deploy *(pending: `npm run db:migrate` → `019`)*
- [x] Changelog entry added (`ref: CR-008`): `docs/changelog/unpublished/2026-11-19-venue-health-alerts.md`
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
