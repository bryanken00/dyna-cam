-- 032_court_closures.sql
-- PLAN-003 Phase A: closures (blackouts) — a court, or the whole venue, can't be
-- booked or played on for a while (maintenance, an event, a tournament).
--
-- court_closures
--  • courtId NULL = the whole venue.
--  • startAt / endAt: Manila local, like every other window.

CREATE TABLE IF NOT EXISTS court_closures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  closureId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  reason VARCHAR(255) NULL,
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_court_closures_venue_window (venueId, status, startAt, endAt),
  INDEX idx_court_closures_court (courtId),
  CONSTRAINT fk_court_closures_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_court_closures_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
