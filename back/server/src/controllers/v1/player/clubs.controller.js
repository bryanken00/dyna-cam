import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { requirePlayer } from "../../../middlewares/playerAuth.middleware.js";
import { clubTokenParamsSchema } from "../../../validators/clubs.validator.js";

/**
 * PLAN-009 phase F — a signed-in player's clubs (/api/v1/player/clubs).
 *
 *   GET  /                    my clubs (Active and asked-to-join)
 *   POST /:clubToken/join     an Open club: in at once; an Approval club: asked (Pending)
 *   POST /:clubToken/leave    out (Removed) — joining again brings the row back
 */
const router = express.Router();

const findClub = async (db, token) => {
  const [club] = await db.query(
    `SELECT c.clubId, c.name, c.joinPolicy FROM clubs c
     JOIN venues v ON v.venueId = c.venueId AND v.status = 'Active'
     JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     WHERE c.publicToken = ? AND c.status = 'Active' LIMIT 1`,
    [token]
  );
  return club || null;
};

router.get(
  "/",
  requirePlayer,
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT c.publicToken, c.name, c.joinPolicy, m.status, m.role, v.name AS venueName,
              (SELECT COUNT(*) FROM club_members x WHERE x.clubId = c.clubId AND x.status = 'Active') AS members
       FROM club_members m
       JOIN clubs c ON c.clubId = m.clubId AND c.status = 'Active'
       JOIN venues v ON v.venueId = c.venueId
       WHERE m.playerId = ? AND m.status IN ('Active', 'Pending')
       ORDER BY m.status = 'Active' DESC, c.name ASC`,
      [req.player.playerId]
    );
    return res.sendSuccess("Your clubs", {
      clubs: rows.map((r) => ({
        key: r.publicToken,
        name: r.name,
        venueName: r.venueName,
        members: Number(r.members),
        status: r.status,
        admin: r.role === "Admin",
      })),
    });
  })
);

router.post(
  "/:clubToken/join",
  requirePlayer,
  validateParams(clubTokenParamsSchema),
  catchAsync(async (req, res) => {
    if (!req.player.profileCompletedAt) {
      return res.sendError("Complete your profile first", null, 409, ERROR_CODES.PROFILE_INCOMPLETE);
    }
    const club = await findClub(req.db, req.params.clubToken);
    if (!club) return res.sendError("This club isn't available", 404);
    const now = getCurrentTimestampLocal();
    const status = club.joinPolicy === "Open" ? "Active" : "Pending";
    const [uuid] = await req.db.query(`SELECT UUID() AS id`);
    // Joining again (after leaving) brings the row back; an Active / Pending member stays as they are
    await req.db.query(
      `INSERT INTO club_members (clubMemberId, clubId, playerId, role, status, joinedAt, dateCreated, dateUpdated)
       VALUES (?, ?, ?, 'Member', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         -- MySQL applies these left to right: status (the old one is read above it) goes last
         role = IF(status = 'Removed', 'Member', role),
         joinedAt = IF(status = 'Removed' AND VALUES(status) = 'Active', VALUES(joinedAt), joinedAt),
         dateUpdated = VALUES(dateUpdated),
         status = IF(status = 'Removed', VALUES(status), status)`,
      [uuid.id, club.clubId, req.player.playerId, status, status === "Active" ? now : null, now, now]
    );
    const [row] = await req.db.query(`SELECT status FROM club_members WHERE clubId = ? AND playerId = ?`, [
      club.clubId,
      req.player.playerId,
    ]);
    return res.sendSuccess(row.status === "Active" ? `You're in ${club.name}` : "Asked to join — the club will approve you", {
      status: row.status,
    });
  })
);

router.post(
  "/:clubToken/leave",
  requirePlayer,
  validateParams(clubTokenParamsSchema),
  catchAsync(async (req, res) => {
    const club = await findClub(req.db, req.params.clubToken);
    if (!club) return res.sendError("This club isn't available", 404);
    await req.db.query(
      `UPDATE club_members SET status = 'Removed', dateUpdated = ? WHERE clubId = ? AND playerId = ? AND status != 'Removed'`,
      [getCurrentTimestampLocal(), club.clubId, req.player.playerId]
    );
    return res.sendSuccess("You left the club", { status: "Removed" });
  })
);

export default router;
