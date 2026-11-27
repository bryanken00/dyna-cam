import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import { openPlayUrl } from "../../../utils/clips.js";
import { runPaymentFollowUps } from "../../../utils/bookingPayments.js";
import {
  cancelPlaySession,
  cancelSignupRow,
  clubProblem,
  createPlaySession,
  insertSignup,
  joinProblem,
  LIVE_SIGNUP,
  liveSpots,
  lockSession,
  sessionState,
  updatePlaySession,
} from "../../../utils/openPlay.js";
import { sendPlayEmail } from "../../../utils/openPlayEmails.js";
import {
  endGame,
  fillCourts,
  loadQueue,
  lockGame,
  queueGame,
  queueView,
  swapPlayer,
  voidGame,
} from "../../../utils/openPlayGames.js";
import { runPlaySeries, seriesDays } from "../../../utils/playSeries.js";
import {
  addWalkInSchema,
  cancelPlaySessionSchema,
  createPlaySessionSchema,
  endPlayGameSchema,
  listPlaySeriesQuerySchema,
  listPlaySessionsQuerySchema,
  pauseQueueSchema,
  restSpotSchema,
  swapPlayGameSchema,
  updatePlaySessionSchema,
} from "../../../validators/open-play.validator.js";

/**
 * PLAN-009 phase C — Open Play in the Admin portal, mounted at /api/v1/admin/open-play.
 * Permission: open_play (GET = read, the rest = write); giving money back
 * (cancel a paid spot or a session with paid spots) also needs payments write.
 * Company-scoped: another company's session, spot or series is a 404.
 *
 *   GET  /options                                    venues, their courts and clubs (the form)
 *   GET  /sessions?venueId&when&kind&page&pageSize   the list, with spots taken
 *   GET  /sessions/:id                               one session, its courts and spots
 *   POST /sessions                                   one session, or { repeat } a weekly series
 *   PUT  /sessions/:id                               change a session that hasn't ended
 *   POST /sessions/:id/cancel                        cancel it (paid spots refunded)
 *   POST /sessions/:id/walk-ins                      add a walk-in (free)
 *   POST /signups/:id/check-in                       a player is here
 *   POST /signups/:id/cancel                         cancel an unpaid / free spot
 *   POST /signups/:id/cancel-refund                  cancel a paid spot and refund it
 *   GET  /sessions/:id/queue                         PLAN-009 phase D: the queue (courts, next, line)
 *   POST /sessions/:id/queue/fill                    every free court gets the next game
 *   POST /sessions/:id/queue/next                    line up one more game (not started)
 *   POST /sessions/:id/queue/pause                   { paused } — nothing starts on its own
 *   POST /games/:id/end                              { scoreA?, scoreB? } — then courts refill
 *   POST /games/:id/void                             call a game off (players keep their place)
 *   POST /games/:id/swap                             { outSignupId, inSignupId } in a Queued game
 *   POST /signups/:id/rest                           { resting } — sit out / come back
 *   GET  /series?venueId                             the weekly series
 *   POST /series/:id/stop                            no more sessions from it
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

/** { date, startTime, endTime } → the window ("24:00" = midnight, the next day's 00:00). */
const toWindow = ({ date, startTime, endTime }) => ({
  startAt: `${date} ${startTime}:00`,
  endAt:
    endTime === "24:00"
      ? `${moment.tz(date, "YYYY-MM-DD", TIMEZONE).add(1, "day").format("YYYY-MM-DD")} 00:00:00`
      : `${date} ${endTime}:00`,
});

const SESSION_COLUMNS = (now) => ({
  sql: `s.playSessionId, s.venueId, v.name AS venueName, s.seriesId, s.kind, s.title, s.description,
    s.startAt, s.endAt, s.minLevel, s.maxLevel, s.capacity, s.pricePerHead, s.status, s.playToken,
    s.coachName, s.clubId, (SELECT name FROM clubs cb WHERE cb.clubId = s.clubId) AS clubName,
    s.cancelReason, s.dateCreated, s.dateUpdated,
    (SELECT COUNT(*) FROM play_signups ps WHERE ps.playSessionId = s.playSessionId AND ${LIVE_SIGNUP}) AS spotsTaken,
    (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
     FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
     WHERE pc.playSessionId = s.playSessionId) AS courtNames`,
  params: [now],
});

const toSession = (row, now) => ({
  ...row,
  pricePerHead: Number(row.pricePerHead),
  spotsTaken: Number(row.spotsTaken),
  state: sessionState(row, now),
  shareUrl: openPlayUrl(row.playToken),
});

/** Spots as staff see them: the player's name (or the walk-in's) and level. */
const loadSpots = async (db, playSessionId) => {
  const rows = await db.query(
    `SELECT su.playSignupId, su.signupCode, su.playerId, su.walkInName, su.email, su.phone, su.price,
            su.paymentStatus, su.status, su.checkedInAt, su.cancelledAt, su.cancelledBy, su.holdExpiresAt,
            su.dateCreated, p.name AS playerName, sp.skillLevel,
            EXISTS (SELECT 1 FROM payments pay WHERE pay.playSignupId = su.playSignupId
                    AND pay.status = 'Paid' AND pay.refundError IS NOT NULL) AS refundFailed
     FROM play_signups su
     LEFT JOIN players p ON p.playerId = su.playerId
     LEFT JOIN player_sports sp ON sp.playerId = su.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
     WHERE su.playSessionId = ? AND su.status != 'Deleted'
     ORDER BY su.dateCreated ASC, su.id ASC`,
    [playSessionId]
  );
  return rows.map(({ playerName, walkInName, playerId, refundFailed, ...r }) => ({
    ...r,
    name: playerName || walkInName || "Player",
    walkIn: !playerId,
    price: Number(r.price),
    refundFailed: Boolean(refundFailed),
  }));
};

/** The session (any status but Deleted) if it's this company's, else null. */
const findSession = async (req, playSessionId) => {
  const now = getCurrentTimestampLocal();
  const cols = SESSION_COLUMNS(now);
  const rows = await req.db.query(
    `SELECT ${cols.sql} FROM play_sessions s
     JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted' AND v.companyId = ?
     WHERE s.playSessionId = ? AND s.status != 'Deleted' LIMIT 1`,
    [...cols.params, callerCompany(req), playSessionId]
  );
  return rows[0] ? toSession(rows[0], now) : null;
};

/** Lock this company's session in the transaction → the row, or null. */
const lockCompanySession = async (conn, req, playSessionId) => {
  const session = await lockSession(conn, { playSessionId });
  return session && session.companyId === callerCompany(req) ? session : null;
};

/** Lock this company's spot (its session row first) → { spot, session }, or null. */
const lockCompanySpot = async (conn, req, playSignupId) => {
  const [peek] = await conn.execute(`SELECT playSessionId FROM play_signups WHERE playSignupId = ? LIMIT 1`, [
    playSignupId,
  ]);
  if (!peek.length) return null;
  const session = await lockCompanySession(conn, req, peek[0].playSessionId);
  if (!session) return null;
  const [rows] = await conn.execute(
    `SELECT * FROM play_signups WHERE playSignupId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
    [playSignupId]
  );
  return rows[0] ? { spot: rows[0], session } : null;
};

const sessionFields = (body) => ({
  kind: body.kind,
  title: body.title,
  description: body.description,
  coachName: body.kind === "Clinic" ? body.coachName : null,
  clubId: body.clubId || null,
  ...toWindow(body),
  minLevel: body.minLevel,
  maxLevel: body.maxLevel,
  capacity: body.capacity,
  pricePerHead: body.pricePerHead,
});

/** After commit: send the refunds, close the checkouts, tell the players. */
const afterCancel = async (req, followUps, signupIds) => {
  for (const followUp of followUps) {
    await runPaymentFollowUps(req.db, followUp, { accountId: req.user.accountId, reason: "CANCELLATION" });
  }
  for (const id of signupIds) await sendPlayEmail(req.db, id, "Cancelled");
};

// ── options ─────────────────────────────────────────────────────────────────

/** GET /options — the company's venues and their courts in use, for the session form and filters. */
router.get(
  "/options",
  checkPermission("open_play", null, "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT v.venueId, v.name AS venueName, c.courtId, c.name AS courtName
       FROM venues v
       LEFT JOIN courts c ON c.venueId = v.venueId AND c.status = 'Active'
       WHERE v.companyId = ? AND v.status = 'Active'
       ORDER BY v.name ASC, c.name ASC`,
      [callerCompany(req)]
    );
    const venues = new Map();
    for (const r of rows) {
      if (!venues.has(r.venueId)) venues.set(r.venueId, { venueId: r.venueId, name: r.venueName, courts: [], clubs: [] });
      if (r.courtId) venues.get(r.venueId).courts.push({ courtId: r.courtId, name: r.courtName });
    }
    // PLAN-009 phase F: a session can be for one club's members
    const clubs = await req.db.query(
      `SELECT c.clubId, c.venueId, c.name FROM clubs c JOIN venues v ON v.venueId = c.venueId AND v.companyId = ?
       WHERE c.status = 'Active' ORDER BY c.name ASC`,
      [callerCompany(req)]
    );
    for (const c of clubs) venues.get(c.venueId)?.clubs.push({ clubId: c.clubId, name: c.name });
    return res.sendSuccess("Options", { venues: [...venues.values()] });
  })
);

// ── sessions ────────────────────────────────────────────────────────────────

router.get(
  "/sessions",
  checkPermission("open_play", null, "read"),
  validateQuery(listPlaySessionsQuerySchema),
  catchAsync(async (req, res) => {
    const { venueId, when, kind, page, pageSize } = req.query;
    const now = getCurrentTimestampLocal();
    let where = "WHERE s.status != 'Deleted'";
    const params = [];
    if (venueId) {
      where += " AND s.venueId = ?";
      params.push(venueId);
    }
    if (kind) {
      where += " AND s.kind = ?";
      params.push(kind);
    }
    if (when === "upcoming") {
      where += " AND s.endAt > ?";
      params.push(now);
    } else if (when === "past") {
      where += " AND s.endAt <= ?";
      params.push(now);
    }
    const from = `FROM play_sessions s
      JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted' AND v.companyId = ?`;
    const cols = SESSION_COLUMNS(now);
    const [count, rows] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total ${from} ${where}`, [callerCompany(req), ...params]),
      req.db.query(
        `SELECT ${cols.sql} ${from} ${where}
         ORDER BY s.startAt ${when === "upcoming" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
        [...cols.params, callerCompany(req), ...params, Number(pageSize), (page - 1) * pageSize]
      ),
    ]);
    const total = Number(count[0]?.total || 0);
    return res.sendSuccess("Sessions", {
      sessions: rows.map((r) => toSession(r, now)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  })
);

router.get(
  "/sessions/:playSessionId",
  checkPermission("open_play", null, "read"),
  catchAsync(async (req, res) => {
    const session = await findSession(req, req.params.playSessionId);
    if (!session) return res.sendError("Session not found", 404);
    const courts = await req.db.query(
      `SELECT c.courtId, c.name FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
       WHERE pc.playSessionId = ? ORDER BY c.name`,
      [session.playSessionId]
    );
    const signups = await loadSpots(req.db, session.playSessionId);
    return res.sendSuccess("Session", { session: { ...session, courts }, signups });
  })
);

router.post(
  "/sessions",
  checkPermission("open_play", null, "write"),
  validateBody(createPlaySessionSchema),
  catchAsync(async (req, res) => {
    const body = req.body;
    const now = getCurrentTimestampLocal();
    const companyId = callerCompany(req);
    let conn;
    let seriesId = null;
    let created = null;
    try {
      conn = await req.db.beginTransaction();
      const [venue] = await conn.execute(
        `SELECT venueId FROM venues WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [body.venueId, companyId]
      );
      if (!venue.length) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 400);
      }
      const badClub = await clubProblem(conn, body.clubId, body.venueId);
      if (badClub) {
        await req.db.rollback(conn);
        return res.sendError(badClub.message, badClub.status);
      }
      if (body.repeat) {
        // A weekly series: saved here, its sessions made right after commit
        const days = [...new Set(body.repeat.daysOfWeek)].sort();
        const [courts] = await conn.execute(
          `SELECT courtId FROM courts WHERE venueId = ? AND status = 'Active'
           AND courtId IN (${body.courtIds.map(() => "?").join(", ")})`,
          [body.venueId, ...body.courtIds]
        );
        if (courts.length !== new Set(body.courtIds).size) {
          await req.db.rollback(conn);
          return res.sendError("Pick courts of this venue that are in use", 400);
        }
        const [uuid] = await conn.execute(`SELECT UUID() AS id`);
        seriesId = uuid[0].id;
        const window = toWindow(body);
        await conn.execute(
          `INSERT INTO play_series
             (seriesId, venueId, clubId, kind, title, description, coachName, daysOfWeek, startTime, endTime,
              minLevel, maxLevel, capacity, pricePerHead, startsOn, endsOn, createdByAccountId, status,
              dateCreated, dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
          [
            seriesId,
            body.venueId,
            body.clubId || null,
            body.kind,
            body.title,
            body.description || null,
            body.kind === "Clinic" ? body.coachName || null : null,
            days.join(","),
            `${body.startTime}:00`,
            // TIME holds 24:00:00 (midnight at the end of the day)
            body.endTime === "24:00" ? "24:00:00" : window.endAt.slice(11),
            body.minLevel || null,
            body.maxLevel || null,
            body.capacity,
            body.pricePerHead,
            body.date,
            body.repeat.endsOn || null,
            req.user.accountId,
            now,
            now,
          ]
        );
        for (const c of courts) {
          await conn.execute(`INSERT INTO play_series_courts (seriesId, courtId) VALUES (?, ?)`, [
            seriesId,
            c.courtId,
          ]);
        }
      } else {
        created = await createPlaySession(conn, {
          venueId: body.venueId,
          fields: sessionFields(body),
          courtIds: body.courtIds,
          accountId: req.user.accountId,
          now,
        });
        if (!created.ok) {
          await req.db.rollback(conn);
          return res.sendError(created.message, created.status);
        }
      }
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (seriesId) {
      const { made } = await runPlaySeries(req.db, { seriesId, now });
      return res.sendSuccess(
        made ? `Weekly series saved — ${made} session${made === 1 ? "" : "s"} added` : "Weekly series saved",
        { seriesId, made },
        201
      );
    }
    return res.sendSuccess(
      "Session added",
      { playSessionId: created.playSessionId, shareUrl: openPlayUrl(created.playToken) },
      201
    );
  })
);

router.put(
  "/sessions/:playSessionId",
  checkPermission("open_play", null, "write"),
  validateBody(updatePlaySessionSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const session = await lockCompanySession(conn, req, req.params.playSessionId);
      if (!session) {
        await req.db.rollback(conn);
        return res.sendError("Session not found", 404);
      }
      const badClub = await clubProblem(conn, req.body.clubId, session.venueId);
      if (badClub) {
        await req.db.rollback(conn);
        return res.sendError(badClub.message, badClub.status);
      }
      const done = await updatePlaySession(conn, {
        session,
        fields: sessionFields(req.body),
        courtIds: req.body.courtIds,
        accountId: req.user.accountId,
        now,
      });
      if (!done.ok) {
        await req.db.rollback(conn);
        return res.sendError(done.message, done.status);
      }
      await req.db.commit(conn);
      return res.sendSuccess("Session updated");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

router.post(
  "/sessions/:playSessionId/cancel",
  checkPermission("open_play", null, "write"),
  // Paid spots are refunded — taking money back is a payments action
  checkPermission("payments", null, "write"),
  validateBody(cancelPlaySessionSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    let done;
    try {
      conn = await req.db.beginTransaction();
      const session = await lockCompanySession(conn, req, req.params.playSessionId);
      if (!session) {
        await req.db.rollback(conn);
        return res.sendError("Session not found", 404);
      }
      done = await cancelPlaySession(conn, { session, reason: req.body.reason || null, now });
      if (!done.ok) {
        await req.db.rollback(conn);
        return res.sendError(done.message, done.status);
      }
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    await afterCancel(req, done.followUps, done.signupIds);
    return res.sendSuccess("Session cancelled", { cancelledSpots: done.signupIds.length });
  })
);

router.post(
  "/sessions/:playSessionId/walk-ins",
  checkPermission("open_play", null, "write"),
  validateBody(addWalkInSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const session = await lockCompanySession(conn, req, req.params.playSessionId);
      if (!session) {
        await req.db.rollback(conn);
        return res.sendError("Session not found", 404);
      }
      const refusal = joinProblem(session, now);
      if (refusal) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.status);
      }
      if ((await liveSpots(conn, session.playSessionId, now)) >= session.capacity) {
        await req.db.rollback(conn);
        return res.sendError("This session is full", 409);
      }
      // CR-046: no cash at the counter — a walk-in staff add plays free
      const { playSignupId, signupCode } = await insertSignup(conn, {
        playSessionId: session.playSessionId,
        walkInName: req.body.name,
        phone: req.body.phone || null,
        price: 0,
        paymentStatus: "Free",
        status: "Confirmed",
        createdByAccountId: req.user.accountId,
        now,
      });
      await req.db.commit(conn);
      return res.sendSuccess("Walk-in added", { playSignupId, signupCode }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

// ── spots ───────────────────────────────────────────────────────────────────

router.post(
  "/signups/:playSignupId/check-in",
  checkPermission("open_play", null, "write"),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const found = await lockCompanySpot(conn, req, req.params.playSignupId);
      if (!found) {
        await req.db.rollback(conn);
        return res.sendError("Spot not found", 404);
      }
      const { spot, session } = found;
      if (session.status !== "Scheduled" || session.endAt <= now) {
        await req.db.rollback(conn);
        return res.sendError("This session isn't running", 409);
      }
      if (spot.status === "CheckedIn") {
        await req.db.rollback(conn);
        return res.sendSuccess("Already checked in");
      }
      if (spot.status !== "Confirmed") {
        await req.db.rollback(conn);
        return res.sendError(
          spot.status === "Pending" ? "This spot isn't paid yet" : "This spot isn't live",
          409
        );
      }
      await conn.execute(
        // PLAN-009 phase D: checked in = at the back of the queue
        `UPDATE play_signups SET status = 'CheckedIn', checkedInAt = ?, queueEnteredAt = ?, dateUpdated = ?
         WHERE playSignupId = ?`,
        [now, now, now, spot.playSignupId]
      );
      await req.db.commit(conn);
      return res.sendSuccess("Checked in");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/** Cancel one spot; `refund`: a paid spot is refunded (the route also needs payments write). */
const cancelSpot = (refund) =>
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    let followUp;
    let playSignupId;
    try {
      conn = await req.db.beginTransaction();
      const found = await lockCompanySpot(conn, req, req.params.playSignupId);
      if (!found) {
        await req.db.rollback(conn);
        return res.sendError("Spot not found", 404);
      }
      const { spot, session } = found;
      if (!["Pending", "Confirmed", "CheckedIn"].includes(spot.status)) {
        await req.db.rollback(conn);
        return res.sendError("This spot is already cancelled", 409);
      }
      if (spot.paymentStatus === "Paid" && !refund) {
        await req.db.rollback(conn);
        return res.sendError("This spot is paid — use Cancel and refund", 409);
      }
      playSignupId = spot.playSignupId;
      followUp = await cancelSignupRow(conn, { signup: spot, venueId: session.venueId, by: "Staff", now });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    await afterCancel(req, [followUp], [playSignupId]);
    return res.sendSuccess("Spot cancelled");
  });

router.post("/signups/:playSignupId/cancel", checkPermission("open_play", null, "write"), cancelSpot(false));
router.post(
  "/signups/:playSignupId/cancel-refund",
  checkPermission("open_play", null, "write"),
  checkPermission("payments", null, "write"),
  cancelSpot(true)
);

// ── PLAN-009 phase D: the queue ──────────────────────────────────────────────

/** Run one queue action on this company's session (locked), then answer with the queue. */
const queueAction = (action) =>
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      let session;
      let game = null;
      if (req.params.playGameId) {
        const [peek] = await conn.execute(`SELECT playSessionId FROM play_games WHERE playGameId = ? LIMIT 1`, [
          req.params.playGameId,
        ]);
        session = peek.length ? await lockCompanySession(conn, req, peek[0].playSessionId) : null;
        game = session ? await lockGame(conn, req.params.playGameId) : null;
        if (!game) {
          await req.db.rollback(conn);
          return res.sendError("Game not found", 404);
        }
      } else if (req.params.playSignupId) {
        const found = await lockCompanySpot(conn, req, req.params.playSignupId);
        if (!found) {
          await req.db.rollback(conn);
          return res.sendError("Spot not found", 404);
        }
        session = found.session;
        req.spot = found.spot;
      } else {
        session = await lockCompanySession(conn, req, req.params.playSessionId);
        if (!session) {
          await req.db.rollback(conn);
          return res.sendError("Session not found", 404);
        }
      }
      if (action.write !== false && (session.status !== "Scheduled" || session.endAt <= now)) {
        await req.db.rollback(conn);
        return res.sendError("This session isn't running", 409);
      }
      const done = await action(conn, { req, session, game, now });
      if (done && done.ok === false) {
        await req.db.rollback(conn);
        return res.sendError(done.message, done.status);
      }
      const fresh = await lockSession(conn, { playSessionId: session.playSessionId });
      const view = queueView(fresh, await loadQueue(conn, session.playSessionId));
      await req.db.commit(conn);
      return res.sendSuccess(done?.message || "Queue", { queue: view, ...(done?.extra || {}) });
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  });

const readQueue = Object.assign(() => null, { write: false });

router.get("/sessions/:playSessionId/queue", checkPermission("open_play", null, "read"), queueAction(readQueue));

router.post(
  "/sessions/:playSessionId/queue/fill",
  checkPermission("open_play", null, "write"),
  queueAction(async (conn, { req, session, now }) => {
    const started = await fillCourts(conn, { session, accountId: req.user.accountId, now });
    return { message: started ? `${started} game${started === 1 ? "" : "s"} started` : "No court or players free", extra: { started } };
  })
);

router.post(
  "/sessions/:playSessionId/queue/next",
  checkPermission("open_play", null, "write"),
  queueAction((conn, { req, session, now }) => queueGame(conn, { session, accountId: req.user.accountId, now }))
);

router.post(
  "/sessions/:playSessionId/queue/pause",
  checkPermission("open_play", null, "write"),
  validateBody(pauseQueueSchema),
  queueAction(async (conn, { req, session, now }) => {
    await conn.execute(`UPDATE play_sessions SET queuePaused = ?, dateUpdated = ? WHERE playSessionId = ?`, [
      req.body.paused ? 1 : 0,
      now,
      session.playSessionId,
    ]);
    if (!req.body.paused) await fillCourts(conn, { session: { ...session, queuePaused: 0 }, accountId: req.user.accountId, now });
    return { message: req.body.paused ? "Queue paused — games on court finish" : "Queue running" };
  })
);

router.post(
  "/games/:playGameId/end",
  checkPermission("open_play", null, "write"),
  validateBody(endPlayGameSchema),
  queueAction(async (conn, { req, session, game, now }) => {
    const done = await endGame(conn, { game, scoreA: req.body.scoreA ?? null, scoreB: req.body.scoreB ?? null, now });
    if (!done.ok) return done;
    await fillCourts(conn, { session, accountId: req.user.accountId, now });
    return { message: "Game over" };
  })
);

router.post(
  "/games/:playGameId/void",
  checkPermission("open_play", null, "write"),
  queueAction(async (conn, { req, session, game, now }) => {
    const done = await voidGame(conn, { game, now });
    if (!done.ok) return done;
    await fillCourts(conn, { session, accountId: req.user.accountId, now });
    return { message: "Game called off" };
  })
);

router.post(
  "/games/:playGameId/swap",
  checkPermission("open_play", null, "write"),
  validateBody(swapPlayGameSchema),
  queueAction((conn, { req, session, game, now }) =>
    swapPlayer(conn, { session, game, outId: req.body.outSignupId, inId: req.body.inSignupId, now })
  )
);

router.post(
  "/signups/:playSignupId/rest",
  checkPermission("open_play", null, "write"),
  validateBody(restSpotSchema),
  queueAction(async (conn, { req, now }) => {
    if (req.spot.status !== "CheckedIn") return { ok: false, status: 409, message: "Check them in first" };
    // Back from a rest = the back of the line
    await conn.execute(
      `UPDATE play_signups SET isResting = ?, queueEnteredAt = IF(?, queueEnteredAt, ?), dateUpdated = ?
       WHERE playSignupId = ?`,
      [req.body.resting ? 1 : 0, req.body.resting ? 1 : 0, now, now, req.spot.playSignupId]
    );
    return { message: req.body.resting ? "Resting" : "Back in line" };
  })
);

// ── series ──────────────────────────────────────────────────────────────────

router.get(
  "/series",
  checkPermission("open_play", null, "read"),
  validateQuery(listPlaySeriesQuerySchema),
  catchAsync(async (req, res) => {
    const params = [getCurrentTimestampLocal(), callerCompany(req)];
    let where = "WHERE ps.status != 'Deleted'";
    if (req.query.venueId) {
      where += " AND ps.venueId = ?";
      params.push(req.query.venueId);
    }
    const rows = await req.db.query(
      `SELECT ps.seriesId, ps.venueId, v.name AS venueName, ps.kind, ps.title, ps.daysOfWeek, ps.startTime,
              ps.endTime, ps.minLevel, ps.maxLevel, ps.capacity, ps.pricePerHead, ps.startsOn, ps.endsOn,
              ps.status, ps.dateCreated,
              (SELECT COUNT(*) FROM play_sessions s WHERE s.seriesId = ps.seriesId
                 AND s.status = 'Scheduled' AND s.endAt > ?) AS upcomingSessions,
              (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
               FROM play_series_courts sc JOIN courts c ON c.courtId = sc.courtId
               WHERE sc.seriesId = ps.seriesId) AS courtNames
       FROM play_series ps
       JOIN venues v ON v.venueId = ps.venueId AND v.status != 'Deleted' AND v.companyId = ?
       ${where}
       ORDER BY ps.status ASC, ps.dateCreated DESC`,
      params
    );
    return res.sendSuccess("Series", {
      series: rows.map((r) => ({
        ...r,
        daysOfWeek: seriesDays(r.daysOfWeek),
        startTime: String(r.startTime).slice(0, 5),
        endTime: String(r.endTime).slice(0, 5),
        pricePerHead: Number(r.pricePerHead),
        upcomingSessions: Number(r.upcomingSessions),
      })),
    });
  })
);

router.post(
  "/series/:seriesId/stop",
  checkPermission("open_play", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE play_series ps
       JOIN venues v ON v.venueId = ps.venueId AND v.companyId = ?
       SET ps.status = 'Stopped', ps.dateUpdated = ?
       WHERE ps.seriesId = ? AND ps.status = 'Active'`,
      [callerCompany(req), getCurrentTimestampLocal(), req.params.seriesId]
    );
    if (Number(result.affectedRows || 0) === 0) return res.sendError("Series not found", 404);
    return res.sendSuccess("Series stopped — the sessions already made stay");
  })
);

export default router;
