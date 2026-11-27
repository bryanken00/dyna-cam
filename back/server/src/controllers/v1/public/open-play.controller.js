import express from "express";
import { catchAsync, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { directionsUrl } from "../../../utils/maps.js";
import { venuePaysOnline } from "../../../utils/companyPayments.js";
import { venueKey } from "../../../utils/venueFacts.js";
import { firstName, LIVE_SIGNUP, sessionState } from "../../../utils/openPlay.js";
import { playTokenParamsSchema, publicPlaySessionsQuerySchema } from "../../../validators/open-play.validator.js";

/**
 * PLAN-009 phase C — Open Play for anyone, no login (mounted at /api/v1/public/open-play).
 *
 *   GET /?from&days&kind   upcoming sessions at every Active venue, soonest first
 *   GET /:playToken        one session: when, where, levels, fee, spots left, who's going
 *                          (first names and levels only)
 *
 * A session's link (playToken) names it; no business IDs, no surnames, emails or phones.
 * A paid session at a venue whose company can't take online payment isn't listed.
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

const COLUMNS = `s.playSessionId, s.playToken, s.kind, s.title, s.description, s.coachName, s.startAt, s.endAt,
  cb.publicToken AS clubToken, cb.name AS clubName,
  s.minLevel, s.maxLevel, s.capacity, s.pricePerHead, s.status, s.venueId,
  v.name AS venueName, v.address, v.logoUrl, v.latitude, v.longitude,
  (SELECT COUNT(*) FROM play_signups ps WHERE ps.playSessionId = s.playSessionId AND ${LIVE_SIGNUP}) AS spotsTaken,
  (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
   FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
   WHERE pc.playSessionId = s.playSessionId) AS courtNames,
  (SELECT COUNT(*) FROM play_session_courts pc WHERE pc.playSessionId = s.playSessionId) AS courtCount`;

const FROM = `FROM play_sessions s
  JOIN venues v ON v.venueId = s.venueId AND v.status = 'Active'
  JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
  LEFT JOIN clubs cb ON cb.clubId = s.clubId`;

const sessionView = (row, now) => {
  const taken = Number(row.spotsTaken);
  return {
    key: row.playToken,
    kind: row.kind,
    title: row.title,
    description: row.description,
    // PLAN-009 phase F: a clinic's coach; members of a club only
    coachName: row.coachName || null,
    club: row.clubToken ? { key: row.clubToken, name: row.clubName } : null,
    startAt: row.startAt,
    endAt: row.endAt,
    state: sessionState(row, now),
    minLevel: row.minLevel,
    maxLevel: row.maxLevel,
    capacity: row.capacity,
    spotsTaken: taken,
    spotsLeft: Math.max(0, row.capacity - taken),
    pricePerHead: Number(row.pricePerHead),
    courts: row.courtNames || "",
    courtCount: Number(row.courtCount),
    venue: {
      key: venueKey(row.venueId),
      name: row.venueName,
      address: row.address,
      logoUrl: signUploadUrl(row.logoUrl),
      directionsUrl: directionsUrl(row.latitude, row.longitude),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
    },
  };
};

/** Drop paid sessions at venues that can't take online payment (asked once per venue). */
const payable = async (db, rows) => {
  const paysOnline = new Map();
  const kept = [];
  for (const row of rows) {
    if (Number(row.pricePerHead) > 0) {
      if (!paysOnline.has(row.venueId)) paysOnline.set(row.venueId, await venuePaysOnline(db, row.venueId));
      if (!paysOnline.get(row.venueId)) continue;
    }
    kept.push(row);
  }
  return kept;
};

router.get(
  "/",
  validateQuery(publicPlaySessionsQuerySchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const from = req.query.from || now.slice(0, 10);
    const start = `${from} 00:00:00`;
    const end = moment.tz(start, "YYYY-MM-DD HH:mm:ss", TIMEZONE).add(req.query.days, "days").format("YYYY-MM-DD HH:mm:ss");
    const params = [now, now, start, end];
    let kind = "";
    if (req.query.kind) {
      kind = " AND s.kind = ?";
      params.push(req.query.kind);
    }
    const rows = await req.db.query(
      `SELECT ${COLUMNS} ${FROM}
       WHERE s.status = 'Scheduled' AND s.endAt > ? AND s.startAt >= ? AND s.startAt < ?${kind}
       ORDER BY s.startAt ASC, v.name ASC
       LIMIT 300`,
      params
    );
    const sessions = (await payable(req.db, rows)).map((r) => sessionView(r, now));
    return res.sendSuccess("Open Play", { from, days: req.query.days, sessions });
  })
);

router.get(
  "/:playToken",
  validateParams(playTokenParamsSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const rows = await req.db.query(
      `SELECT ${COLUMNS} ${FROM}
       WHERE s.playToken = ? AND s.status != 'Deleted' LIMIT 1`,
      [now, req.params.playToken]
    );
    if (!rows.length) return res.sendError("This session isn't available", 404);
    const session = rows[0];
    const going = await req.db.query(
      `SELECT COALESCE(p.name, ps.walkInName) AS name, sp.skillLevel
       FROM play_signups ps
       LEFT JOIN players p ON p.playerId = ps.playerId
       LEFT JOIN player_sports sp ON sp.playerId = ps.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
       WHERE ps.playSessionId = ? AND ps.status IN ('Confirmed', 'CheckedIn')
       ORDER BY ps.dateCreated ASC, ps.id ASC`,
      [session.playSessionId]
    );
    const payOnline = Number(session.pricePerHead) === 0 || (await venuePaysOnline(req.db, session.venueId));
    return res.sendSuccess("Session", {
      session: {
        ...sessionView(session, now),
        cancelled: session.status === "Cancelled",
        payOnline,
        players: going.map((g) => ({ firstName: firstName(g.name), level: g.skillLevel || null })),
      },
    });
  })
);

export default router;
