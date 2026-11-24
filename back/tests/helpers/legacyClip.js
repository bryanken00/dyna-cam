// CR-027 removed every way to save a 60-second clip (court QR, court button).
// Clips saved before that still show on their pages, in payments and in Google
// Drive until they expire, so the tests for those make one directly — the row
// the old court-QR save inserted (CR-040 Phase 4: and the box's upload).

import { randomPayCode, randomToken } from "../../server/src/utils/crypto/tokens.js";

/**
 * Insert a Pending 60-second clip on a court, as the court QR used to.
 * @param {import("mysql2/promise").Connection} sql - ctx.sql
 * @param {Object} options
 * @param {string} options.courtId
 * @param {number} [options.price] - default: the venue's clip price
 * @returns {Promise<{ clipId: string, shareToken: string, payCode: string|null }>}
 */
export const insertLegacyClip = async (sql, { courtId, price }) => {
  const [[court]] = await sql.query(
    `SELECT c.venueId, v.clipPrice FROM courts c JOIN venues v ON v.venueId = c.venueId
     WHERE c.courtId = ?`,
    [courtId]
  );
  const [[{ clipId }]] = await sql.query(`SELECT UUID() AS clipId`);
  const shareToken = randomToken();
  const amount = price ?? Number(court.clipPrice || 0);
  const payCode = amount > 0 ? randomPayCode() : null;
  await sql.query(
    `INSERT INTO clips
       (clipId, venueId, courtId, source, requestedAt, durationSeconds, price, paymentStatus,
        payCode, shareToken, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, 'QR', @now := DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
             '%Y-%m-%d %H:%i:%s'), 60, ?, ?, ?, ?, 'Pending', @now, @now)`,
    [clipId, court.venueId, courtId, amount, amount > 0 ? "Unpaid" : "Free", payCode, shareToken]
  );
  return { clipId, shareToken, payCode };
};

/**
 * CR-040 Phase 4: the box can no longer upload a clip, so a test makes a
 * legacy clip Ready directly — kept for the venue's days, optionally with its
 * files (relative upload paths) as the old upload stored them.
 * @param {import("mysql2/promise").Connection} sql - ctx.sql
 * @param {string} clipId
 * @param {{ videoPath?: string|null, thumbnailPath?: string|null }} [files]
 */
export const readyLegacyClip = (sql, clipId, { videoPath = null, thumbnailPath = null } = {}) =>
  sql.query(
    `UPDATE clips cl JOIN venues v ON v.venueId = cl.venueId
     SET cl.status = 'Ready', cl.sizeBytes = 1000, cl.videoPath = ?, cl.thumbnailPath = ?,
         cl.expiresAt = DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                                 INTERVAL v.clipRetentionDays DAY)
     WHERE cl.clipId = ?`,
    [videoPath, thumbnailPath, clipId]
  );
