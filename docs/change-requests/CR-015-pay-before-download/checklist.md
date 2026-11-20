# CR-015 · Pay at the front desk before the game's videos open — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

### API (`back/`)

- [x] Migration `021`: `recording_sessions.paymentStatus` + `payCode` (unique), existing games
      Free; `payments.sessionId` (+ FK, index), `payments.clipId` nullable
- [x] New games (open and booked) get a pay code and start Unpaid
- [x] `POST /admin/payments` takes `sessionId` + `amount` (payments write); one payment per game;
      refund locks the game again; the list and totals include game payments
- [x] Admin Sessions: `paymentStatus`, `payCode`, `paidAmount` on list + detail; search by code
- [x] Player page `/public/sessions/:token`: locked while unpaid (no video, download or Drive
      links; `payCode` shown)
- [x] Device `/app/session`: `payment { status, payCode }`; `shareUrl` only once paid
- [x] `GET /public/games/:payCode` (rate-limited): court, venue, time, paid, link once paid
- [x] Tests: new game unpaid with a code, locked page, device without link, payment unlocks,
      amount required, twice → 409, refund locks, find by code, 404s

### Web (`front/`)

- [x] Player's game page: "Pay at the front desk" with the code while unpaid; checks again until paid
- [x] Admin Sessions: payment badge, search by code, Record payment in the game's detail
- [x] Payments page: game payments listed
- [x] Revision: Payments → Take payment finds a game by its code and takes the typed amount
      (`GET /admin/payments/lookup` → `{ kind: "Game", game }`); clip and game codes never clash

### App (`app/`)

- [x] Session screen: game code card in place of the QR until paid
- [x] Ended screen: game code + "Pay at the front desk" until paid, then the QR
- [x] Pair screen: Find a game by code → QR once paid / Not paid yet / not found
- [x] Revision: the link under every download QR (game, Ended, Find a game) opens the game's
      page when tapped (`LinkText`)
- [x] Revision: "Free game" on New game (`POST /admin/sessions { free: true }` → paymentStatus
      Free, no code); test
- [x] Demo data (staff "pay" 15 s after End game; Find a game: K7QM2P)

## Acceptance

- [x] Device shows the code, not the QR, during and after a new game
- [x] Link before payment: "Pay at the front desk", nothing plays or downloads
- [x] Record payment in Sessions → device shows the QR, link plays and downloads
- [x] Payment on the Payments page; refund locks the page again
- [x] Find a game by code after the device unpaired
- [x] Older games stay open

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` passes (expo-doctor not re-run: no dependency change)
- [x] Migration noted as pending: `npm run db:migrate` (not run on the dev database)
- [x] Changelog entry added (`ref: CR-015`, major)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
