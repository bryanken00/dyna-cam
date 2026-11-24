---
type: improved
impact: patch
audience: user
ref: CR-037
---

On a computer, the game page shows your saves under the video, two per row, with how many of
your saves you've used; the right side keeps the game's controls. Phones are unchanged.

## Dev notes

- front/: `pages/Public/Session/index.jsx` — on wide screens the saves block moves to the left
  column as a two-column grid (heading shows used / allowed).
