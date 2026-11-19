# CR-012 · Session device app in the pickleball brand

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** CR-011 (the website's pickleball brand)

## Requested change

Give the courtside app (the phone or tablet paired to a game) the same colours and look as the
website: "how update the app now", after CR-011 changed the website.

## Today

The app still has the template look: black and white buttons, a mint green accent, grey
backgrounds, and a placeholder logo (a sparkle on a gradient). The Android icon background is
the template's purple.

## Why

Players see the app courtside next to the website's navy, blue and lime. They should look like
one product.

## Scope

**In**

- The website's palette in the app: navy buttons with white text (white with navy text in dark
  mode), blue links, soft lime highlights and focus rings, off-white backgrounds, slate text, a
  navy dark mode.
- The court logo (white court lines, lime kitchen, on a navy tile) instead of the placeholder.
- The Pair screen opens on a navy panel with the court logo, like the website's sign-in.
- The Android icon background colour becomes navy.

**Out**

- New app icon and splash artwork (the icon pictures themselves are still the placeholder).
- Any change to how pairing, the live view or the game screens work.

## Acceptance criteria

- The Pair, game and "game ended" screens use navy buttons, blue links and the lime highlight,
  in light and dark mode.
- The Pair screen shows the navy panel with the court logo.
- Nothing about pairing or the game changes.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Pair, Session, Ended (colours everywhere; the Pair screen's header). |
| Data | None. |
| Build / rollout | Colours and the logo reach phones with the next app update (JavaScript only). The Android icon background (`app.json`) **needs a new build** to change on installed phones. No new permission. |
| Permissions | None. |
| Existing users | Looks different; works the same. |
| Size | S: tokens, one logo component, one screen header, `app.json`. |

## Open questions

- [ ] New app icon and splash artwork in the brand (needs the picture files)?

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly |
