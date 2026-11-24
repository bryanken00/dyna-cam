---
type: added
impact: patch
audience: internal
ref: CR-033
---

Online booking payment can be tried without a Xendit account: with the payment sandbox switched
on, "Pay now" opens a built-in test checkout (Pay / Go back) and refunds go through at once. No
real money moves, and it can't be switched on in production.

## Dev notes

- back/: new `PAYMENT_SANDBOX` in `.env` (`true` = on; blank / `false` = off; ignored when
  `NODE_ENV=production`). While on it takes over from the Xendit keys. Test checkouts are kept
  in `back/storage/payment-sandbox.json` (git-ignored; `PAYMENT_SANDBOX_FILE` moves it).
- back/: `lib/payments/sandbox.js` answers the Xendit client's calls; public API
  `GET /api/v1/public/payment-sandbox/:checkoutId` and `POST …/pay` (404 while off); the booking
  pages' replies carry `paymentSandbox`.
- back/: `package.json` gains `nodemonConfig.ignore: ["storage/*"]` so sandbox writes don't
  restart `npm run dev` — restart it once to pick that up.
- front/: new public page `/payment-sandbox/:checkoutId`; the booking pages say "test checkout"
  instead of naming Xendit while it's on.
