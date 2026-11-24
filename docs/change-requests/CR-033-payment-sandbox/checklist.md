# CR-033 · Test payments without Xendit (payment sandbox) — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `lib/payments/sandbox.js`: file-backed fake of the Xendit calls we use (create / get /
      expire invoice, create / get refund), plus the checkout page's view and Pay
- [x] `lib/payments/xendit.js`: `isPaymentSandbox()` (`PAYMENT_SANDBOX=true`, never in
      production); `isOnlinePaymentOn()` true in sandbox; `request()` answered by the sandbox
- [x] Public API `GET /public/payment-sandbox/:checkoutId` and `POST …/pay` (404 when the sandbox
      is off), rate-limited, token param validated
- [x] `paymentSandbox` flag on the venue booking page and a booking's own page
- [x] `.env.example` documents `PAYMENT_SANDBOX`; `/storage` git-ignored; test env forces it off
- [x] Tests: off → 404 and no Pay now; on → book online, checkout view, pay, booking Paid,
      cancel refunds; production ignores it
- [x] Front: services + hooks; `/payment-sandbox/:checkoutId` page; booking page copy
- [x] `nodemonConfig` ignores `storage/` (a sandbox write restarted `npm run dev`)

## Acceptance

- [x] Switch on, no keys: Pay now offered
- [x] Test checkout shows booking and amount, marked as a test
- [x] Pay → back on the booking, Paid; payment in Admin → Payments
- [x] Go back without paying → still waiting; can pay again
- [x] Cancel a paid test booking → refunded
- [x] Switch off → as before

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-033`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
