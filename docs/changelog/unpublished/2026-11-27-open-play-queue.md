---
type: added
impact: minor
audience: user
ref: PLAN-009
---

Staff can run an Open Play session's queue from a tablet at the court. Checked-in players wait
in line, and the next four who waited longest are put into the fairest doubles game (by DUPR
or level, with new partners when it's a tie). Each game shows why those four were picked.
Courts fill as games end, and staff can enter scores, call a game off, swap a player, rest a
player, or pause the queue. Players see their place in line or their court in the player app,
the venue's TV board shows who's on each court and who's next, and each player's past games and
scores appear on their Play tab.

## Dev notes

- back/: run `npm run db:migrate` (051: `play_games`, `play_game_players`,
  `play_signups.queueEnteredAt` / `isResting`, `play_sessions.queuePaused`).
- back/: new `/api/v1/admin/open-play/sessions/:id/queue[/fill|/next|/pause]`,
  `/games/:id/end|void|swap` and `/signups/:id/rest`, plus
  `/api/v1/player/play/signups/:code/queue`. The TV board reply has a new `openPlay` list.
  Tests: `tests/open-play-queue.test.js`.
- front/: Admin → Open Play → a session → Run the queue
  (`/admin/dyna-cam/open-play/:id/queue`). The TV board shows Open Play and refreshes every
  15 s while a session runs.
- web-app/: the session page shows the player's place in line (refreshed every 10 s); the Play
  tab shows Open Play history.
