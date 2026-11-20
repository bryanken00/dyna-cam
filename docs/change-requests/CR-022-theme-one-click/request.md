# CR-022 · Theme button: one click to change

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** —

## Requested change

> Can this only click to change? (the theme button in the top bar)

Each click moves to the next theme: **Auto → Light → Dark → Auto**. No menu.

## Today

Clicking the theme button opens a small menu with Auto, Light and Dark.

## Why

Faster: one click instead of two.

## Scope

**In**

- The shared theme button (Admin top bar, player's pages, landing page): one click cycles the
  theme; the icon shows the current one (monitor = Auto, sun = Light, moon = Dark); its tooltip
  says what it is and what the next click does.

**Out**

- The themes themselves.

## Acceptance criteria

- One click on the theme button changes the theme, in the order Auto → Light → Dark → Auto.
- The icon shows the current theme; hovering says e.g. "Theme: Light — click for Dark".
- The choice is still remembered after a reload.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: `components/ThemeToggle.jsx` (Admin top bar, player pages, landing page). |
| Data | None. |
| Build / rollout | Web deploy only. |
| Permissions | None. |
| Existing users | The menu is gone; a click changes the theme. Release impact `patch`. |
| Size | S. |

## Open questions

- [x] Toggle Light ↔ Dark, or cycle Auto → Light → Dark? → **Cycle all three** (bryanken00, 2026-11-20)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly; cycle chosen |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
