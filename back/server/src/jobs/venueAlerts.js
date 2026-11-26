import { logger } from "../../config/logger.js";
import { postDiscord } from "../lib/discord/webhook.js";
import { sendMail } from "../lib/mailer/mailer.js";
import { venueAlertsEmail } from "../lib/mailer/templates.js";
import { secondsAgoLocal } from "../utils/clips.js";
import { getCurrentTimestampLocal, moment } from "../utils/dateUtils.js";
import { ALERT_LABELS, alertSettings, findProblems } from "../utils/venueHealth.js";

const INTERVAL_MS = 60 * 1000;

/** "since 19 Nov, 3:42 PM" from a stored Manila timestamp. */
const sinceText = (stored, prefix) =>
  stored ? `${prefix} ${moment(stored, "YYYY-MM-DD HH:mm:ss").format("D MMM, h:mm A")}` : "";

/**
 * One pass (CR-008), every minute:
 *
 * 1. A problem not seen before → a Pending row (firstSeenAt = now).
 * 2. Pending for the grace period → Open, and sent to staff.
 * 3. Gone → an Open row becomes Resolved (sent as "fixed"), a Pending one
 *    Cleared (nobody was told, so nobody is told it's over).
 *    While a box is offline its camera/disk/clock state is unknown, so those
 *    rows are left as they are. A box that was revoked or deleted closes its
 *    rows without a message.
 *
 * All new problems and fixes of a pass go out together on each channel:
 *  • Discord: one message to ALERT_DISCORD_WEBHOOK_URL.
 *  • Email: one per user with the Venue alerts permission — only when email is
 *    set up (SENDGRID_API_KEY, CR-018) and ALERT_EMAIL isn't "false".
 * With neither, they are only logged.
 *
 * @param {import("../../config/database.js").default} db
 * @param {object} [opts]
 * @param {typeof postDiscord} [opts.discord]
 * @param {typeof sendMail} [opts.mail]
 * @param {boolean} [opts.emailEnabled]
 * @param {ReturnType<typeof alertSettings>} [opts.settings]
 * @returns {Promise<{ added: number, opened: number, resolved: number, cleared: number, discord: boolean, emailed: number }>}
 */
export const runVenueAlerts = async (
  db,
  {
    discord = postDiscord,
    mail = sendMail,
    emailEnabled = alertEmailEnabled(),
    settings = alertSettings(),
  } = {}
) => {
  const now = getCurrentTimestampLocal();
  const openBefore = secondsAgoLocal(settings.graceMinutes * 60);
  const { problems, offlineDevices, knownDevices } = await findProblems(db, settings);
  const current = new Map(problems.map((problem) => [problem.alertKey, problem]));

  const active = await db.query(
    `SELECT alertId, alertKey, venueId, deviceId, kind, status, message, firstSeenAt
     FROM venue_alerts WHERE status IN ('Pending', 'Open')`
  );
  const activeKeys = new Set(active.map((row) => row.alertKey));
  const tally = { added: 0, opened: 0, resolved: 0, cleared: 0, discord: false, emailed: 0 };

  for (const problem of problems) {
    if (activeKeys.has(problem.alertKey)) continue;
    const [{ id }] = await db.query(`SELECT UUID() AS id`);
    try {
      await db.query(
        `INSERT INTO venue_alerts
           (alertId, venueId, deviceId, courtId, camera, kind, alertKey, message, status,
            firstSeenAt, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`,
        [
          id,
          problem.venueId,
          problem.deviceId,
          problem.courtId,
          problem.camera,
          problem.kind,
          problem.alertKey,
          problem.message,
          now,
          now,
          now,
        ]
      );
      tally.added += 1;
    } catch (err) {
      // Another API process added it first (uq_venue_alerts_active)
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }
  }

  const opened = [];
  const resolved = [];
  for (const row of active) {
    const problem = current.get(row.alertKey);
    if (problem) {
      if (row.status === "Pending" && row.firstSeenAt <= openBefore) {
        const result = await db.query(
          `UPDATE venue_alerts SET status = 'Open', openedAt = ?, message = ?, dateUpdated = ?
           WHERE alertId = ? AND status = 'Pending'`,
          [now, problem.message, now, row.alertId]
        );
        if (result.affectedRows > 0) opened.push({ ...row, message: problem.message });
      } else if (problem.message !== row.message) {
        await db.query(`UPDATE venue_alerts SET message = ?, dateUpdated = ? WHERE alertId = ?`, [
          problem.message,
          now,
          row.alertId,
        ]);
      }
      continue;
    }

    const boxGone = row.deviceId && !knownDevices.has(row.deviceId);
    if (!boxGone && row.kind !== "BOX_OFFLINE" && offlineDevices.has(row.deviceId)) continue;

    if (row.status === "Pending") {
      await db.query(
        `UPDATE venue_alerts SET status = 'Cleared', resolvedAt = ?, dateUpdated = ?
         WHERE alertId = ? AND status = 'Pending'`,
        [now, now, row.alertId]
      );
      tally.cleared += 1;
      continue;
    }
    const result = await db.query(
      `UPDATE venue_alerts SET status = 'Resolved', resolvedAt = ?, dateUpdated = ?
       WHERE alertId = ? AND status = 'Open'`,
      [now, now, row.alertId]
    );
    if (result.affectedRows === 0) continue;
    if (boxGone) tally.cleared += 1;
    else resolved.push(row);
  }
  tally.opened = opened.length;
  tally.resolved = resolved.length;

  if (opened.length > 0 || resolved.length > 0) {
    Object.assign(
      tally,
      await notify(db, { opened, resolved, now, discord, mail, emailEnabled })
    );
  }
  return tally;
};

/** Email alerts need SendGrid (SENDGRID_API_KEY); ALERT_EMAIL=false turns them off. */
export const alertEmailEnabled = () =>
  Boolean(process.env.SENDGRID_API_KEY) &&
  process.env.ALERT_EMAIL !== "false";

/**
 * Staff who get alert emails: Active users with an Active sign-in whose access
 * to `alerts` is read or write — a per-user override first, else their role
 * (the Owner role holds it from migration 019). PLAN-008: only the venue's
 * company's staff — another company never hears about it.
 */
export const alertRecipients = (db, companyId) =>
  db.query(
    `SELECT DISTINCT c.email
     FROM users u
     JOIN credentials c ON c.accountId = u.accountId AND c.status = 'Active'
     JOIN permissions p ON p.module = 'alerts' AND p.submodule IS NULL AND p.status = 'Active'
     LEFT JOIN user_permissions up ON up.accountId = u.accountId AND up.permissionId = p.permissionId
     LEFT JOIN role_permissions rp ON rp.roleId = u.roleId AND rp.permissionId = p.permissionId
     WHERE u.status = 'Active' AND u.companyId = ?
       AND COALESCE(up.accessLevel, rp.accessLevel, 'none') IN ('read', 'write')`,
    [companyId]
  );

const COLOURS = { opened: 0xdc2626, resolved: 0x16a34a };

/** Discord: one message, one embed per item (up to 10; the rest counted in the text). */
export const discordMessage = ({ opened, resolved, dashboardUrl }) => {
  const embed = (item, kind) => ({
    title: `${kind === "opened" ? "🔴" : "✅"} ${item.label} · ${item.venueName}`,
    description: `${item.message}\n${item.since}`,
    color: COLOURS[kind],
    ...(dashboardUrl ? { url: dashboardUrl } : {}),
  });
  const embeds = [
    ...opened.map((item) => embed(item, "opened")),
    ...resolved.map((item) => embed(item, "resolved")),
  ];
  const parts = [];
  if (opened.length > 0) parts.push(`${opened.length} new problem${opened.length === 1 ? "" : "s"}`);
  if (resolved.length > 0) parts.push(`${resolved.length} fixed`);
  const more = embeds.length > 10 ? ` (showing 10 of ${embeds.length} — see the Dashboard)` : "";
  return { content: `${parts.join(", ")}${more}`, embeds: embeds.slice(0, 10) };
};

/**
 * Sends the pass's new problems and fixes on every channel that is set up, and
 * marks the rows notified when at least one channel delivered them.
 */
const notify = async (db, { opened, resolved, now, discord, mail, emailEnabled }) => {
  const venueIds = [...new Set([...opened, ...resolved].map((row) => row.venueId))];
  const venues = await db.query(
    `SELECT venueId, name, companyId FROM venues WHERE venueId IN (${venueIds.map(() => "?").join(", ")})`,
    venueIds
  );
  const venueName = new Map(venues.map((venue) => [venue.venueId, venue.name]));
  const venueCompany = new Map(venues.map((venue) => [venue.venueId, venue.companyId]));
  const item = (row, since) => ({
    label: ALERT_LABELS[row.kind] || row.kind,
    venueName: venueName.get(row.venueId) || "A venue",
    message: row.message,
    since,
  });
  const items = {
    opened: opened.map((row) => item(row, sinceText(row.firstSeenAt, "Since"))),
    resolved: resolved.map((row) => item(row, sinceText(now, "Fixed"))),
  };
  const base = (process.env.FRONTEND_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  const dashboardUrl = /^https?:\/\//.test(base) ? `${base}/admin/dashboard` : undefined;

  const result = { discord: false, emailed: 0 };

  const posted = await discord(discordMessage({ ...items, dashboardUrl }));
  result.discord = Boolean(posted?.sent);
  if (!result.discord && posted?.reason !== "not configured") {
    logger.warn("Venue alerts not posted to Discord", { reason: posted?.reason });
  }

  // PLAN-008: each company's staff get only their own venues' problems
  if (emailEnabled) {
    const companyIds = [...new Set(venues.map((venue) => venue.companyId))];
    for (const companyId of companyIds) {
      const mine = (row) => venueCompany.get(row.venueId) === companyId;
      const companyItems = {
        opened: opened.filter(mine).map((row) => item(row, sinceText(row.firstSeenAt, "Since"))),
        resolved: resolved.filter(mine).map((row) => item(row, sinceText(now, "Fixed"))),
      };
      if (companyItems.opened.length === 0 && companyItems.resolved.length === 0) continue;
      const recipients = await alertRecipients(db, companyId);
      const email = venueAlertsEmail({ ...companyItems, dashboardUrl: dashboardUrl || "" });
      for (const recipient of recipients) {
        const sent = await mail({ to: recipient.email, ...email });
        if (sent?.sent) result.emailed += 1;
      }
    }
  }

  if (!result.discord && result.emailed === 0) {
    logger.warn("Venue alerts reached nobody (set ALERT_DISCORD_WEBHOOK_URL, or SENDGRID_API_KEY for email)", {
      opened: opened.map((row) => row.message),
      resolved: resolved.map((row) => row.message),
    });
    return result;
  }

  const mark = async (column, rows) => {
    if (rows.length === 0) return;
    await db.query(
      `UPDATE venue_alerts SET ${column} = ?, dateUpdated = ?
       WHERE alertId IN (${rows.map(() => "?").join(", ")})`,
      [now, now, ...rows.map((row) => row.alertId)]
    );
  };
  await mark("notifiedAt", opened);
  await mark("resolvedNotifiedAt", resolved);
  return result;
};

/**
 * Runs the venue-alerts pass every minute (never two at once). Off with
 * ALERTS_ENABLED=false.
 */
export const scheduleVenueAlerts = (db, intervalMs = INTERVAL_MS) => {
  if (process.env.ALERTS_ENABLED === "false") {
    logger.info("Venue alerts are off (ALERTS_ENABLED=false)");
    return () => {};
  }
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runVenueAlerts(db)
      .then((tally) => {
        if (tally.added || tally.opened || tally.resolved || tally.cleared) {
          logger.info("Venue alerts", tally);
        }
      })
      .catch((err) => logger.error("Venue alerts failed", { error: err.message }))
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(run, 30 * 1000); // let boxes reconnect after an API restart
  first.unref();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
};
