# CR-029 · Pick both ends of a save, and preview it

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-013](../CR-013-save-last-minutes/request.md) (saves), [CR-025](../CR-025-live-view-player-page/request.md) / [CR-028](../CR-028-game-page-device-controls/request.md) (the game page's Save), [CR-014](../CR-014-live-rewind/request.md) (the box's live view)

## Requested change

> Currently only one side we can adjust — possible both sides? Also add preview / replay of
> what's adjusted?

On the game page, "Save the last …" becomes a stretch with **two handles**: drag the start and
the end anywhere in the game so far (at least a minute long). **Preview** plays exactly that
stretch before saving it.

## Today

The save always ends at "now"; only its length can be changed (the left handle and − / +). There
is no way to watch the stretch before saving.

## Why

A player wants to keep a rally from earlier in the game, not only the last few minutes, and to
check it's the right moment before using one of the game's 5 saves.

## Scope

**In** — the game page's save picker (two handles, start and end times, Preview); the API
taking a start and end for a save; a recorder-box replay playlist for the preview.

**Out** — the courtside app's picker (it keeps "the last …"; it can follow later on the same API).

## Acceptance criteria

- On the game page I can drag both the start and the end of the save; it shows "3:53 – 7:53 ·
  4 min" and can't be shorter than a minute.
- With the end at "now", it keeps following the game until I move it.
- Preview plays that stretch of the game in the card; Save saves exactly that stretch.
- On a recorder box that hasn't been updated, Preview says the box needs an update, and Save still
  works.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public game page (`/session/:shareToken`) — the Save card. |
| Data | None (a save already stores its start and end). |
| Build / rollout | **Recorder-box update for Preview**: a new replay playlist on the box's live view. Old boxes keep working; only Preview is unavailable until updated. No app build. |
| Permissions | None. The game's share link is the credential; the API signs a preview link only for a stretch inside that game, and the box checks the stretch is the one signed. |
| Existing users | None — "the last …" saves from the courtside app work as before. |
| Size | L — API, box and page, with tests on both sides. |

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly |
