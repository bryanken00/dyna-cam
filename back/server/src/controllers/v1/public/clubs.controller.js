import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { venueKey } from "../../../utils/venueFacts.js";
import { firstName } from "../../../utils/openPlay.js";
import { clubTokenParamsSchema } from "../../../validators/clubs.validator.js";

/**
 * PLAN-009 phase F — clubs for anyone, no login (/api/v1/public/clubs).
 *
 *   GET /            every Active club at an Active venue, biggest first
 *   GET /:clubToken  one club: about it, members (first names and levels), its sessions coming up
 */
const router = express.Router();

const FROM = `FROM clubs c
  JOIN venues v ON v.venueId = c.venueId AND v.status = 'Active'
  JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'`;

const view = (r) => ({
  key: r.publicToken,
  name: r.name,
  description: r.description,
  joinPolicy: r.joinPolicy,
  members: Number(r.members),
  venue: { key: venueKey(r.venueId), name: r.venueName },
});

const COLUMNS = `c.clubId, c.publicToken, c.name, c.description, c.joinPolicy, c.venueId, v.name AS venueName,
  (SELECT COUNT(*) FROM club_members m WHERE m.clubId = c.clubId AND m.status = 'Active') AS members`;

router.get(
  "/",
  catchAsync(async (req, res) => {
    const rows = await req.db.query(`SELECT ${COLUMNS} ${FROM} WHERE c.status = 'Active' ORDER BY members DESC, c.name ASC LIMIT 200`);
    return res.sendSuccess("Clubs", { clubs: rows.map(view) });
  })
);

router.get(
  "/:clubToken",
  validateParams(clubTokenParamsSchema),
  catchAsync(async (req, res) => {
    const [club] = await req.db.query(`SELECT ${COLUMNS} ${FROM} WHERE c.publicToken = ? AND c.status = 'Active' LIMIT 1`, [
      req.params.clubToken,
    ]);
    if (!club) return res.sendError("This club isn't available", 404);
    const members = await req.db.query(
      `SELECT p.name, m.role, sp.skillLevel FROM club_members m
       JOIN players p ON p.playerId = m.playerId
       LEFT JOIN player_sports sp ON sp.playerId = m.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
       WHERE m.clubId = ? AND m.status = 'Active' ORDER BY m.role = 'Admin' DESC, m.joinedAt ASC LIMIT 200`,
      [club.clubId]
    );
    const now = getCurrentTimestampLocal();
    const sessions = await req.db.query(
      `SELECT s.playToken, s.kind, s.title, s.coachName, s.startAt, s.endAt, s.capacity, s.pricePerHead,
              (SELECT COUNT(*) FROM play_signups ps WHERE ps.playSessionId = s.playSessionId
                 AND (ps.status IN ('Confirmed', 'CheckedIn') OR (ps.status = 'Pending' AND ps.holdExpiresAt > ?))) AS taken
       FROM play_sessions s WHERE s.clubId = ? AND s.status = 'Scheduled' AND s.endAt > ?
       ORDER BY s.startAt ASC LIMIT 20`,
      [now, club.clubId, now]
    );
    return res.sendSuccess("Club", {
      club: {
        ...view(club),
        people: members.map((m) => ({ firstName: firstName(m.name), level: m.skillLevel || null, admin: m.role === "Admin" })),
        sessions: sessions.map((s) => ({
          key: s.playToken,
          kind: s.kind,
          title: s.title,
          coachName: s.coachName,
          startAt: s.startAt,
          endAt: s.endAt,
          spotsLeft: Math.max(0, s.capacity - Number(s.taken)),
          pricePerHead: Number(s.pricePerHead),
        })),
      },
    });
  })
);

export default router;
