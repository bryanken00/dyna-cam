-- 051_open_play_queue.sql
-- PLAN-009 phase D: the Open Play queue — staff run it on a tablet at the court.
-- Checked-in players wait in line (oldest first); the next four make a doubles game,
-- split into the fairest teams (utils/openPlayQueue.js); a game waits (Queued) until a
-- court is free, then plays there; when it ends its players go to the back of the line.
--
-- play_games                one game: Queued (next up) · Playing (on courtId) · Done (score
--                           optional) · Void (called off — its players keep their place).
--                           reason: the "why these 4" line staff see.
-- play_game_players         who's in it, on team A or B.
-- play_signups.queueEnteredAt  their place in line: set on check-in and when a game of theirs ends.
-- play_signups.isResting    sitting out — skipped by the queue until back.
-- play_sessions.queuePaused  no new game starts on its own (games on court finish).

CREATE TABLE IF NOT EXISTS play_games (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playGameId VARCHAR(50) NOT NULL UNIQUE,
  playSessionId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NULL,
  status ENUM('Queued','Playing','Done','Void') NOT NULL DEFAULT 'Queued',
  reason VARCHAR(255) NULL,
  queuedAt DATETIME NOT NULL,
  startedAt DATETIME NULL,
  endedAt DATETIME NULL,
  scoreA TINYINT UNSIGNED NULL,
  scoreB TINYINT UNSIGNED NULL,
  createdByAccountId VARCHAR(50) NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_play_games_session (playSessionId, status),
  INDEX idx_play_games_court (courtId, status),
  CONSTRAINT fk_play_games_session FOREIGN KEY (playSessionId) REFERENCES play_sessions(playSessionId),
  CONSTRAINT fk_play_games_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_game_players (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  playGameId VARCHAR(50) NOT NULL,
  playSignupId VARCHAR(50) NOT NULL,
  team ENUM('A','B') NOT NULL,
  UNIQUE INDEX uq_play_game_players (playGameId, playSignupId),
  INDEX idx_play_game_players_signup (playSignupId),
  CONSTRAINT fk_play_game_players_game FOREIGN KEY (playGameId) REFERENCES play_games(playGameId),
  CONSTRAINT fk_play_game_players_signup FOREIGN KEY (playSignupId) REFERENCES play_signups(playSignupId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE play_signups
  ADD COLUMN queueEnteredAt DATETIME NULL AFTER checkedInAt,
  ADD COLUMN isResting TINYINT(1) NOT NULL DEFAULT 0 AFTER queueEnteredAt;

ALTER TABLE play_sessions
  ADD COLUMN queuePaused TINYINT(1) NOT NULL DEFAULT 0 AFTER pricePerHead;
