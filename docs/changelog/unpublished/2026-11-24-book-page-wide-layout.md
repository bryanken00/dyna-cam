---
type: improved
impact: patch
audience: user
ref: CR-032
---

On a computer, a venue's online booking page now uses the whole screen: dates, length and start
times on the left, and the picked time, price and booking form on the right, in two cards of the same height. Phones
are unchanged.

## Dev notes

- front/: `PublicLayout` takes `wide` (max-w-6xl; default stays max-w-md); `CourtSlotPicker`
  takes `columnsClassName` (default `grid-cols-3`); `pages/Public/Book` is two columns from `lg`;
  both cards stretch to the row's height and the details stay in view (sticky) inside the right one.
