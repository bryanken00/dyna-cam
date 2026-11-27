import express from "express";
import {
  catchAsync,
  validateBody,
  validateParams,
  validateQuery,
} from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { hashToken, randomPayCode } from "../../../utils/crypto/tokens.js";
import { bookingManageUrl, sessionShareUrl } from "../../../utils/clips.js";
import { checkInBooking } from "../../../utils/bookingCheckIn.js";
import { advanceSessions } from "../../../utils/sessions.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { directionsUrl } from "../../../utils/maps.js";
import { amenityList, venueKey } from "../../../utils/venueFacts.js";
import { venueFactsFor } from "../../../utils/playerProfile.js";
import { firstBookableDate, loadVenueHours } from "../../../utils/courtTimeline.js";
import { dayAvailability } from "../../../utils/bookingAvailability.js";
import {
  cancelBooking,
  createBooking,
  expireHolds,
  moveBooking,
  toStartLocal,
} from "../../../utils/bookings.js";
import { isPaymentSandbox } from "../../../lib/payments/xendit.js";
import { venuePaysOnline } from "../../../utils/companyPayments.js";
import { requirePlayer } from "../../../middlewares/playerAuth.middleware.js";
import { playerSignInConfigured } from "../../../utils/googleSignIn.js";
import {
  describeSlot,
  sendBookingEmail,
  sendCreatedEmail,
  sendOrderConfirmedEmail,
} from "../../../utils/bookingEmails.js";
import {
  MIN_CHECKOUT_SECONDS,
  openCheckout,
  openOrderCheckout,
  resumeCheckout,
  runPaymentFollowUps,
  settleInvoice,
} from "../../../utils/bookingPayments.js";
import {
  availabilityQuerySchema,
  bookingTokenParamsSchema,
  manageTokenParamsSchema,
  moveOptionsQuerySchema,
  playerMoveSchema,
  publicBookingSchema,
} from "../../../validators/public.validator.js";

/**
 * PLAN-003 Phase C — the player's booking pages, mounted at /api/v1/public with
 * NO login. A venue's online booking link (/book/:bookingToken) and a
 * booking's own link (/bookings/:manageToken) are the credentials. Replies
 * carry no business IDs: courts are named by a key derived from the link, and
 * availability never says who booked what.
 *
 *   GET  /venues                                 CR-030: every venue taking online bookings
 *   (CR-045 removed CR-030's POST /bookings/find: players find bookings in My games, PLAN-006)
 *   GET  /book/:bookingToken                     the venue, its courts and booking rules
 *   GET  /book/:bookingToken/availability        free hours per court for a date and length
 *   POST /book/:bookingToken/bookings            book a slot, paid online (CR-046: no pay at the desk);
 *                                                PLAN-006: only a player signed in with Google
 *   GET  /bookings/:manageToken                  one booking: status, code, what can be done now
 *   POST /bookings/:manageToken/pay              Phase F: the booking's Xendit checkout
 *   POST /bookings/:manageToken/check-in         Phase D: start the booked game
 *   POST /bookings/:manageToken/cancel           Phase H: cancel before the cut-off (full refund)
 *   GET  /bookings/:manageToken/move-options     Phase H: free times at the same or a lower price
 *   POST /bookings/:manageToken/move             Phase H: move it, once, before the cut-off
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

// Per IP: booking is a few-times-a-week thing; a few tries a minute covers a
// slot taken while the form was open
const createBookingLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_BOOK_POINTS || "5", 10),
  duration: 60,
  keyGenerator: (req) => `public-book:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/** A court's public key: stable while the venue keeps its link, says nothing about the court. */
const courtKey = (bookingToken, courtId) => hashToken(`${bookingToken}:${courtId}`).slice(0, 16);

/** Phase H: a court's key on a booking's own page (the venue's link may be off or replaced). */
const moveCourtKey = (manageToken, courtId) =>
  hashToken(`move:${manageToken}:${courtId}`).slice(0, 16);

/**
 * The venue an online booking link belongs to (Active, online booking on), or null.
 * PLAN-008: a suspended company's venues take no online bookings — their link is a 404.
 */
const findVenue = async (db, bookingToken) => {
  const rows = await db.query(
    `SELECT v.venueId, v.name, v.address, v.latitude, v.longitude, v.phone, v.logoUrl,
            v.deskHoldMinutes, v.onlineHoldMinutes, v.cancelCutoffHours, v.checkInEarlyMinutes
     FROM venues v
     INNER JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     WHERE v.bookingToken = ? AND v.status = 'Active'
     LIMIT 1`,
    [bookingToken]
  );
  return rows[0] || null;
};

const activeCourts = (db, venueId) =>
  db.query(
    `SELECT courtId, name FROM courts WHERE venueId = ? AND status = 'Active' ORDER BY name ASC`,
    [venueId]
  );


/**
 * Why a date can't be booked, or null. CR-047: no longest booking — a game can
 * run as long as the venue is open (findConflict refuses hours it's closed).
 */
const dateProblem = (date, today) => {
  // CR-048: no booking window — any day from today on (CR-049: or last night's, while
  // its hours past midnight still run)
  if (date < today) return "That date has passed";
  return null;
};

const venueView = (venue) => ({
  name: venue.name,
  address: venue.address,
  phone: venue.phone,
  logoUrl: signUploadUrl(venue.logoUrl),
  // CR-050: Google Maps directions to the venue's pin (null: no pin)
  directionsUrl: directionsUrl(venue.latitude, venue.longitude),
});

/** "06:00:00" → "06:00"; "24:00:00" stays "24:00" (midnight). */
const hhmm = (time) => (time ? String(time).slice(0, 5) : null);

/**
 * GET /venues
 * CR-030: the public "Book a court" list — every Active venue with online
 * booking on (it has a booking link) and at least one Active court, with
 * today's hours. The link is what the venue already shares; no business IDs.
 */
router.get(
  "/venues",
  catchAsync(async (req, res) => {
    const today = moment().tz(TIMEZONE).day();
    const rows = await req.db.query(
      `SELECT v.venueId, v.name, v.address, v.latitude, v.longitude, v.phone, v.logoUrl, v.bookingToken,
              v.amenities, h.opensAt, h.closesAt,
              (SELECT COUNT(*) FROM courts c
               WHERE c.venueId = v.venueId AND c.status = 'Active') AS courtCount
       FROM venues v
       -- PLAN-008: every Active company's venues (a suspended company's drop out)
       INNER JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
       LEFT JOIN venue_hours h
         ON h.venueId = v.venueId AND h.status = 'Active' AND h.dayOfWeek = ?
       WHERE v.status = 'Active' AND v.bookingToken IS NOT NULL
       HAVING courtCount > 0
       ORDER BY v.name ASC`,
      [today]
    );
    // PLAN-008: only venues whose company takes online payment (its own Xendit) — booking is pay-first
    const paying = [];
    for (const v of rows) {
      if (await venuePaysOnline(req.db, v.venueId)) paying.push(v);
    }
    // PLAN-009 phase B: what each venue's courts are like, and its followers (Discover's filters)
    const facts = await venueFactsFor(req.db, paying.map((v) => v.venueId));
    return res.sendSuccess("Venues", {
      venues: paying.map((v) => ({
        ...venueView(v),
        // The venue's public key (follow / Book again) — never its business ID
        key: venueKey(v.venueId),
        bookingToken: v.bookingToken,
        amenities: amenityList(v.amenities),
        ...facts.get(v.venueId),
        courtCount: Number(v.courtCount),
        // CR-050: the venue's public pin (null: none) — the page sorts by distance from the
        // player in the browser ("Near me"); the player's location never reaches the API
        latitude: v.latitude === null ? null : Number(v.latitude),
        longitude: v.longitude === null ? null : Number(v.longitude),
        // null: closed today
        todayHours: v.opensAt ? { opensAt: hhmm(v.opensAt), closesAt: hhmm(v.closesAt) } : null,
      })),
      // PLAN-006: booking online needs a Google sign-in; off on this server → nobody books online
      signInAvailable: playerSignInConfigured(),
    });
  })
);


/**
 * GET /book/:bookingToken
 * The booking page's frame: the venue, its courts, which weekdays it opens,
 * the dates and lengths a player can pick, and the rules shown before booking.
 */
router.get(
  "/book/:bookingToken",
  validateParams(bookingTokenParamsSchema),
  catchAsync(async (req, res) => {
    const venue = await findVenue(req.db, req.params.bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const [courts, hours] = await Promise.all([
      activeCourts(req.db, venue.venueId),
      loadVenueHours(req.db, venue.venueId),
    ]);
    const today = firstBookableDate(hours);

    return res.sendSuccess("Booking page", {
      venue: venueView(venue),
      courts: courts.map((c) => ({
        key: courtKey(req.params.bookingToken, c.courtId),
        name: c.name,
      })),
      openDays: [...hours.keys()].sort((a, b) => a - b),
      today,
      rules: {
        deskHoldMinutes: venue.deskHoldMinutes,
        onlineHoldMinutes: venue.onlineHoldMinutes,
        cancelCutoffHours: venue.cancelCutoffHours,
        checkInEarlyMinutes: venue.checkInEarlyMinutes,
      },
      // Phase F / PLAN-008: the venue's company's Xendit is connected
      payOnline: await venuePaysOnline(req.db, venue.venueId),
      // CR-033: online payment is the built-in test checkout, not Xendit
      paymentSandbox: isPaymentSandbox(),
      // PLAN-006: booking here needs a Google sign-in; off on this server → no online booking
      signInRequired: true,
      signInAvailable: playerSignInConfigured(),
    });
  })
);

/**
 * GET /book/:bookingToken/availability?date=&durationMinutes=
 * Each court's start times that day for that length: free (with its price) or not.
 */
router.get(
  "/book/:bookingToken/availability",
  validateParams(bookingTokenParamsSchema),
  validateQuery(availabilityQuerySchema),
  catchAsync(async (req, res) => {
    const venue = await findVenue(req.db, req.params.bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const { date, durationMinutes } = req.query;
    const problem = dateProblem(date, firstBookableDate(await loadVenueHours(req.db, venue.venueId)));
    if (problem) {
      return res.sendError(problem, 400);
    }

    await expireHolds(req.db, { venueId: venue.venueId });
    const courts = await activeCourts(req.db, venue.venueId);
    const day = await dayAvailability(req.db, {
      venueId: venue.venueId,
      courts,
      date,
      durationMinutes,
      // CR-047: the hour that's running is bookable in its first half
      allowRunning: true,
    });

    return res.sendSuccess("Availability", {
      date,
      durationMinutes,
      hours: day.hours,
      courts: day.courts.map((c) => ({
        key: courtKey(req.params.bookingToken, c.courtId),
        name: c.name,
        slots: c.slots,
      })),
    });
  })
);

/**
 * POST /book/:bookingToken/bookings
 * Authorization: Player <token> (PLAN-006 — 401 PLAYER_SIGN_IN_REQUIRED without one)
 * Body: { courtKey, date, startTime, durationMinutes, phone?, payMethod }
 * The name and email are the signed-in player's (profile and Google); the
 * phone is the one given, else their profile's. A player who hasn't completed
 * their profile yet (first sign-in) gets 409 PROFILE_INCOMPLETE. The booking
 * is theirs (playerId).
 * Pay at the desk: the slot is held until deskHoldMinutes before the start.
 * 201 { bookingCode, manageToken, manageUrl } — the player's own booking page.
 */
router.post(
  "/book/:bookingToken/bookings",
  createBookingLimiter,
  requirePlayer,
  validateParams(bookingTokenParamsSchema),
  validateBody(publicBookingSchema),
  catchAsync(async (req, res) => {
    const { bookingToken } = req.params;
    const venue = await findVenue(req.db, bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    if (!req.player.profileCompletedAt) {
      return res.sendError(
        "Complete your profile before booking",
        null,
        409,
        ERROR_CODES.PROFILE_INCOMPLETE
      );
    }
    const { date } = req.body;
    const { playerId, name: playerName, email } = req.player;
    const phone = req.body.phone || req.player.phone;
    // CR-046: pay first to reserve — no pay at the counter (PLAN-008: the company's own Xendit)
    if (!(await venuePaysOnline(req.db, venue.venueId))) {
      return res.sendError(
        "Online payment isn't available right now, so the court can't be booked online — please call the venue",
        409
      );
    }

    // CR-047: the hours picked → one booking per run of neighbouring hours on a court
    const runs = req.body.slots
      ? joinPickedHours(req.body.slots)
      : [{ courtKey: req.body.courtKey, startTime: req.body.startTime, durationMinutes: req.body.durationMinutes }];
    const courts = await activeCourts(req.db, venue.venueId);
    const today = firstBookableDate(await loadVenueHours(req.db, venue.venueId));
    const planned = [];
    for (const run of runs) {
      const court = courts.find((c) => courtKey(bookingToken, c.courtId) === run.courtKey);
      if (!court) {
        return res.sendError("That court isn't taking bookings — reload the page and pick again", 400);
      }
      const problem = dateProblem(date, today);
      if (problem) {
        return res.sendError(runs.length > 1 ? `${court.name} at ${hourLabel(run.startTime)}: ${problem}` : problem, 400);
      }
      planned.push({ ...run, court });
    }
    // Courts in a fixed order (then by time), so two orders can't deadlock
    planned.sort((a, b) =>
      a.court.courtId === b.court.courtId
        ? a.startTime.localeCompare(b.startTime)
        : a.court.courtId.localeCompare(b.court.courtId)
    );

    let conn;
    const made = [];
    let orderId = null;
    let refused = null;
    try {
      conn = await req.db.beginTransaction();
      if (planned.length > 1) orderId = await createOrder(conn, { venueId: venue.venueId, playerId });
      for (const run of planned) {
        const result = await createBooking(conn, {
          courtId: run.court.courtId,
          startLocal: toStartLocal(date, run.startTime),
          durationMinutes: run.durationMinutes,
          playerName,
          phone,
          email,
          payment: "Online",
          source: "Online",
          playerId,
          orderId,
        });
        if (!result.ok) {
          refused = {
            status: result.status,
            message:
              planned.length > 1
                ? `${run.court.name} at ${hourLabel(run.startTime)}: ${result.message}`
                : result.message,
          };
          break;
        }
        made.push(result);
      }
      if (refused) {
        await req.db.rollback(conn);
      } else {
        if (orderId) await finishOrder(conn, { orderId, made });
        await req.db.commit(conn);
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    if (refused) return res.sendError(refused.message, refused.status);

    // In time order for the player (the first one's page is where they come back to)
    made.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.courtName.localeCompare(b.courtName));
    const first = made[0];
    const reply = {
      bookingCode: first.bookingCode,
      manageToken: first.manageToken,
      manageUrl: bookingManageUrl(first.manageToken),
      checkoutUrl: null,
      bookings: made.map((b) => ({
        bookingCode: b.bookingCode,
        manageUrl: bookingManageUrl(b.manageToken),
        courtName: b.courtName,
        startAt: b.startAt,
        endAt: b.endAt,
        price: Number(b.price),
      })),
      total: made.reduce((sum, b) => sum + Number(b.price), 0),
    };

    // Phase F: the slots are held; now open the Xendit checkout (outside the
    // transaction — it's a call to Xendit). If that fails, every hold is let go.
    const pending = made.filter((b) => b.status === "Pending");
    if (pending.length > 0) {
      const checkout = orderId
        ? await openOrderCheckout(req.db, { orderId })
        : await openCheckout(req.db, { bookingId: first.bookingId });
      if (!checkout.ok) {
        for (const b of pending) await releaseHold(req.db, b.bookingId);
        return res.sendError(checkout.message, checkout.status);
      }
      reply.checkoutUrl = checkout.checkoutUrl;
      return res.sendSuccess("Booked — pay now to confirm it", reply, 201);
    }
    // Phase G: free (nothing to pay) → the confirmation (CR-047: one email for an order)
    if (orderId) await sendOrderConfirmedEmail(req.db, made.map((b) => b.bookingId));
    else await sendCreatedEmail(req.db, first);
    return res.sendSuccess("Booked — you're all set", reply, 201);
  })
);

/** "18:00" → "6 PM"; CR-049: "25:00" (past midnight) → "1 AM". */
const hourLabel = (startTime) =>
  moment("2000-01-01", "YYYY-MM-DD").add(Number(startTime.slice(0, 2)), "hours").format("h A");

/**
 * CR-047: picked hours → runs: per court, neighbouring hours joined into one
 * booking (10:00 + 11:00 → 10:00 for 2 h); a gap starts another.
 * @param {Array<{ courtKey, startTime }>} slots
 * @returns {Array<{ courtKey, startTime, durationMinutes }>}
 */
const joinPickedHours = (slots) => {
  const byCourt = new Map();
  for (const slot of slots) {
    if (!byCourt.has(slot.courtKey)) byCourt.set(slot.courtKey, new Set());
    byCourt.get(slot.courtKey).add(slot.startTime);
  }
  const runs = [];
  for (const [key, times] of byCourt) {
    let run = null;
    for (const time of [...times].sort()) {
      const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      if (run && minute === run.endMinute) {
        run.endMinute += 60;
      } else {
        run = { courtKey: key, startTime: time, startMinute: minute, endMinute: minute + 60 };
        runs.push(run);
      }
    }
  }
  return runs.map((r) => ({
    courtKey: r.courtKey,
    startTime: r.startTime,
    durationMinutes: r.endMinute - r.startMinute,
  }));
};

/** CR-047: a new order (inside the transaction) → its orderId. */
const createOrder = async (conn, { venueId, playerId }) => {
  const now = getCurrentTimestampLocal();
  const [uuidRow] = await conn.execute(`SELECT UUID() AS id`);
  const orderId = uuidRow[0].id;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await conn.execute(
        `INSERT INTO booking_orders (orderId, orderCode, venueId, playerId, amount, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 0, 'Active', ?, ?)`,
        [orderId, randomPayCode(), venueId, playerId, now, now]
      );
      return orderId;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }
};

/**
 * CR-047: the order's total, and one hold for all its unpaid bookings (the
 * earliest of theirs) so they're paid — or released — together.
 */
const finishOrder = async (conn, { orderId, made }) => {
  const now = getCurrentTimestampLocal();
  const amount = made.reduce((sum, b) => sum + Number(b.price), 0);
  await conn.execute(`UPDATE booking_orders SET amount = ?, dateUpdated = ? WHERE orderId = ?`, [
    amount,
    now,
    orderId,
  ]);
  const holds = made.filter((b) => b.status === "Pending" && b.holdExpiresAt).map((b) => b.holdExpiresAt);
  if (holds.length > 1) {
    const earliest = holds.reduce((min, h) => (h < min ? h : min));
    await conn.execute(
      `UPDATE bookings SET holdExpiresAt = ? WHERE orderId = ? AND status = 'Pending'`,
      [earliest, orderId]
    );
  }
};

/** A held booking whose checkout couldn't be opened gives its slot back. */
const releaseHold = async (db, bookingId) => {
  let conn;
  try {
    conn = await db.beginTransaction();
    const cancelled = await cancelBooking(conn, {
      bookingId,
      by: "System",
      reason: "Online payment could not be started",
      refund: false,
    });
    if (cancelled.ok) await db.commit(conn);
    else await db.rollback(conn);
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

// The player's page polls while a checkout is open; Xendit is asked at most
// this often per booking, so a webhook that's late (or can't reach a
// development machine) doesn't leave a paid booking looking unpaid
const CHECKOUT_SYNC_MS = 15 * 1000;
const lastCheckoutSync = new Map();

/** Settle a paid checkout the webhook hasn't reported yet. Never throws. */
const syncCheckout = async (db, checkoutId) => {
  const last = lastCheckoutSync.get(checkoutId) || 0;
  if (Date.now() - last < CHECKOUT_SYNC_MS) return false;
  lastCheckoutSync.set(checkoutId, Date.now());
  if (lastCheckoutSync.size > 5000) {
    for (const [id, at] of lastCheckoutSync) {
      if (Date.now() - at > CHECKOUT_SYNC_MS) lastCheckoutSync.delete(id);
    }
  }
  try {
    const settled = await settleInvoice(db, checkoutId);
    return settled.outcome === "CONFIRMED";
  } catch {
    return false;
  }
};

const BOOKING_PAGE_SELECT = `SELECT b.bookingId, b.bookingCode, b.startAt, b.endAt, b.playerName,
              b.email, b.price, b.paymentStatus, b.payMethod, b.holdExpiresAt, b.checkoutId,
              b.status, b.cancelledAt, b.cancelledBy, b.rescheduledCount, b.venueId, b.courtId,
              c.name AS courtName, v.name, v.address, v.latitude, v.longitude, v.phone, v.logoUrl, v.cancelCutoffHours,
              v.checkInEarlyMinutes,
              s.shareToken AS gameShareToken,
              EXISTS (SELECT 1 FROM payments p
                      WHERE p.bookingId = b.bookingId AND p.status = 'Paid' AND p.method = 'CASH')
                AS paidCash
       FROM bookings b
       JOIN courts c ON c.courtId = b.courtId
       JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
       LEFT JOIN recording_sessions s ON s.sessionId = b.sessionId
       WHERE b.manageToken = ? AND b.status != 'Deleted'
       LIMIT 1`;

/** Can the player pay this booking online now? (`payOnline`: its company's Xendit is connected) */
const canPayOnline = (b, now, payOnline) =>
  payOnline &&
  b.status === "Pending" &&
  b.paymentStatus === "Unpaid" &&
  Boolean(b.holdExpiresAt) &&
  moment.tz(b.holdExpiresAt, FORMAT, TIMEZONE).diff(moment.tz(now, FORMAT, TIMEZONE), "seconds") >=
    MIN_CHECKOUT_SECONDS;

/**
 * Phase H: what the player may change themselves, and why not. Only an
 * unplayed booking, before the venue's cut-off; a cash payment is given back
 * at the desk, so that one is cancelled there; a booking moves once.
 */
const playerChanges = (b, now) => {
  const cutoffAt = moment
    .tz(b.startAt, FORMAT, TIMEZONE)
    .subtract(b.cancelCutoffHours, "hours")
    .format(FORMAT);
  const open = ["Pending", "Confirmed"].includes(b.status);
  const beforeCutoff = now < cutoffAt;
  return {
    cutoffAt,
    cutoffPassed: open && !beforeCutoff,
    paidAtDesk: Number(b.paidCash) === 1,
    movedOnce: Number(b.rescheduledCount) > 0,
    cancel: open && beforeCutoff && Number(b.paidCash) !== 1,
    move: open && beforeCutoff && Number(b.rescheduledCount) === 0,
  };
};

/**
 * GET /bookings/:manageToken
 * The player's booking: where and when, its price and payment, its status, and
 * what they can do now (pay online, check in, cancel, move).
 */
router.get(
  "/bookings/:manageToken",
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    await expireHolds(req.db);
    let rows = await req.db.query(BOOKING_PAGE_SELECT, [req.params.manageToken]);
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    // Phase F: back from the checkout, before the webhook — ask Xendit
    if (
      rows[0].status === "Pending" &&
      rows[0].checkoutId &&
      (await venuePaysOnline(req.db, rows[0].venueId)) &&
      (await syncCheckout(req.db, rows[0].checkoutId))
    ) {
      rows = await req.db.query(BOOKING_PAGE_SELECT, [req.params.manageToken]);
    }
    const b = rows[0];
    const start = moment.tz(b.startAt, FORMAT, TIMEZONE);
    const now = getCurrentTimestampLocal();
    const checkInFrom = start.clone().subtract(b.checkInEarlyMinutes, "minutes").format(FORMAT);
    const changes = playerChanges(b, now);

    return res.sendSuccess("Booking", {
      booking: {
        bookingCode: b.bookingCode,
        status: b.status,
        venue: venueView(b),
        courtName: b.courtName,
        startAt: b.startAt,
        endAt: b.endAt,
        durationMinutes: moment.tz(b.endAt, FORMAT, TIMEZONE).diff(start, "minutes"),
        playerName: b.playerName,
        email: b.email,
        price: Number(b.price),
        paymentStatus: b.paymentStatus,
        payMethod: b.payMethod,
        // Pay by then (online — CR-046), or the slot is released
        payBy: b.status === "Pending" ? b.holdExpiresAt : null,
        // Phase F: a checkout is open — the page polls until the payment lands
        checkoutOpen: b.status === "Pending" && Boolean(b.checkoutId),
        cancelledAt: b.cancelledAt,
        cancelledBy: b.cancelledBy,
        cancelCutoffAt: changes.cutoffAt,
        // Phase H: why Cancel / Move may be missing — past the cut-off, paid in cash, moved once
        cutoffPassed: changes.cutoffPassed,
        paidAtDesk: changes.paidAtDesk,
        movedOnce: changes.movedOnce,
        checkInFrom,
        hasEnded: b.endAt <= now,
        // Phase D: the game's page once checked in
        gameUrl: b.gameShareToken ? sessionShareUrl(b.gameShareToken) : null,
        gameShareToken: b.gameShareToken || null,
        // CR-033: online payment is the built-in test checkout, not Xendit
        paymentSandbox: isPaymentSandbox(),
        actions: {
          checkIn: b.status === "Confirmed" && now >= checkInFrom && now < b.endAt,
          payOnline: canPayOnline(b, now, await venuePaysOnline(req.db, b.venueId)),
          cancel: changes.cancel,
          move: changes.move,
        },
      },
    });
  })
);

// Per IP: cancelling or moving is rare; a few taps a minute covers retries
const changeLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CHANGE_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-booking-change:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/** The booking behind a manage link (with what playerChanges() needs), or null. */
const findManagedBooking = async (db, manageToken) => {
  await expireHolds(db);
  const rows = await db.query(BOOKING_PAGE_SELECT, [manageToken]);
  return rows[0] || null;
};

/** Why the player can't change it now, in their words — or null. */
const changeRefusal = (b, changes, what) => {
  if (!["Pending", "Confirmed"].includes(b.status)) {
    return b.status === "CheckedIn" || b.status === "Completed"
      ? "This booking has been played"
      : `This booking is ${b.status === "NoShow" ? "a no-show" : b.status.toLowerCase()} — it can't be changed`;
  }
  if (changes.cutoffPassed)
    return `It's too close to the start to ${what} it online — call the venue`;
  if (what === "cancel" && changes.paidAtDesk) {
    return "It was paid at the desk — call the venue to cancel it and get your money back";
  }
  if (what === "move" && changes.movedOnce) {
    return "You've already moved this booking once — call the venue to change it again";
  }
  return null;
};

/** Run one utils/bookings.js write in a transaction. */
const inTransaction = async (db, write) => {
  let conn;
  try {
    conn = await db.beginTransaction();
    const result = await write(conn);
    if (result.ok) await db.commit(conn);
    else await db.rollback(conn);
    return result;
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

/**
 * POST /bookings/:manageToken/cancel
 * Phase H: the player cancels before the venue's cut-off — a full refund of
 * an online payment (Xendit), an open checkout closed. After the cut-off, or
 * when it was paid in cash at the desk, 409 "call the venue".
 */
router.post(
  "/bookings/:manageToken/cancel",
  changeLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    const b = await findManagedBooking(req.db, req.params.manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "cancel");
    if (refusal) {
      return res.sendError(refusal, 409);
    }

    const result = await inTransaction(req.db, (conn) =>
      cancelBooking(conn, {
        bookingId: b.bookingId,
        by: "Player",
        reason: "Cancelled by the player",
        refund: true,
        asPlayer: true,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    const online = await runPaymentFollowUps(req.db, result.followUp, {
      reason: "REQUESTED_BY_CUSTOMER",
    });
    await sendBookingEmail(req.db, b.bookingId, "Cancelled");

    let message = "Booking cancelled";
    if (online.refunded > 0) {
      message = `Booking cancelled — ₱${online.refunded.toLocaleString("en-PH")} is on its way back to you`;
    } else if (online.failed > 0) {
      message =
        "Booking cancelled — the refund didn't go through, so the venue will contact you about it";
    }
    return res.sendSuccess(message, { refunded: online.refunded, refundFailed: online.failed });
  })
);

/**
 * GET /bookings/:manageToken/move-options?date=
 * Phase H: the times the player can move to that day — same length, free, and
 * at the same or a lower price than they booked. Its own time doesn't count as
 * taken (it's marked `current`). Courts are named by a key of this booking.
 */
router.get(
  "/bookings/:manageToken/move-options",
  validateParams(manageTokenParamsSchema),
  validateQuery(moveOptionsQuerySchema),
  catchAsync(async (req, res) => {
    const { manageToken } = req.params;
    const b = await findManagedBooking(req.db, manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "move");
    if (refusal) {
      return res.sendError(refusal, 409);
    }
    const { date } = req.query;
    const durationMinutes = moment
      .tz(b.endAt, FORMAT, TIMEZONE)
      .diff(moment.tz(b.startAt, FORMAT, TIMEZONE), "minutes");
    const [courts, hours] = await Promise.all([
      activeCourts(req.db, b.venueId),
      loadVenueHours(req.db, b.venueId),
    ]);
    const today = firstBookableDate(hours);
    if (date < today) {
      return res.sendError("That date has passed", 400);
    }
    const day = await dayAvailability(req.db, {
      venueId: b.venueId,
      courts,
      date,
      durationMinutes,
      moving: {
        bookingId: b.bookingId,
        courtId: b.courtId,
        startAt: b.startAt,
        maxPrice: Number(b.price),
      },
    });

    return res.sendSuccess("Move options", {
      date,
      today,
      openDays: [...hours.keys()].sort((x, y) => x - y),
      durationMinutes,
      maxPrice: Number(b.price),
      hours: day.hours,
      courts: day.courts.map((c) => ({
        key: moveCourtKey(manageToken, c.courtId),
        name: c.name,
        slots: c.slots,
      })),
    });
  })
);

/**
 * POST /bookings/:manageToken/move
 * Body: { courtKey?, date, startTime }. Phase H: once, before the cut-off,
 * same length, to a free time that costs the same or less — the booking keeps
 * its price (no partial refunds). Locks, checks and moves in one transaction.
 */
router.post(
  "/bookings/:manageToken/move",
  changeLimiter,
  validateParams(manageTokenParamsSchema),
  validateBody(playerMoveSchema),
  catchAsync(async (req, res) => {
    const { manageToken } = req.params;
    const b = await findManagedBooking(req.db, manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "move");
    if (refusal) {
      return res.sendError(refusal, 409);
    }

    let courtId = b.courtId;
    if (req.body.courtKey) {
      const courts = await activeCourts(req.db, b.venueId);
      const court = courts.find((c) => moveCourtKey(manageToken, c.courtId) === req.body.courtKey);
      if (!court) {
        return res.sendError(
          "That court isn't taking bookings — reload the page and pick again",
          400
        );
      }
      courtId = court.courtId;
    }

    const result = await inTransaction(req.db, (conn) =>
      moveBooking(conn, {
        bookingId: b.bookingId,
        courtId,
        startLocal: toStartLocal(req.body.date, req.body.startTime),
        asPlayer: true,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    await runPaymentFollowUps(req.db, result.followUp);
    await sendBookingEmail(req.db, b.bookingId, "Moved", {
      previous: await describeSlot(req.db, result.from),
    });
    return res.sendSuccess("Booking moved", { startAt: result.startAt, endAt: result.endAt });
  })
);

// Per IP: a player taps Pay a few times at most
const payLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_PAY_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-pay:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/**
 * POST /bookings/:manageToken/pay
 * Phase F: the booking's Xendit checkout — the open one (same page) or a new
 * one while the hold lasts. 200 { checkoutUrl } or, when it turns out to be
 * paid already, { paid: true, checkoutUrl: null }.
 */
router.post(
  "/bookings/:manageToken/pay",
  payLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    await expireHolds(req.db);
    const rows = await req.db.query(
      `SELECT bookingId, venueId, orderId, price, status, paymentStatus, checkoutId FROM bookings
       WHERE manageToken = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.manageToken]
    );
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const booking = rows[0];
    // PLAN-008: paid into the venue's company's own Xendit
    if (!(await venuePaysOnline(req.db, booking.venueId))) {
      return res.sendError("Online payment isn't available here — please call the venue", 409);
    }
    if (booking.paymentStatus === "Paid" || booking.paymentStatus === "Free") {
      return res.sendError("This booking is already paid", 409);
    }
    if (booking.status !== "Pending") {
      return res.sendError(
        booking.status === "Expired"
          ? "The hold on this slot ran out — book it again"
          : "This booking can't be paid any more",
        409
      );
    }

    const result = await resumeCheckout(req.db, { ...booking, price: Number(booking.price) });
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    if (result.paid) {
      return res.sendSuccess("Payment received — your booking is confirmed", {
        paid: true,
        checkoutUrl: null,
      });
    }
    return res.sendSuccess("Checkout ready", { paid: false, checkoutUrl: result.checkoutUrl });
  })
);

// Per IP: checking in is once a booking; a few taps a minute covers retries
const checkInLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CHECKIN_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-checkin:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/**
 * POST /bookings/:manageToken/check-in
 * Phase D: start the booking's recorded game from its own page, during the
 * check-in window. 201 { shareUrl, shareToken } (200 when already checked in).
 */
router.post(
  "/bookings/:manageToken/check-in",
  checkInLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT bookingId FROM bookings WHERE manageToken = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.manageToken]
    );
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    await advanceSessions(req.db);

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await checkInBooking(conn, {
        bookingId: rows[0].bookingId,
        requireRecorderOnline: true,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    if (!result.alreadyCheckedIn) await sendBookingEmail(req.db, rows[0].bookingId, "GameStarted");
    return res.sendSuccess(
      // CR-045: this page is now the only way in, so it also says when a game resumed (CR-041)
      result.resumed
        ? "Recording resumed — the camera is recording"
        : result.status === "Scheduled"
          ? "Checked in — recording starts at your booked time"
          : "Checked in — the camera is recording",
      { shareToken: result.shareToken, shareUrl: result.shareUrl },
      result.alreadyCheckedIn ? 200 : 201
    );
  })
);

export default router;
