---
type: improved
impact: major
audience: user
ref: CR-015
---

Players now pay at the front desk before they get a game's videos. The courtside device shows a
game code instead of the download QR, and the game's page shows "Pay at the front desk" with that
code. Staff type that code into Take payment on the Payments page (or open the game in Sessions
and tap Record payment) and enter the amount; the QR then appears
on the device and the page plays and downloads. A refund on the Payments page locks the game again.
After the device has unpaired, "Find a game by its code" on its pairing screen shows a paid game's
QR. Staff can tick "Free game" when creating a game to skip payment, and games recorded before
this update stay open.

## Dev notes

- back/: run `npm run db:migrate` (migration `021_session_payments.sql`: game payment status and
  code, `payments.sessionId`; existing games become Free). The API errors on games until it runs.
- back/: `POST /admin/payments` takes `{ sessionId, amount, note? }` (Payments permission);
  `GET /public/games/:payCode` is new (optional `RATE_LIMIT_FIND_GAME_POINTS`, default 10/min/IP).
- back/: `/app/session` and pairing return `shareUrl: null` and `payment { status, payCode }` while
  a game is unpaid. An older app shows a loading spinner instead of the QR until it's paid —
  update the courtside devices.
- app/: JS-only update (no new native module); front/: deploy with the API.
- Staff who take game payments need the Payments permission (write) on their role.
