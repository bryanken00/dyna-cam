import { randomPayCode, randomToken } from "./crypto/tokens.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { selectRows } from "./dbRows.js";
import { BOOKING_SLOT_MINUTES, quote } from "./bookingPrice.js";
import { findConflict } from "./courtTimeline.js";
import { MIN_CHECKOUT_SECONDS, onlineHoldUntil, REFUND_QUEUED } from "./bookingPayments.js";

/**
 * PLAN-003: court bookings — the writes the desk (Admin) and, from Phase C,
 * the player's booking page share. Every writer runs inside the caller's
 * transaction and locks the court row FOR UPDATE before checking the court
 * timeline (utils/courtTimeline.js), like bookCourt() does for games.
 *
 * Status: Pending (unpaid, holds the slot until holdExpiresAt) → Confirmed
 * (Paid or Free) → CheckedIn → Completed; or NoShow, Cancelled, Expired,
 * Deleted. Only a Confirmed booking can be checked in.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Statuses that can still change: paid, moved, cancelled. */
export const OPEN_BOOKING = ["Pending", "Confirmed"];

/** Desk bookings can be up to this long (online ones: the venue's maxBookingMinutes). */
export const DESK_MAX_BOOKING_MINUTES = 360;

/** "2026-11-24" + "17:00" → "2026-11-24 17:00:00". */
export const toStartLocal = (date, startTime) => `${date} ${startTime}:00`;

export const addMinutesTo = (local, minutes) =>
  moment.tz(local, FORMAT, TIMEZONE).add(minutes, "minutes").format(FORMAT);

const minutesBetween = (from, to) =>
  moment.tz(to, FORMAT, TIMEZONE).diff(moment.tz(from, FORMAT, TIMEZONE), "minutes");

const clock = (local) => moment.tz(local, FORMAT, TIMEZONE).format("h:mm A");

const fail = (status, message, code) => ({ ok: false, status, message, code });

/** Why the timeline refused a window, in words for staff and players. */
export const conflictMessage = (conflict) => {
  switch (conflict.type) {
    case "BOOKING":
      return `That time is taken (booking ${conflict.code}, from ${clock(conflict.from)})`;
    case "GAME":
      return `A game is on the court then (from ${clock(conflict.from)})`;
    case "CLOSURE":
      return "The court is closed then";
    case "CLOSED":
      return "That's outside the venue's opening hours";
    default:
      return "That time isn't free";
  }
};

/** Why a price couldn't be worked out. */
const quoteMessage = (q) => {
  if (q.reason === "NOT_ON_THE_HOUR") return "Bookings start on the hour";
  if (q.reason === "BAD_LENGTH") return "Bookings are whole hours";
  return `No price is set for ${clock(q.at)} — add a rate in the venue's booking settings`;
};

/**
 * Pending holds whose time ran out → Expired, so they stop showing as live.
 * Run on reads (so a page never shows a stale hold) and every minute by
 * jobs/bookingMaintenance.js.
 *
 * @returns {Promise<number>} how many holds expired
 */
export const expireHolds = async (db, { venueId, now = getCurrentTimestampLocal() } = {}) => {
  const params = [now, now];
  let scope = "";
  if (venueId) {
    scope = " AND venueId = ?";
    params.push(venueId);
  }
  const result = await selectRows(
    db,
    `UPDATE bookings SET status = 'Expired', dateUpdated = ?
     WHERE status = 'Pending' AND holdExpiresAt IS NOT NULL AND holdExpiresAt <= ?${scope}`,
    params
  );
  return Number(result?.affectedRows || 0);
};

/** Lock a court (Active, at an Active venue) and read its venue's booking rules. */
const lockCourt = async (conn, courtId) => {
  const [rows] = await conn.execute(
    `SELECT c.courtId, c.venueId, c.name AS courtName, v.maxBookingMinutes, v.bookingDaysAhead,
            v.deskHoldMinutes, v.onlineHoldMinutes
     FROM courts c JOIN venues v ON v.venueId = c.venueId
     WHERE c.courtId = ? AND c.status = 'Active' AND v.status = 'Active'
     LIMIT 1 FOR UPDATE`,
    [courtId]
  );
  return rows[0] || null;
};

/** The rules only a player's own booking keeps (staff may book past them). */
const onlineRules = (court, { startLocal, durationMinutes, now }) => {
  if (startLocal <= now) return fail(400, "That time has already started — pick a later one");
  if (durationMinutes > court.maxBookingMinutes) {
    return fail(400, `Bookings here are at most ${court.maxBookingMinutes / 60} hours`);
  }
  const lastDay = moment().tz(TIMEZONE).add(court.bookingDaysAhead, "days").format("YYYY-MM-DD");
  if (startLocal.slice(0, 10) > lastDay) {
    return fail(400, `Book at most ${court.bookingDaysAhead} days ahead`);
  }
  return null;
};

/** A player never sees another booking's code or a game's details. */
const playerConflictMessage = (conflict) =>
  conflict.type === "CLOSED"
    ? "That's outside the venue's opening hours"
    : "That time was just taken — pick another";

/** Insert a row that needs a fresh bookingCode, retrying on the (rare) collision. */
const insertWithBookingCode = async (insert) => {
  for (let attempt = 0; ; attempt += 1) {
    const code = randomPayCode();
    try {
      await insert(code);
      return code;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }
};

/** A cash payment row for a booking (amount = its price). */
const insertCashPayment = async (conn, { booking, accountId, note, now }) => {
  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const paymentId = uuidRow[0].id;
  await conn.execute(
    `INSERT INTO payments
       (paymentId, bookingId, venueId, amount, method, receivedByAccountId, note, status,
        paidAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, 'CASH', ?, ?, 'Paid', ?, ?, ?)`,
    [paymentId, booking.bookingId, booking.venueId, booking.price, accountId || null, note || null, now, now, now]
  );
  return paymentId;
};

/**
 * A new booking's status, payment status and hold for how it's paid:
 * Cash / Free → Confirmed; Hold → Pending until deskHoldMinutes before the
 * start; Online → Pending for the checkout (onlineHoldMinutes, never past the start).
 */
const paymentTerms = ({ kind, court, startLocal, now, online }) => {
  if (kind === "Hold") {
    const holdExpiresAt = addMinutesTo(startLocal, -court.deskHoldMinutes);
    if (holdExpiresAt <= now) {
      return fail(
        400,
        online
          ? `That's too soon to pay at the desk — pick a time at least ${court.deskHoldMinutes} minutes from now`
          : `It starts in less than ${court.deskHoldMinutes} minutes — take the payment now instead of holding it`
      );
    }
    return { ok: true, status: "Pending", paymentStatus: "Unpaid", holdExpiresAt };
  }
  if (kind === "Online") {
    const holdExpiresAt = onlineHoldUntil({ startLocal, onlineHoldMinutes: court.onlineHoldMinutes, now });
    if (minutesBetween(now, holdExpiresAt) * 60 < MIN_CHECKOUT_SECONDS) {
      return fail(400, "That's too soon to pay online — pick a later time");
    }
    return { ok: true, status: "Pending", paymentStatus: "Unpaid", holdExpiresAt };
  }
  return { ok: true, status: "Confirmed", paymentStatus: kind === "Free" ? "Free" : "Paid", holdExpiresAt: null };
};

/**
 * Create a booking. Inside a transaction.
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 * @param {Object} b
 * @param {string} b.courtId
 * @param {string} b.startLocal - on the hour, Manila
 * @param {number} b.durationMinutes - whole hours
 * @param {string} b.playerName
 * @param {string|null} [b.phone]
 * @param {string|null} [b.email]
 * @param {"Cash"|"Hold"|"Online"|"Free"} b.payment - Cash = paid now at the desk; Hold = pay
 *   at the desk by startAt − deskHoldMinutes; Online = a Xendit checkout holds the slot for
 *   onlineHoldMinutes (Phase F — the caller opens the checkout after commit); Free = staff comp
 * @param {"Desk"|"Online"} [b.source]
 * @param {boolean} [b.ignoreHours] - staff booking outside opening hours
 * @param {string|null} [b.accountId] - the staff account (desk)
 * @param {string|null} [b.note] - on the cash payment
 * @returns {Promise<{ ok: true, bookingId, bookingCode, manageToken, status, price }
 *   | { ok: false, status: number, message: string, code?: string }>}
 */
export const createBooking = async (
  conn,
  {
    courtId,
    startLocal,
    durationMinutes,
    playerName,
    phone = null,
    email = null,
    payment,
    source = "Desk",
    ignoreHours = false,
    accountId = null,
    note = null,
  }
) => {
  const now = getCurrentTimestampLocal();
  const court = await lockCourt(conn, courtId);
  if (!court) return fail(404, "Court not found or not active");

  const endLocal = addMinutesTo(startLocal, durationMinutes);
  if (endLocal <= now) return fail(400, "That time has already passed");
  const online = source === "Online";
  if (online) {
    const refused = onlineRules(court, { startLocal, durationMinutes, now });
    if (refused) return refused;
  }

  const conflict = await findConflict(conn, {
    courtId,
    startLocal,
    endLocal,
    checkHours: online || !ignoreHours,
    now,
  });
  if (conflict) return fail(409, online ? playerConflictMessage(conflict) : conflictMessage(conflict));

  const q = await quote(conn, { venueId: court.venueId, courtId, startLocal, durationMinutes });
  if (!q.bookable && !(payment === "Free" && q.reason === "NO_RATE")) {
    return fail(400, online ? "That time can't be booked online — please call the desk" : quoteMessage(q));
  }
  const price = q.bookable ? q.price : 0;
  // Nothing to pay: a "paid now" or "hold" of ₱0 is simply free
  const kind = price === 0 ? "Free" : payment;

  const terms = paymentTerms({ kind, court, startLocal, now, online });
  if (!terms.ok) return terms;
  const { status, paymentStatus, holdExpiresAt } = terms;

  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const bookingId = uuidRow[0].id;
  const manageToken = randomToken();
  const bookingCode = await insertWithBookingCode((code) =>
    conn.execute(
      `INSERT INTO bookings
         (bookingId, venueId, courtId, startAt, endAt, playerName, phone, email, price,
          paymentStatus, payMethod, source, bookingCode, manageToken, holdExpiresAt,
          createdByAccountId, status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingId,
        court.venueId,
        courtId,
        startLocal,
        endLocal,
        playerName,
        phone || null,
        email || null,
        price,
        paymentStatus,
        kind === "Online" ? "Online" : "Desk",
        source,
        code,
        manageToken,
        holdExpiresAt,
        accountId,
        status,
        now,
        now,
      ]
    )
  );

  if (kind === "Cash") {
    await insertCashPayment(conn, {
      booking: { bookingId, venueId: court.venueId, price },
      accountId,
      note,
      now,
    });
  }

  return { ok: true, bookingId, bookingCode, manageToken, status, price };
};

/** Lock a booking (not Deleted) by ID. */
const lockBooking = async (conn, bookingId) => {
  const [rows] = await conn.execute(
    `SELECT b.* FROM bookings b
     JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
     WHERE b.bookingId = ? AND b.status != 'Deleted'
     LIMIT 1 FOR UPDATE`,
    [bookingId]
  );
  return rows[0] || null;
};

/** Pending past its hold reads as Expired even before the job marks it. */
const effectiveStatus = (booking, now) =>
  booking.status === "Pending" && booking.holdExpiresAt && booking.holdExpiresAt <= now
    ? "Expired"
    : booking.status;

/**
 * Record the cash a player paid at the desk for a held booking → Paid + Confirmed.
 * @returns {Promise<{ ok: true, paymentId, amount } | { ok: false, status, message }>}
 */
export const recordBookingPayment = async (conn, { bookingId, accountId, note }) => {
  const now = getCurrentTimestampLocal();
  const booking = await lockBooking(conn, bookingId);
  if (!booking) return fail(404, "Booking not found");
  if (booking.paymentStatus !== "Unpaid") {
    return fail(
      409,
      booking.paymentStatus === "Paid" ? "This booking is already paid" : "Nothing to pay for this booking"
    );
  }
  const status = effectiveStatus(booking, now);
  if (status !== "Pending") {
    return fail(
      409,
      status === "Expired"
        ? "This booking's hold ran out and the slot was released — book it again"
        : "This booking was cancelled — don't take payment"
    );
  }

  const paymentId = await insertCashPayment(conn, {
    booking: { ...booking, price: Number(booking.price) },
    accountId,
    note,
    now,
  });
  await conn.execute(
    `UPDATE bookings
     SET paymentStatus = 'Paid', payMethod = 'Desk', status = 'Confirmed', holdExpiresAt = NULL,
         checkoutId = NULL, checkoutUrl = NULL, dateUpdated = ?
     WHERE bookingId = ?`,
    [now, booking.bookingId]
  );
  // Phase F: a checkout the player opened can't be paid on top of the cash
  return {
    ok: true,
    paymentId,
    amount: Number(booking.price),
    followUp: { closeCheckoutId: booking.checkoutId || null },
  };
};

const pesos = (amount) => `₱${Number(amount).toLocaleString("en-PH")}`;

/**
 * Phase H: a player may cancel or move their own booking only until the
 * venue's cut-off (cancelCutoffHours before the start). After it, the desk can.
 */
const playerCutoffProblem = async (conn, booking, now, what) => {
  const [venues] = await conn.execute(`SELECT cancelCutoffHours FROM venues WHERE venueId = ? LIMIT 1`, [
    booking.venueId,
  ]);
  const cutoff = moment
    .tz(booking.startAt, FORMAT, TIMEZONE)
    .subtract(venues[0]?.cancelCutoffHours ?? 24, "hours")
    .format(FORMAT);
  if (now >= cutoff) {
    return fail(
      409,
      `It's too close to the start to ${what} it online — call the venue`,
      "PAST_CUTOFF"
    );
  }
  return null;
};

/**
 * Lock order is court(s) then booking, like closures and check-in, so two
 * writers can't deadlock: peek at the booking's court, lock both courts (in a
 * fixed order), then lock the booking. → { booking, court } (either may be null)
 */
const lockForMove = async (conn, { bookingId, courtId }) => {
  const [peek] = await conn.execute(`SELECT courtId FROM bookings WHERE bookingId = ? LIMIT 1`, [
    bookingId,
  ]);
  if (peek.length === 0) return { booking: null, court: null };
  const courtIds = [...new Set([peek[0].courtId, courtId])].sort();
  let court = null;
  for (const id of courtIds) {
    const locked = await lockCourt(conn, id);
    if (id === courtId) court = locked;
  }
  return { booking: await lockBooking(conn, bookingId), court };
};

/** The moved booking's price: kept; staff may reprice an unpaid one; a player's may not rise. */
const movedPrice = async (conn, { booking, courtId, startLocal, durationMinutes, reprice, asPlayer }) => {
  if (asPlayer) {
    const pricier = await playerMovePrice(conn, { booking, courtId, startLocal, durationMinutes });
    if (pricier) return pricier;
  }
  if (!reprice) return { ok: true, price: Number(booking.price) };
  if (booking.paymentStatus === "Paid") {
    return fail(409, "It's already paid — move it at the same price, or cancel and rebook");
  }
  const q = await quote(conn, { venueId: booking.venueId, courtId, startLocal, durationMinutes });
  if (!q.bookable) return fail(400, quoteMessage(q));
  return { ok: true, price: q.price };
};

/** A desk hold follows the new start (deskHoldMinutes before it); other holds keep theirs. */
const movedHold = ({ booking, court, startLocal, now, asPlayer }) => {
  if (booking.status !== "Pending" || booking.payMethod !== "Desk") {
    return { ok: true, holdExpiresAt: booking.holdExpiresAt };
  }
  const holdExpiresAt = addMinutesTo(startLocal, -court.deskHoldMinutes);
  if (holdExpiresAt <= now) {
    return fail(
      400,
      asPlayer
        ? `That's too soon to pay at the desk — pick a time at least ${court.deskHoldMinutes} minutes from now`
        : "That's too soon to keep it unpaid — take the payment first"
    );
  }
  return { ok: true, holdExpiresAt };
};

/** A player's move: before the cut-off, only once, to a later time within bookingDaysAhead. */
const playerMoveRules = async (conn, { booking, court, startLocal, now }) => {
  const refused = await playerCutoffProblem(conn, booking, now, "move");
  if (refused) return refused;
  if (booking.rescheduledCount > 0) {
    return fail(409, "You've already moved this booking once — call the venue to change it again");
  }
  if (startLocal <= now) return fail(400, "That time has already started — pick a later one");
  const lastDay = moment().tz(TIMEZONE).add(court.bookingDaysAhead, "days").format("YYYY-MM-DD");
  if (startLocal.slice(0, 10) > lastDay) {
    return fail(400, `Book at most ${court.bookingDaysAhead} days ahead`);
  }
  return null;
};

/** The booking keeps its price; a player's new time may cost the same or less (no partial refunds). */
const playerMovePrice = async (conn, { booking, courtId, startLocal, durationMinutes }) => {
  const q = await quote(conn, { venueId: booking.venueId, courtId, startLocal, durationMinutes });
  if (!q.bookable) return fail(400, "That time can't be booked online — pick another");
  const price = Number(booking.price);
  if (q.price > price) {
    return fail(
      409,
      `That time costs ${pesos(q.price)}; you can move to one that costs ${pesos(price)} or less. For a pricier time, cancel and book again.`
    );
  }
  return null;
};

/**
 * Cancel a booking that hasn't been played. With refund, every paid payment
 * is refunded: cash is marked Refunded (the desk hands the money back); an
 * online payment is queued (refundError = REFUND_QUEUED) and sent to Xendit by
 * runPaymentFollowUps() after the caller commits. The booking reads Refunded
 * once all of it is back. An unpaid booking's open checkout is closed too.
 *
 * @param {Object} options
 * @param {string} options.bookingId
 * @param {"Player"|"Staff"|"System"} options.by
 * @param {string} options.reason
 * @param {boolean} options.refund
 * @param {string|null} [options.accountId]
 * @param {boolean} [options.asPlayer] - Phase H: the player's own cancel — only before the
 *   venue's cut-off, and not when it was paid in cash (the desk gives that back)
 * @returns {Promise<{ ok: true, refunded: number, refundingOnline: number,
 *   followUp: { bookingId, closeCheckoutId, refundPaymentIds } } | { ok: false, status, message }>}
 *   refunded = cash handed back; refundingOnline = queued for Xendit
 */
export const cancelBooking = async (
  conn,
  { bookingId, by, reason, refund, accountId = null, asPlayer = false }
) => {
  const now = getCurrentTimestampLocal();
  const booking = await lockBooking(conn, bookingId);
  if (!booking) return fail(404, "Booking not found");
  if (!OPEN_BOOKING.includes(booking.status)) {
    return fail(
      409,
      booking.status === "CheckedIn" || booking.status === "Completed"
        ? "This booking has been played — it can't be cancelled"
        : `This booking is already ${booking.status === "NoShow" ? "a no-show" : booking.status.toLowerCase()}`
    );
  }
  if (asPlayer) {
    const refused = await playerCutoffProblem(conn, booking, now, "cancel");
    if (refused) return refused;
    if (booking.paymentStatus === "Paid") {
      const [cash] = await conn.execute(
        `SELECT 1 FROM payments WHERE bookingId = ? AND status = 'Paid' AND method = 'CASH' LIMIT 1`,
        [booking.bookingId]
      );
      if (cash.length > 0) {
        return fail(409, "It was paid at the desk — call the venue to cancel it and get your money back");
      }
    }
  }

  let refunded = 0;
  let refundingOnline = 0;
  const refundPaymentIds = [];
  if (refund && booking.paymentStatus === "Paid") {
    const [payments] = await conn.execute(
      `SELECT paymentId, amount, method, provider FROM payments
       WHERE bookingId = ? AND status = 'Paid' FOR UPDATE`,
      [booking.bookingId]
    );
    for (const p of payments) {
      if (p.method === "ONLINE") {
        // Sent to Xendit after commit; flagged now so a crash can't lose it
        await conn.execute(`UPDATE payments SET refundError = ?, dateUpdated = ? WHERE paymentId = ?`, [
          REFUND_QUEUED,
          now,
          p.paymentId,
        ]);
        refundPaymentIds.push(p.paymentId);
        refundingOnline += Number(p.amount);
        continue;
      }
      await conn.execute(
        `UPDATE payments
         SET status = 'Refunded', refundedAt = ?, refundedByAccountId = ?, dateUpdated = ?
         WHERE paymentId = ?`,
        [now, accountId, now, p.paymentId]
      );
      refunded += Number(p.amount);
    }
  }

  await conn.execute(
    `UPDATE bookings
     SET status = 'Cancelled', cancelledAt = ?, cancelledBy = ?, cancelReason = ?,
         paymentStatus = IF(? AND paymentStatus = 'Paid', 'Refunded', paymentStatus),
         holdExpiresAt = NULL, checkoutId = NULL, checkoutUrl = NULL, dateUpdated = ?
     WHERE bookingId = ?`,
    [now, by, reason.slice(0, 255), refund && refundPaymentIds.length === 0 ? 1 : 0, now, booking.bookingId]
  );
  return {
    ok: true,
    refunded,
    refundingOnline,
    followUp: { bookingId: booking.bookingId, closeCheckoutId: booking.checkoutId || null, refundPaymentIds },
  };
};

/**
 * Move a booking to another time and/or court at the same venue, keeping its
 * length. Staff: any number of times, price kept unless reprice (only while
 * nothing has been paid). Players (Phase H, asPlayer): once, before the
 * cut-off, within the online rules and opening hours, to a time that costs the
 * same or less — the price is kept.
 *
 * @returns {Promise<{ ok: true, startAt, endAt, price } | { ok: false, status, message }>}
 */
export const moveBooking = async (
  conn,
  { bookingId, courtId, startLocal, reprice = false, ignoreHours = false, asPlayer = false }
) => {
  const now = getCurrentTimestampLocal();
  const { booking, court } = await lockForMove(conn, { bookingId, courtId });
  if (!booking) return fail(404, "Booking not found");
  const status = effectiveStatus(booking, now);
  if (!OPEN_BOOKING.includes(status)) {
    return fail(409, `Only a booking that hasn't been played can be moved (this one is ${status})`);
  }
  if (!court || court.venueId !== booking.venueId) {
    return fail(400, "Pick a court at this booking's venue");
  }
  // Phase H: a player moves their own booking once, before the cut-off
  if (asPlayer) {
    const refused = await playerMoveRules(conn, { booking, court, startLocal, now });
    if (refused) return refused;
  }

  const durationMinutes = minutesBetween(booking.startAt, booking.endAt);
  const endLocal = addMinutesTo(startLocal, durationMinutes);
  if (endLocal <= now) return fail(400, "That time has already passed");
  if (startLocal === booking.startAt && courtId === booking.courtId) {
    return fail(400, "That's where the booking already is");
  }

  const conflict = await findConflict(conn, {
    courtId,
    startLocal,
    endLocal,
    ignoreBookingId: booking.bookingId,
    checkHours: !ignoreHours,
    now,
  });
  if (conflict) return fail(409, asPlayer ? playerConflictMessage(conflict) : conflictMessage(conflict));

  const priced = await movedPrice(conn, { booking, courtId, startLocal, durationMinutes, reprice, asPlayer });
  if (!priced.ok) return priced;
  const { price } = priced;
  const hold = movedHold({ booking, court, startLocal, now, asPlayer });
  if (!hold.ok) return hold;
  const { holdExpiresAt } = hold;

  // Phase F: an unpaid booking's open checkout is closed — the player pays
  // the moved booking (perhaps at a new price) with a fresh one
  const closeCheckoutId = booking.paymentStatus === "Unpaid" ? booking.checkoutId || null : null;
  await conn.execute(
    `UPDATE bookings
     SET courtId = ?, startAt = ?, endAt = ?, price = ?, holdExpiresAt = ?,
         rescheduledCount = rescheduledCount + ?,
         checkoutId = IF(?, NULL, checkoutId), checkoutUrl = IF(?, NULL, checkoutUrl), dateUpdated = ?
     WHERE bookingId = ?`,
    [
      courtId,
      startLocal,
      endLocal,
      price,
      holdExpiresAt,
      asPlayer ? 1 : 0,
      closeCheckoutId ? 1 : 0,
      closeCheckoutId ? 1 : 0,
      now,
      booking.bookingId,
    ]
  );
  return {
    ok: true,
    startAt: startLocal,
    endAt: endLocal,
    price,
    // Where it was — Phase G's Moved email says so
    from: { courtId: booking.courtId, startAt: booking.startAt, endAt: booking.endAt },
    followUp: { closeCheckoutId },
  };
};

/** Staff mark a Confirmed booking as a no-show once it has started. */
export const markNoShow = async (conn, { bookingId }) => {
  const now = getCurrentTimestampLocal();
  const booking = await lockBooking(conn, bookingId);
  if (!booking) return fail(404, "Booking not found");
  if (booking.status !== "Confirmed") {
    return fail(409, "Only a confirmed booking that wasn't checked in can be a no-show");
  }
  if (booking.startAt > now) return fail(409, "It hasn't started yet");
  await conn.execute(`UPDATE bookings SET status = 'NoShow', dateUpdated = ? WHERE bookingId = ?`, [
    now,
    booking.bookingId,
  ]);
  return { ok: true };
};

export { BOOKING_SLOT_MINUTES };
