-- 041_players.sql
-- PLAN-006: players sign in with Google. A player account is made the first
-- time someone signs in; booking online needs one, and the player's game log
-- lists their bookings and games.
--
-- players                 one per Google account (googleSub = Google's stable user ID).
--                         Email and photo are copied from Google at each sign-in. On the
--                         first sign-in the player completes their profile — first, middle
--                         (optional) and last name and phone, filled in from Google where it
--                         can (profileCompletedAt); until then the names follow Google. `name`
--                         is the full name bookings use. Blocked = staff stopped them;
--                         Deleted = gone (a later sign-in makes a new account).
-- player_refresh_tokens   like refresh_tokens, for player sessions (30 days, rotated).
-- player_sign_in_codes    the single-use code the Google callback hands the browser
--                         (SHA-256 only, 60 s), traded for tokens — never a token in a URL.
-- bookings.playerId       the account that booked it online; NULL for desk bookings and
--                         bookings made before PLAN-006.

CREATE TABLE IF NOT EXISTS players (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playerId VARCHAR(50) NOT NULL UNIQUE,
  googleSub VARCHAR(64) NULL,
  email VARCHAR(255) NOT NULL,
  firstName VARCHAR(50) NULL,
  middleName VARCHAR(50) NULL,
  lastName VARCHAR(50) NULL,
  name VARCHAR(100) NOT NULL,
  photoUrl VARCHAR(500) NULL,
  phone VARCHAR(20) NULL,
  profileCompletedAt DATETIME NULL,
  lastSignInAt DATETIME NULL,
  status ENUM('Active','Blocked','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  -- NULL once Deleted, so the same Google account can make a fresh one
  UNIQUE INDEX uq_players_googleSub (googleSub),
  INDEX idx_players_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_refresh_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  jti VARCHAR(64) NOT NULL UNIQUE,
  playerId VARCHAR(50) NOT NULL,
  expiresAt DATETIME NOT NULL,
  revokedAt DATETIME NULL,
  replacedByJti VARCHAR(64) NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_player_refresh_tokens_playerId (playerId),
  INDEX idx_player_refresh_tokens_expiresAt (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_sign_in_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  codeHash CHAR(64) NOT NULL UNIQUE,
  playerId VARCHAR(50) NOT NULL,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_player_sign_in_codes_expiresAt (expiresAt),
  CONSTRAINT fk_player_sign_in_codes_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bookings
  ADD COLUMN playerId VARCHAR(50) NULL AFTER createdByAccountId,
  ADD INDEX idx_bookings_playerId (playerId),
  ADD INDEX idx_bookings_email (email),
  ADD CONSTRAINT fk_bookings_player FOREIGN KEY (playerId) REFERENCES players(playerId);
