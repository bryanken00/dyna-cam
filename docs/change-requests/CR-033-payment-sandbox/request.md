# CR-033 · Test payments without Xendit (payment sandbox)

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking, Phase F online payment)

## Requested change

> Can we make sandbox payment here? It can be turned on / off on back/.env
> Make the built-in fake checkout. I don't have Xendit right now.

Try out paying for a booking online (and cancelling it with a refund) without a Xendit account:
one switch in the server's settings turns on a built-in test checkout instead of Xendit's.

## Today

Online payment works only with Xendit keys in the server's settings. Without them the booking
page offers "Pay at the desk" only, so the Pay now flow can't be tried at all.

## Why

Xendit isn't set up yet; the online booking flow (pay, the booking turning Paid, cancel with a
refund, the settlement statement) still needs to be tried and demoed.

## Scope

**In**

- A server setting, `PAYMENT_SANDBOX=true`, that turns online payment on with a built-in test
  checkout instead of Xendit. Off (or missing) = today's behaviour.
- The test checkout page: the booking's description and amount, **Pay** and **Go back without
  paying**, clearly marked as a test. Pay returns the player to their booking, which turns Paid.
- Refunds of test payments go through at once.
- The booking pages say "test checkout" instead of naming Xendit while the sandbox is on.
- Never on in production: the switch is ignored when the server runs as production.

**Out**

- Simulating Xendit's failure cases (refused refunds, late webhooks) — the API tests already
  cover those with their own fake.
- Any change to how real Xendit payments work.

## Acceptance criteria

- With the switch on and no Xendit keys, the booking page offers Pay now.
- Pay now opens a test checkout page showing the booking and amount, marked as a test.
- Paying there returns to the booking page and the booking shows as Paid; the payment appears in
  Admin → Payments.
- Going back without paying leaves the booking waiting for payment, and it can be paid again.
- Cancelling a paid test booking (by the player or staff) refunds it.
- With the switch off, everything works as before.

## Impact

| Area | Detail |
| --- | --- |
| Screens | New public test checkout page; small copy change on the venue booking page and a booking's own page while the sandbox is on |
| Data | none — no migration. Test checkouts are kept in a small file on the server (`back/storage/`, not committed) |
| Build / rollout | new `back/.env` setting `PAYMENT_SANDBOX` (off by default); ignored in production |
| Permissions | none |
| Existing users | none — off unless switched on |
| Size | M — a fake payment provider behind the existing Xendit client, two endpoints, one page, tests |

## Open questions

- [x] Test payments land in Payments like real ones (marked by a `sandbox_` reference). Fine for
      development data.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
