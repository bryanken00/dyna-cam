---
type: improved
impact: patch
audience: user
ref: CR-031
---

On Admin → Bookings → Day, the court names now stay on the left while you scroll through the
hours. Today's grid opens already scrolled to the current time.

## Dev notes

- front/: `Bookings/components/DayGrid.jsx`. The court column is `position: sticky`. The grid
  scrolls once for each new day on screen (keyed on the date and its courts, not the picked date,
  so it waits for the new day to load). The 60-second refresh never moves the scroll.
