import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { clubUrl } from "../../../utils/clips.js";
import {
  createClubSchema,
  listClubsQuerySchema,
  memberActionSchema,
  updateClubSchema,
} from "../../../validators/clubs.validator.js";

/**
 * PLAN-009 phase F — clubs in the Admin portal (/api/v1/admin/clubs).
 * Permission: clubs (GET = read, the rest = write). Company-scoped: another
 * company's club or member is a 404.
 *
 *   GET /options   the company's venues (the form)
 *   GET /          the company's clubs with their member counts
 *   GET /:clubId   one club and its members (Pending first)
 *   POST / · PUT /:clubId · DELETE /:clubId (soft)
 *   PUT /members/:clubMemberId   { status?: Active|Removed, role?: Member|Admin }
 */
const router = express.Router();

const FROM = `FROM clubs c JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted' AND v.companyId = ?`;

const clubView = (r) => ({
  ...r,
  members: Number(r.members || 0),
  pending: Number(r.pending || 0),
  shareUrl: clubUrl(r.publicToken),
});

/** GET /options — the company's venues, for the club form. */
router.get(
  "/options",
  checkPermission("clubs", null, "read"),
  catchAsync(async (req, res) => {
    const venues = await req.db.query(
      `SELECT venueId, name FROM venues WHERE companyId = ? AND status = 'Active' ORDER BY name ASC`,
      [callerCompany(req)]
    );
    return res.sendSuccess("Options", { venues });
  })
);

router.get(
  "/",
  checkPermission("clubs", null, "read"),
  validateQuery(listClubsQuerySchema),
  catchAsync(async (req, res) => {
    let where = "WHERE c.status != 'Deleted'";
    const params = [callerCompany(req)];
    if (req.query.venueId) {
      where += " AND c.venueId = ?";
      params.push(req.query.venueId);
    }
    if (req.query.status) {
      where += " AND c.status = ?";
      params.push(req.query.status);
    }
    const rows = await req.db.query(
      `SELECT c.clubId, c.venueId, v.name AS venueName, c.publicToken, c.name, c.description, c.joinPolicy, c.status,
              c.dateCreated,
              (SELECT COUNT(*) FROM club_members m WHERE m.clubId = c.clubId AND m.status = 'Active') AS members,
              (SELECT COUNT(*) FROM club_members m WHERE m.clubId = c.clubId AND m.status = 'Pending') AS pending
       ${FROM} ${where} ORDER BY c.name ASC`,
      params
    );
    return res.sendSuccess("Clubs", { clubs: rows.map(clubView) });
  })
);

router.get(
  "/:clubId",
  checkPermission("clubs", null, "read"),
  catchAsync(async (req, res) => {
    const [club] = await req.db.query(
      `SELECT c.clubId, c.venueId, v.name AS venueName, c.publicToken, c.name, c.description, c.joinPolicy, c.status
       ${FROM} WHERE c.clubId = ? AND c.status != 'Deleted' LIMIT 1`,
      [callerCompany(req), req.params.clubId]
    );
    if (!club) return res.sendError("Club not found", 404);
    const members = await req.db.query(
      `SELECT m.clubMemberId, m.role, m.status, m.joinedAt, m.dateCreated, p.name, p.email, p.phone, sp.skillLevel
       FROM club_members m
       JOIN players p ON p.playerId = m.playerId
       LEFT JOIN player_sports sp ON sp.playerId = m.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
       WHERE m.clubId = ? AND m.status != 'Removed'
       ORDER BY m.status = 'Pending' DESC, m.role = 'Admin' DESC, p.name ASC`,
      [club.clubId]
    );
    return res.sendSuccess("Club", { club: clubView(club), members });
  })
);

router.post(
  "/",
  checkPermission("clubs", null, "write"),
  validateBody(createClubSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const [venue] = await req.db.query(
      `SELECT venueId FROM venues WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1`,
      [req.body.venueId, callerCompany(req)]
    );
    if (!venue) return res.sendError("Venue not found", 400);
    const [uuid] = await req.db.query(`SELECT UUID() AS id`);
    const publicToken = randomToken();
    await req.db.query(
      `INSERT INTO clubs (clubId, venueId, publicToken, name, description, joinPolicy, createdByAccountId, status,
         dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [uuid.id, venue.venueId, publicToken, req.body.name, req.body.description || null, req.body.joinPolicy,
        req.user.accountId, now, now]
    );
    return res.sendSuccess("Club added", { clubId: uuid.id, shareUrl: clubUrl(publicToken) }, 201);
  })
);

router.put(
  "/:clubId",
  checkPermission("clubs", null, "write"),
  validateBody(updateClubSchema),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE clubs c JOIN venues v ON v.venueId = c.venueId AND v.companyId = ?
       SET c.name = ?, c.description = ?, c.joinPolicy = ?, c.status = ?, c.dateUpdated = ?
       WHERE c.clubId = ? AND c.status != 'Deleted'`,
      [callerCompany(req), req.body.name, req.body.description || null, req.body.joinPolicy, req.body.status || "Active",
        getCurrentTimestampLocal(), req.params.clubId]
    );
    if (!Number(result.affectedRows)) return res.sendError("Club not found", 404);
    return res.sendSuccess("Club updated");
  })
);

router.delete(
  "/:clubId",
  checkPermission("clubs", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE clubs c JOIN venues v ON v.venueId = c.venueId AND v.companyId = ?
       SET c.status = 'Deleted', c.dateUpdated = ? WHERE c.clubId = ? AND c.status != 'Deleted'`,
      [callerCompany(req), getCurrentTimestampLocal(), req.params.clubId]
    );
    if (!Number(result.affectedRows)) return res.sendError("Club not found", 404);
    return res.sendSuccess("Club removed");
  })
);

router.put(
  "/members/:clubMemberId",
  checkPermission("clubs", null, "write"),
  validateBody(memberActionSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const { status, role } = req.body;
    const result = await req.db.query(
      `UPDATE club_members m
       JOIN clubs c ON c.clubId = m.clubId AND c.status != 'Deleted'
       JOIN venues v ON v.venueId = c.venueId AND v.companyId = ?
       SET m.status = COALESCE(?, m.status), m.role = COALESCE(?, m.role),
           m.joinedAt = IF(? = 'Active' AND m.joinedAt IS NULL, ?, m.joinedAt), m.dateUpdated = ?
       WHERE m.clubMemberId = ? AND m.status != 'Removed'`,
      [callerCompany(req), status || null, role || null, status || null, now, now, req.params.clubMemberId]
    );
    if (!Number(result.affectedRows)) return res.sendError("Member not found", 404);
    return res.sendSuccess(status === "Removed" ? "Taken out of the club" : status === "Active" ? "Approved" : "Saved");
  })
);

export default router;
