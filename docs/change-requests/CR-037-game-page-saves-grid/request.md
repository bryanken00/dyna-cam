# CR-037 · Game page: "Your saves" as a grid under the video on desktop

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-035](../CR-035-player-pages-wide-layout/request.md) (the game page's two columns)

## Requested change

> Update the UI UX for Your saves for desktop view

## Today

On a computer the game page has the live view (or the whole-game video) on the left and, on the
right, Save a part of your game, End game, streaming, then **Your saves** as one long column of
cards. With five saves the right column runs far below the video while the left side is empty.

## Why

The saves are the player's best moments; they should sit beside the video, easy to scan, not at
the bottom of a narrow column.

## Scope

**In**

- On a computer, **Your saves** moves to the left column, under the live view / video, as a grid
  of cards (two per row), headed with how many of the game's saves are used.
- The right column keeps Save a part of your game, End game, streaming, Google Drive and Share.

**Out**

- Phones: unchanged (one column, saves where they are today).
- What a save does (play, download, delete).

## Acceptance criteria

- On a computer, Your saves appear under the video, two per row, and the right column is only the
  game's controls.
- On a phone the page looks as before.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public game page `/session/:shareToken` |
| Data | none |
| Build / rollout | none (web only) |
| Permissions | none |
| Existing users | Layout only on wide screens |
| Size | S — one page |

## Open questions

- [x] None.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
