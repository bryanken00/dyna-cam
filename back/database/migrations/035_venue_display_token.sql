-- 035_venue_display_token.sql
-- CR-038: a venue's TV court board.
--
-- venues.displayToken — the code in the venue's public court board link
-- (/board/<displayToken>), opened on a TV at the venue: today's courts as
-- free / booked / in play / closed, with no names, booking codes or IDs.
-- NULL = the board is off. Separate from bookingToken, so the board works
-- whether or not online booking is on, and each can be replaced alone.

ALTER TABLE venues
  ADD COLUMN displayToken VARCHAR(64) NULL AFTER bookingToken,
  ADD UNIQUE INDEX uq_venues_displayToken (displayToken);
