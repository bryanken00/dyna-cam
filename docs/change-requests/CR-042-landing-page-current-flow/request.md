# CR-042 · Landing page matches today's player flow

> **Status:** In progress · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-011](../CR-011-pickleball-landing-page/request.md) (the landing page), [CR-030](../CR-030-player-booking-entry/request.md), [CR-034](../CR-034-court-qr-booking-only/request.md), [CR-039](../CR-039-new-game-always-free/request.md), [CR-040](../CR-040-videos-local-drive-only/request.md), [CR-041](../CR-041-resume-booked-game/request.md)

## Requested change

> Can you update /front landing page? align whats the new process

The home page should describe how DGSports works now: book online, check in at the court with the
booking code, watch and save during the game, and get the whole game from Google Drive.

## Today

The home page still describes earlier versions:

- "Ask the front desk and you're set", and players can record "with or without a booked game".
- The court QR "lets players start recording themselves", and games started from it are free.
- The whole game is "ready on your game's page".
- "Your logo on every replay" — the 60-second clips that carried the logo are gone.
- Videos "copied" to Google Drive, kept 7 days on our side and 2 days in Drive.
- Going live starts from "the code on the courtside device".

## Why

Players and venues read the home page first; it should promise exactly what the product does.

## Scope

**In**

- The home page's words: hero, How it works, During your game, For venues, the privacy note.
- Staff sign-in: its subtitle and side-panel line (they still said "replays"), and no icon above the title.

**Out**

- Layout, design and the hero picture stay as they are. No other page changes.

## Acceptance criteria

- How it works shows: book (pay online or at the desk) → check in at the court with the booking
  code → watch live and save rallies → the whole game in Google Drive.
- Nothing on the page says players can start a game without a booking, that videos play on our
  site, or that replays carry the venue's logo.
- For venues lists online booking and payment, check-in at the court, two cameras, videos straight
  to the venue's Google Drive, the TV court board, streaming, and outage alerts.
- The privacy note says videos go from the venue straight to Google Drive and are kept for the
  venue's keep time (7 days unless it chooses otherwise).

## Impact

| Area | Detail |
| --- | --- |
| Screens | Home page (`/`); staff sign-in (subtitle, side panel) |
| Data | None |
| Build / rollout | None — front-end rebuild |
| Permissions | None |
| Existing users | Words only; nothing works differently |
| Size | S — copy changes in one file |

## Open questions

- None.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
