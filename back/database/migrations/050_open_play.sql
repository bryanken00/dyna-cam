-- 050_open_play.sql
-- PLAN-009 phase C: Open Play — a venue's drop-in sessions on some of its courts,
-- with a per-player fee, a level range and a cap on players. Players join and pay
-- online (Xendit, the venue's company's account) like bookings; staff add walk-ins.
--
-- play_series          a weekly repeat staff set up ("Tue & Thu 6–9 PM"); the minute job
--                      makes its sessions 4 weeks ahead (jobs/playSessionSeries.js).
--                      Stopped = no new sessions; the ones made stay.
-- play_series_courts   the courts a series' sessions use.
-- play_sessions        one session. kind Clinic is a coached session (phase F). playToken
--                      is its public link (/open-play/:playToken). Live / Ended come from
--                      the clock, not the status. A session's courts are blocked on their
--                      timeline by court_closures rows tied to it (playSessionId), so
--                      booking, availability, the Admin day grid and the TV board all
--                      see that time as taken.
-- play_session_courts  the courts a session uses.
-- play_signups         a player's spot (or a walk-in's, added by staff: playerId NULL).
--                      signupCode is on the Xendit invoice (play-<code>). Pending = held
--                      for its checkout until holdExpiresAt; Expired = the hold ran out.
-- payments.playSignupId  an online payment for a spot.

CREATE TABLE IF NOT EXISTS play_series (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  seriesId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  kind ENUM('OpenPlay','Clinic') NOT NULL DEFAULT 'OpenPlay',
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  daysOfWeek VARCHAR(20) NOT NULL,
  startTime TIME NOT NULL,
  endTime TIME NOT NULL,
  minLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  maxLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  capacity INT NOT NULL,
  pricePerHead DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  startsOn DATE NOT NULL,
  endsOn DATE NULL,
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Active','Stopped','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_play_series_venue (venueId, status),
  CONSTRAINT fk_play_series_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_series_courts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  seriesId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  UNIQUE INDEX uq_play_series_courts (seriesId, courtId),
  CONSTRAINT fk_play_series_courts_series FOREIGN KEY (seriesId) REFERENCES play_series(seriesId),
  CONSTRAINT fk_play_series_courts_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playSessionId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  seriesId VARCHAR(50) NULL,
  playToken VARCHAR(64) NOT NULL UNIQUE,
  kind ENUM('OpenPlay','Clinic') NOT NULL DEFAULT 'OpenPlay',
  title VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  minLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  maxLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  capacity INT NOT NULL,
  pricePerHead DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  createdByAccountId VARCHAR(50) NULL,
  cancelledAt DATETIME NULL,
  cancelReason VARCHAR(255) NULL,
  status ENUM('Scheduled','Cancelled','Deleted') NOT NULL DEFAULT 'Scheduled',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  -- the series job makes one session per series per start (re-running it adds nothing)
  UNIQUE INDEX uq_play_sessions_series_start (seriesId, startAt),
  INDEX idx_play_sessions_venue_start (venueId, startAt),
  INDEX idx_play_sessions_status_start (status, startAt),
  CONSTRAINT fk_play_sessions_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_play_sessions_series FOREIGN KEY (seriesId) REFERENCES play_series(seriesId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_session_courts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playSessionId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  UNIQUE INDEX uq_play_session_courts (playSessionId, courtId),
  INDEX idx_play_session_courts_court (courtId),
  CONSTRAINT fk_play_session_courts_session FOREIGN KEY (playSessionId) REFERENCES play_sessions(playSessionId),
  CONSTRAINT fk_play_session_courts_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE court_closures
  ADD COLUMN playSessionId VARCHAR(50) NULL AFTER courtId,
  ADD INDEX idx_court_closures_play_session (playSessionId),
  ADD CONSTRAINT fk_court_closures_play_session FOREIGN KEY (playSessionId) REFERENCES play_sessions(playSessionId);

CREATE TABLE IF NOT EXISTS play_signups (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playSignupId VARCHAR(50) NOT NULL UNIQUE,
  playSessionId VARCHAR(50) NOT NULL,
  playerId VARCHAR(50) NULL,
  walkInName VARCHAR(100) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  signupCode VARCHAR(12) NOT NULL UNIQUE,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  paymentStatus ENUM('Unpaid','Paid','Refunded','Free') NOT NULL DEFAULT 'Unpaid',
  holdExpiresAt DATETIME NULL,
  checkoutId VARCHAR(100) NULL,
  checkoutUrl VARCHAR(500) NULL,
  checkedInAt DATETIME NULL,
  cancelledAt DATETIME NULL,
  cancelledBy ENUM('Player','Staff','System') NULL,
  confirmationSentAt DATETIME NULL,
  reminderSentAt DATETIME NULL,
  cancelledEmailSentAt DATETIME NULL,
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Pending','Confirmed','CheckedIn','Cancelled','Expired','Deleted') NOT NULL DEFAULT 'Pending',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_play_signups_session (playSessionId, status),
  INDEX idx_play_signups_player (playerId, status),
  INDEX idx_play_signups_status_hold (status, holdExpiresAt),
  INDEX idx_play_signups_checkoutId (checkoutId),
  CONSTRAINT fk_play_signups_session FOREIGN KEY (playSessionId) REFERENCES play_sessions(playSessionId),
  CONSTRAINT fk_play_signups_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments
  ADD COLUMN playSignupId VARCHAR(50) NULL AFTER bookingId,
  ADD INDEX idx_payments_playSignupId (playSignupId),
  ADD CONSTRAINT fk_payments_play_signup FOREIGN KEY (playSignupId) REFERENCES play_signups(playSignupId);

-- ── permission (idempotent; matches what setup-database.js seeds) ───────────
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'open_play', NULL, 'Open Play sessions', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'open_play' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'open_play' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
