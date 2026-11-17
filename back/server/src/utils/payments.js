import { getCurrentTimestampLocal } from "./dateUtils.js";

/**
 * Recording a cash payment for a clip (PLAN-001 Phase 4) — shared by the
 * Admin portal (a staff account) and paired staff phones (PLAN-002). Runs
 * inside the caller's transaction.
 *
 * A payment can only be taken for an Unpaid clip that is still Pending,
 * Processing or Ready; recording it unlocks the clip for the player.
 */

const PAYABLE = ["Pending", "Processing", "Ready"];

/**
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} options
 * @param {string} [options.payCode] - find the clip by the code the player shows…
 * @param {string} [options.clipId] - …or by its ID
 * @param {string} [options.venueId] - only a clip of this venue (paired phones)
 * @param {string} [options.accountId] - the staff account taking the cash
 * @param {string} [options.pairedAppId] - or the paired phone taking it
 * @param {string} [options.note]
 * @returns {Promise<{ ok: true, paymentId: string, clipId: string, amount: number }
 *   | { ok: false, status: number, message: string }>}
 */
export const recordCashPayment = async (
  conn,
  { payCode, clipId, venueId, accountId, pairedAppId, note }
) => {
  const params = [payCode || clipId];
  let where = `${payCode ? "payCode" : "clipId"} = ? AND status != 'Deleted'`;
  if (venueId) {
    where += " AND venueId = ?";
    params.push(venueId);
  }

  const [rows] = await conn.execute(
    `SELECT clipId, venueId, price, paymentStatus, status FROM clips
     WHERE ${where}
     LIMIT 1 FOR UPDATE`,
    params
  );
  if (rows.length === 0) {
    return {
      ok: false,
      status: 404,
      message: payCode ? "No clip has that pay code" : "Clip not found",
    };
  }
  const clip = rows[0];
  if (clip.paymentStatus !== "Unpaid") {
    return {
      ok: false,
      status: 409,
      message: clip.paymentStatus === "Paid" ? "This clip is already paid" : "This clip is free",
    };
  }
  if (!PAYABLE.includes(clip.status)) {
    return {
      ok: false,
      status: 409,
      message: `This clip ${clip.status === "Expired" ? "has expired" : "could not be saved"} — don't take payment`,
    };
  }

  const now = getCurrentTimestampLocal();
  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const paymentId = uuidRow[0].id;
  await conn.execute(
    `INSERT INTO payments
       (paymentId, clipId, venueId, amount, method, receivedByAccountId, pairedAppId, note, status,
        paidAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, 'CASH', ?, ?, ?, 'Paid', ?, ?, ?)`,
    [
      paymentId,
      clip.clipId,
      clip.venueId,
      clip.price,
      accountId || null,
      pairedAppId || null,
      note || null,
      now,
      now,
      now,
    ]
  );
  await conn.execute(`UPDATE clips SET paymentStatus = 'Paid', dateUpdated = ? WHERE clipId = ?`, [
    now,
    clip.clipId,
  ]);

  return { ok: true, paymentId, clipId: clip.clipId, amount: Number(clip.price) };
};
