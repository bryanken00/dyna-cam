/**
 * Recorder boxes from the command line (PLAN-002 Phase I — there is no
 * Recorder Boxes page). Reads DB_* from back/.env.
 *
 *   npm run boxes                         list boxes (venue, name, status, last seen, agent, id)
 *   npm run boxes:revoke -- <name or id>  block a box: it gets 401 at its next request,
 *                                         stops, and won't enrol again by itself
 *
 * A box enrols itself with RECORDER_ENROLL_KEY (POST /api/v1/pair/enroll). After a
 * box is stolen, revoke it AND change RECORDER_ENROLL_KEY (and the other boxes'
 * ENROLL_KEY — enrolled boxes keep working, they don't need the key again).
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import moment from "moment-timezone";

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const ONLINE_SECONDS = 90;

const connect = () =>
  mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    dateStrings: true,
  });

const nowLocal = () => moment().tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");

const ago = (at) => {
  if (!at) return "never";
  const seconds = Math.max(0, moment().diff(moment.tz(at, TIMEZONE), "seconds"));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
};

async function list(db) {
  const [rows] = await db.query(
    `SELECT d.deviceId, d.name, d.status, d.lastSeenAt, d.agentVersion, v.name AS venue
     FROM devices d JOIN venues v ON v.venueId = d.venueId
     WHERE d.status != 'Deleted'
     ORDER BY v.name, d.name`
  );
  if (rows.length === 0) {
    console.log("No recorder boxes yet. A box enrols itself on first start (edge/README.md).");
    return;
  }
  console.table(
    rows.map((row) => {
      const online =
        row.status === "Active" &&
        row.lastSeenAt &&
        moment().diff(moment.tz(row.lastSeenAt, TIMEZONE), "seconds") <= ONLINE_SECONDS;
      return {
        venue: row.venue,
        name: row.name,
        status: row.status === "Active" ? (online ? "online" : "offline") : row.status,
        "last seen": ago(row.lastSeenAt),
        agent: row.agentVersion || "—",
        id: row.deviceId,
      };
    })
  );
}

async function revoke(db, target) {
  if (!target) {
    console.error("Usage: npm run boxes:revoke -- <box name or id>");
    process.exitCode = 1;
    return;
  }
  const [rows] = await db.query(
    `SELECT d.deviceId, d.name, d.status, v.name AS venue
     FROM devices d JOIN venues v ON v.venueId = d.venueId
     WHERE d.deviceId = ? OR (d.name = ? AND d.status = 'Active')`,
    [target, target]
  );
  if (rows.length === 0) {
    console.error(`No active recorder box called or with id "${target}". Run \`npm run boxes\`.`);
    process.exitCode = 1;
    return;
  }
  if (rows.length > 1) {
    console.error(`More than one box is called "${target}" — use its id:`);
    for (const row of rows) console.error(`  ${row.deviceId}  ${row.venue} · ${row.name}`);
    process.exitCode = 1;
    return;
  }
  const box = rows[0];
  if (box.status === "Revoked") {
    console.log(`${box.venue} · ${box.name} is already revoked.`);
    return;
  }
  await db.query(`UPDATE devices SET status = 'Revoked', dateUpdated = ? WHERE deviceId = ?`, [
    nowLocal(),
    box.deviceId,
  ]);
  console.log(
    `Revoked ${box.venue} · ${box.name}. It stops at its next request and won't enrol again ` +
      "until someone deletes data/revoked.json on it. If it was stolen, also change " +
      "RECORDER_ENROLL_KEY."
  );
}

async function main() {
  const [command, target] = process.argv.slice(2);
  const db = await connect();
  try {
    if (command === "revoke") await revoke(db, target);
    else await list(db);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(`boxes: ${err.message}`);
  process.exit(1);
});
