-- 030_booking_settings.sql
-- PLAN-003 Phase A: a venue's court-booking rules and opening hours.
--
-- venues
--  • bookingToken: the code in the venue's public booking link (/book/<bookingToken>).
--    NULL = online booking is off. Staff issue a new link (the old one stops
--    working) or turn it off, like a court's QR code.
--  • maxBookingMinutes: longest booking, a multiple of 60 — the booking grid is
--    fixed at whole hours for every venue (BOOKING_SLOT_MINUTES in utils/bookingPrice.js).
--  • bookingDaysAhead: how far ahead players can book.
--  • deskHoldMinutes: an unpaid "pay at the desk" booking is released this many
--    minutes before its start.
--  • onlineHoldMinutes: how long an online checkout (Xendit invoice) holds the slot.
--  • cancelCutoffHours: players can cancel or move up to this many hours before the start.
--  • checkInEarlyMinutes: how early before the start a player can check in.
--
-- venue_hours: one Active row per open day (dayOfWeek 0 = Sunday … 6 = Saturday).
-- No row for a day = closed that day. closesAt may be 24:00:00 (open until midnight);
-- hours past midnight are out of scope.

ALTER TABLE venues
  ADD COLUMN bookingToken VARCHAR(64) NULL AFTER clipPrice,
  ADD COLUMN maxBookingMinutes INT NOT NULL DEFAULT 180 AFTER bookingToken,
  ADD COLUMN bookingDaysAhead INT NOT NULL DEFAULT 14 AFTER maxBookingMinutes,
  ADD COLUMN deskHoldMinutes INT NOT NULL DEFAULT 30 AFTER bookingDaysAhead,
  ADD COLUMN onlineHoldMinutes INT NOT NULL DEFAULT 15 AFTER deskHoldMinutes,
  ADD COLUMN cancelCutoffHours INT NOT NULL DEFAULT 24 AFTER onlineHoldMinutes,
  ADD COLUMN checkInEarlyMinutes INT NOT NULL DEFAULT 10 AFTER cancelCutoffHours,
  ADD UNIQUE INDEX uq_venues_bookingToken (bookingToken);

CREATE TABLE IF NOT EXISTS venue_hours (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  venueHourId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  dayOfWeek TINYINT NOT NULL,
  opensAt TIME NOT NULL,
  closesAt TIME NOT NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_venue_hours_venue_day (venueId, dayOfWeek, status),
  CONSTRAINT fk_venue_hours_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
