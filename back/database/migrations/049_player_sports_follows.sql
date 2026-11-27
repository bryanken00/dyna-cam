-- 049_player_sports_follows.sql
-- PLAN-009 phase B: a player's sport profile, the venues they follow, and what a
-- venue's courts and facilities are like (Discover's filters).
--
-- player_sports     one row per player per sport (pickleball only for now). skillLevel is
--                   the player's own rating; duprId / duprRating are typed in by the player
--                   and shown as unverified (duprVerifiedAt stays NULL until DUPR sync exists).
-- venue_follows     a player following a venue (Following on the Play tab). Unfollow = Deleted;
--                   following again brings the same row back.
-- courts.surface    the playing surface; NULL = not said.
-- courts.isIndoor   1 indoor, 0 outdoor, NULL = not said.
-- venues.amenities  what the venue has, from a fixed list; NULL / '' = not said.

CREATE TABLE IF NOT EXISTS player_sports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playerSportId VARCHAR(50) NOT NULL UNIQUE,
  playerId VARCHAR(50) NOT NULL,
  sport ENUM('Pickleball') NOT NULL DEFAULT 'Pickleball',
  skillLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  duprId VARCHAR(20) NULL,
  duprRating DECIMAL(4,3) NULL,
  duprVerifiedAt DATETIME NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  UNIQUE INDEX uq_player_sports_player_sport (playerId, sport),
  CONSTRAINT fk_player_sports_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venue_follows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  venueFollowId VARCHAR(50) NOT NULL UNIQUE,
  playerId VARCHAR(50) NOT NULL,
  venueId VARCHAR(50) NOT NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  UNIQUE INDEX uq_venue_follows_player_venue (playerId, venueId),
  INDEX idx_venue_follows_venue (venueId, status),
  CONSTRAINT fk_venue_follows_player FOREIGN KEY (playerId) REFERENCES players(playerId),
  CONSTRAINT fk_venue_follows_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE courts
  ADD COLUMN surface ENUM('Hard','Synthetic','Wood','Concrete','Other') NULL AFTER name,
  ADD COLUMN isIndoor TINYINT(1) NULL AFTER surface;

ALTER TABLE venues
  ADD COLUMN amenities SET('Parking','Showers','Lockers','Restrooms','Food','Pro shop','Lights','Aircon') NULL AFTER longitude;
