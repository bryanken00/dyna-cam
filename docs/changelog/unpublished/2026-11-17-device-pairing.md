---
type: added
impact: minor
audience: user
ref: PLAN-002
---

Staff phones and recorder boxes now connect with a **6-digit pairing key** instead of a login or
a long token. In the Admin portal, **Dyna Cam → Paired Apps → Pair a phone** shows a key that
works once for 10 minutes; type it into the staff app and that phone stays paired to the venue
until you revoke it. **Setup → Recorder Boxes → Add box** does the same for a recorder box: put
the key in its settings and it pairs itself on first start. Paired phones can save clips and take
cash, and the Clips and Payments pages show which phone did it.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `008_add_device_pairing`: `pairing_codes`,
  `paired_apps`, `clips.pairedAppId`, `payments.pairedAppId`, permission `paired_apps` granted to
  the Owner). New route families `/api/v1/pair/*` (key → token, rate-limited per IP plus a global
  pause; `RATE_LIMIT_PAIR_POINTS`, `RATE_LIMIT_PAIR_HOURLY_POINTS`, `PAIR_MAX_FAILURES`) and
  `/api/v1/app/*` (`Authorization: App <token>`, venue-scoped). Keys are stored as an HMAC keyed
  with `DEVICE_SECRET_KEY`.
- `edge/`: update every recorder box. `PAIRING_CODE` in `.env` pairs on first start and saves the
  token to `DATA_DIR/device.json`; an existing `DEVICE_TOKEN` keeps working.
- `front/`: new Paired Apps page and pairing-key dialogs.
