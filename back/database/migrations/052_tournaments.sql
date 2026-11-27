-- 052_tournaments.sql
-- PLAN-009 phase E: tournaments. A venue runs an event over one or more days on
-- some of its courts; players register teams (doubles: a captain and a partner who
-- joins by an invite link) into divisions and pay the entry fee online (Xendit, the
-- venue's company's account — invoice `team-<teamCode>`); staff generate the draw,
-- schedule matches on courts, enter scores, and winners move on by themselves.
--
-- tournaments              the event. publicToken is its link (/events/:publicToken).
--                          dailyStart / dailyEnd: the hours its courts are held each day
--                          (court_closures rows tied to it — booking can't take them).
--                          Draft → Open (registration) → Closed → Live → Finished; Cancelled.
-- tournament_courts        the courts it holds.
-- tournament_divisions     e.g. "Mixed Doubles 3.5": team size, levels, cap, fee, format.
--                          RoundRobin · SingleElimination · RoundRobinThenKnockout (groups of
--                          groupSize, the top advancePerGroup of each to a knockout).
-- tournament_teams         a registration. Pending until paid (or free) AND full; Registered
--                          then. teamCode is on the Xendit invoice; inviteToken lets the
--                          partner join (NULL once full). Staff may add a team with names only.
-- tournament_team_players  its players (playerId, or a name staff typed).
-- tournament_matches       one match: a group game (stage Group, groupNo) or a knockout game
--                          (round, slot; the winner goes to nextMatchId's nextSlot). teamA/B NULL
--                          = not decided yet. Bye = a team with no opponent (moves on at once).
-- court_closures.tournamentId  the courts' hold.
-- payments.tournamentTeamId    an entry fee paid online.

CREATE TABLE IF NOT EXISTS tournaments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tournamentId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  publicToken VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  startDate DATE NOT NULL,
  endDate DATE NOT NULL,
  dailyStart TIME NOT NULL,
  dailyEnd TIME NOT NULL,
  registrationClosesAt DATETIME NOT NULL,
  createdByAccountId VARCHAR(50) NULL,
  cancelReason VARCHAR(255) NULL,
  status ENUM('Draft','Open','Closed','Live','Finished','Cancelled','Deleted') NOT NULL DEFAULT 'Draft',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_tournaments_venue (venueId, status),
  INDEX idx_tournaments_dates (status, startDate),
  CONSTRAINT fk_tournaments_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_courts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tournamentId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  UNIQUE INDEX uq_tournament_courts (tournamentId, courtId),
  CONSTRAINT fk_tournament_courts_tournament FOREIGN KEY (tournamentId) REFERENCES tournaments(tournamentId),
  CONSTRAINT fk_tournament_courts_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_divisions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  divisionId VARCHAR(50) NOT NULL UNIQUE,
  tournamentId VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  teamSize TINYINT NOT NULL DEFAULT 2,
  minLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  maxLevel ENUM('Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced') NULL,
  capacity INT NOT NULL,
  entryFee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  format ENUM('RoundRobin','SingleElimination','RoundRobinThenKnockout') NOT NULL DEFAULT 'RoundRobin',
  groupSize TINYINT NULL,
  advancePerGroup TINYINT NULL,
  pointsToWin TINYINT NOT NULL DEFAULT 11,
  winBy TINYINT NOT NULL DEFAULT 2,
  drawGeneratedAt DATETIME NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_tournament_divisions_tournament (tournamentId, status),
  CONSTRAINT fk_tournament_divisions_tournament FOREIGN KEY (tournamentId) REFERENCES tournaments(tournamentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_teams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tournamentTeamId VARCHAR(50) NOT NULL UNIQUE,
  divisionId VARCHAR(50) NOT NULL,
  captainPlayerId VARCHAR(50) NULL,
  name VARCHAR(60) NOT NULL,
  teamCode VARCHAR(12) NOT NULL UNIQUE,
  inviteToken VARCHAR(64) NULL UNIQUE,
  email VARCHAR(255) NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  paymentStatus ENUM('Unpaid','Paid','Refunded','Free') NOT NULL DEFAULT 'Unpaid',
  holdExpiresAt DATETIME NULL,
  checkoutId VARCHAR(100) NULL,
  checkoutUrl VARCHAR(500) NULL,
  seed INT NULL,
  createdByAccountId VARCHAR(50) NULL,
  registeredAt DATETIME NULL,
  withdrawnAt DATETIME NULL,
  status ENUM('Pending','Registered','Withdrawn','Expired','Deleted') NOT NULL DEFAULT 'Pending',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_tournament_teams_division (divisionId, status),
  INDEX idx_tournament_teams_captain (captainPlayerId),
  INDEX idx_tournament_teams_checkoutId (checkoutId),
  INDEX idx_tournament_teams_status_hold (status, holdExpiresAt),
  CONSTRAINT fk_tournament_teams_division FOREIGN KEY (divisionId) REFERENCES tournament_divisions(divisionId),
  CONSTRAINT fk_tournament_teams_captain FOREIGN KEY (captainPlayerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_team_players (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tournamentTeamId VARCHAR(50) NOT NULL,
  playerId VARCHAR(50) NULL,
  playerName VARCHAR(100) NULL,
  role ENUM('Captain','Partner') NOT NULL DEFAULT 'Partner',
  joinedAt DATETIME NOT NULL,
  UNIQUE INDEX uq_tournament_team_players (tournamentTeamId, playerId),
  INDEX idx_tournament_team_players_player (playerId),
  CONSTRAINT fk_tournament_team_players_team FOREIGN KEY (tournamentTeamId) REFERENCES tournament_teams(tournamentTeamId),
  CONSTRAINT fk_tournament_team_players_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_matches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  matchId VARCHAR(50) NOT NULL UNIQUE,
  divisionId VARCHAR(50) NOT NULL,
  stage ENUM('Group','Knockout') NOT NULL,
  groupNo TINYINT NULL,
  round TINYINT NOT NULL,
  slot SMALLINT NOT NULL,
  teamAId VARCHAR(50) NULL,
  teamBId VARCHAR(50) NULL,
  nextMatchId VARCHAR(50) NULL,
  nextSlot ENUM('A','B') NULL,
  courtId VARCHAR(50) NULL,
  scheduledAt DATETIME NULL,
  calledAt DATETIME NULL,
  scoreA TINYINT UNSIGNED NULL,
  scoreB TINYINT UNSIGNED NULL,
  winnerTeamId VARCHAR(50) NULL,
  status ENUM('Pending','Ready','Playing','Done','Bye') NOT NULL DEFAULT 'Pending',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_tournament_matches_division (divisionId, stage, round, slot),
  INDEX idx_tournament_matches_court (courtId, scheduledAt),
  CONSTRAINT fk_tournament_matches_division FOREIGN KEY (divisionId) REFERENCES tournament_divisions(divisionId),
  CONSTRAINT fk_tournament_matches_team_a FOREIGN KEY (teamAId) REFERENCES tournament_teams(tournamentTeamId),
  CONSTRAINT fk_tournament_matches_team_b FOREIGN KEY (teamBId) REFERENCES tournament_teams(tournamentTeamId),
  CONSTRAINT fk_tournament_matches_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE court_closures
  ADD COLUMN tournamentId VARCHAR(50) NULL AFTER playSessionId,
  ADD INDEX idx_court_closures_tournament (tournamentId),
  ADD CONSTRAINT fk_court_closures_tournament FOREIGN KEY (tournamentId) REFERENCES tournaments(tournamentId);

ALTER TABLE payments
  ADD COLUMN tournamentTeamId VARCHAR(50) NULL AFTER playSignupId,
  ADD INDEX idx_payments_tournamentTeamId (tournamentTeamId),
  ADD CONSTRAINT fk_payments_tournament_team FOREIGN KEY (tournamentTeamId) REFERENCES tournament_teams(tournamentTeamId);

-- ── permission (idempotent; matches what setup-database.js seeds) ───────────
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'tournaments', NULL, 'Tournaments', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'tournaments' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'tournaments' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
