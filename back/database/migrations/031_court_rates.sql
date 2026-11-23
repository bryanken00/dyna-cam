-- 031_court_rates.sql
-- PLAN-003 Phase A: court prices per hour.
--
-- court_rates: a price per hour for some days and hours ("Peak", Mon–Fri 17:00–22:00).
--  • courtId NULL = every court at the venue; a court's own rate beats a venue-wide one.
--  • daysOfWeek: comma-separated days, 0 = Sunday … 6 = Saturday (e.g. "1,2,3,4,5").
--  • startTime / endTime: on the hour; endTime may be 24:00:00.
-- A booking's price is the sum of each booked hour's matching rate, snapshotted on
-- the booking. An open hour with no matching rate can't be booked online.

CREATE TABLE IF NOT EXISTS court_rates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  rateId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NULL,
  name VARCHAR(50) NOT NULL,
  daysOfWeek VARCHAR(20) NOT NULL,
  startTime TIME NOT NULL,
  endTime TIME NOT NULL,
  pricePerHour DECIMAL(10,2) NOT NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_court_rates_venue (venueId, status),
  INDEX idx_court_rates_court (courtId),
  CONSTRAINT fk_court_rates_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_court_rates_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
