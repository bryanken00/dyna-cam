import { getCurrentTimestampLocal } from "./dateUtils.js";
import { signUploadUrl } from "./file/signedUrl.js";
import { directionsUrl } from "./maps.js";
import { venuePaysOnline } from "./companyPayments.js";
import { amenityList, COURT_SURFACES, SPORTS, VENUE_KEY_SQL, venueKey } from "./venueFacts.js";

/**
 * PLAN-009 phase B: a player's sport profile (level, DUPR), the venues they
 * follow, and the venues they booked lately (Book again). Everything here reads
 * or writes only the calling player's rows. Venues are named by their public
 * key (utils/venueFacts.js venueKey), never their business ID.
 */

// ── sport profile ───────────────────────────────────────────────────────────

const sportView = (sport, row) => ({
  sport,
  skillLevel: row?.skillLevel || null,
  duprId: row?.duprId || null,
  duprRating: row?.duprRating === null || row?.duprRating === undefined ? null : Number(row.duprRating),
  // Typed in by the player; true only once a DUPR sync confirms it (not built yet)
  duprVerified: Boolean(row?.duprVerifiedAt),
});

/** Every sport (pickleball only for now), with the player's saved answers or empty ones. */
export const playerSports = async (db, playerId) => {
  const rows = await db.query(
    `SELECT sport, skillLevel, duprId, duprRating, duprVerifiedAt
     FROM player_sports WHERE playerId = ? AND status = 'Active'`,
    [playerId]
  );
  const bySport = new Map(rows.map((r) => [r.sport, r]));
  return SPORTS.map((sport) => sportView(sport, bySport.get(sport)));
};

/**
 * Save one sport's answers. A changed DUPR ID or rating is unverified again.
 * @param {{ sport, skillLevel?, duprId?, duprRating? }} body - validated; omitted = cleared
 */
export const savePlayerSport = async (db, playerId, body) => {
  const { sport, skillLevel = null, duprId = null, duprRating = null } = body;
  const now = getCurrentTimestampLocal();
  let conn;
  try {
    conn = await db.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT playerSportId, duprId, duprRating FROM player_sports
       WHERE playerId = ? AND sport = ? LIMIT 1 FOR UPDATE`,
      [playerId, sport]
    );
    if (rows.length) {
      const before = rows[0];
      const duprChanged =
        (before.duprId || null) !== duprId ||
        (before.duprRating === null ? null : Number(before.duprRating)) !== duprRating;
      await conn.execute(
        `UPDATE player_sports
         SET skillLevel = ?, duprId = ?, duprRating = ?,
             duprVerifiedAt = IF(?, NULL, duprVerifiedAt), status = 'Active', dateUpdated = ?
         WHERE playerSportId = ?`,
        [skillLevel, duprId, duprRating, duprChanged ? 1 : 0, now, before.playerSportId]
      );
    } else {
      const [uuid] = await conn.execute(`SELECT UUID() AS id`);
      await conn.execute(
        `INSERT INTO player_sports
           (playerSportId, playerId, sport, skillLevel, duprId, duprRating, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [uuid[0].id, playerId, sport, skillLevel, duprId, duprRating, now, now]
      );
    }
    await db.commit(conn);
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
  return playerSports(db, playerId);
};

// ── venues on player pages ──────────────────────────────────────────────────

/**
 * Per venue: what its Active courts are like and how many players follow it.
 * @returns {Promise<Map<string, { surfaces: string[], indoorCourts: number, outdoorCourts: number, followers: number }>>}
 */
export const venueFactsFor = async (db, venueIds) => {
  const facts = new Map(
    venueIds.map((id) => [id, { surfaces: [], indoorCourts: 0, outdoorCourts: 0, followers: 0 }])
  );
  if (!venueIds.length) return facts;
  const marks = venueIds.map(() => "?").join(", ");
  const courts = await db.query(
    `SELECT venueId, surface, isIndoor FROM courts
     WHERE venueId IN (${marks}) AND status = 'Active'`,
    venueIds
  );
  for (const c of courts) {
    const f = facts.get(c.venueId);
    if (c.surface && !f.surfaces.includes(c.surface)) f.surfaces.push(c.surface);
    if (c.isIndoor === 1) f.indoorCourts += 1;
    if (c.isIndoor === 0) f.outdoorCourts += 1;
  }
  for (const f of facts.values()) {
    f.surfaces.sort((a, b) => COURT_SURFACES.indexOf(a) - COURT_SURFACES.indexOf(b));
  }
  const follows = await db.query(
    `SELECT venueId, COUNT(*) AS n FROM venue_follows
     WHERE venueId IN (${marks}) AND status = 'Active' GROUP BY venueId`,
    venueIds
  );
  for (const r of follows) facts.get(r.venueId).followers = Number(r.n);
  return facts;
};

/**
 * A venue as a player card: name, address, logo, directions, its booking link
 * when it takes online bookings (null: it doesn't right now), and its key.
 */
const venueCard = async (db, v) => ({
  key: venueKey(v.venueId),
  name: v.name,
  address: v.address,
  logoUrl: signUploadUrl(v.logoUrl),
  directionsUrl: directionsUrl(v.latitude, v.longitude),
  amenities: amenityList(v.amenities),
  bookingToken: v.bookingToken && (await venuePaysOnline(db, v.venueId)) ? v.bookingToken : null,
});

const CARD_COLUMNS = `v.venueId, v.name, v.address, v.logoUrl, v.latitude, v.longitude, v.amenities,
  v.bookingToken`;

/** The Active venue (of an Active company) with this public key, or null. */
export const findVenueByKey = async (db, key) => {
  const rows = await db.query(
    `SELECT v.venueId FROM venues v
     INNER JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     WHERE ${VENUE_KEY_SQL("v")} = ? AND v.status = 'Active' LIMIT 1`,
    [key]
  );
  return rows[0]?.venueId || null;
};

/** The venues the player follows, newest follow first. */
export const followedVenues = async (db, playerId) => {
  const rows = await db.query(
    `SELECT ${CARD_COLUMNS}
     FROM venue_follows f
     INNER JOIN venues v ON v.venueId = f.venueId AND v.status = 'Active'
     INNER JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     WHERE f.playerId = ? AND f.status = 'Active'
     ORDER BY f.dateUpdated DESC, f.id DESC`,
    [playerId]
  );
  return Promise.all(rows.map((v) => venueCard(db, v)));
};

/** Follow (`on`) or unfollow a venue. Following again brings the old row back. */
export const setFollow = async (db, playerId, venueId, on) => {
  const now = getCurrentTimestampLocal();
  const [uuid] = await db.query(`SELECT UUID() AS id`);
  await db.query(
    `INSERT INTO venue_follows (venueFollowId, playerId, venueId, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), dateUpdated = VALUES(dateUpdated)`,
    [uuid.id, playerId, venueId, on ? "Active" : "Deleted", now, now]
  );
};

/** Up to `limit` venues the player booked lately (Book again), most recent first. */
export const recentVenues = async (db, playerId, limit = 5) => {
  const rows = await db.query(
    `SELECT ${CARD_COLUMNS}, MAX(b.startAt) AS lastStartAt
     FROM bookings b
     INNER JOIN venues v ON v.venueId = b.venueId AND v.status = 'Active'
     INNER JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
     -- an abandoned online hold (Expired) isn't a visit
     WHERE b.playerId = ? AND b.status NOT IN ('Deleted', 'Expired')
     GROUP BY v.venueId
     ORDER BY lastStartAt DESC
     LIMIT ${Number(limit)}`,
    [playerId]
  );
  return Promise.all(rows.map((v) => venueCard(db, v)));
};
