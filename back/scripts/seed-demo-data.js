/**
 * Demo data (PLAN-004) — `npm run db:data`
 *
 * Fills a development database with demo data for the whole system: staff
 * roles and accounts, three venues with courts, opening hours, rates and
 * closures, two weeks of past games, bookings past and future, and their cash
 * and online payments. No video: no clips, saves, game video rows or files.
 *
 * ⚠️  It EMPTIES THE DATABASE first: every table is truncated except
 * `_migrations`, `permissions` and the back office's super admins (PLAN-008).
 * Every company, Owner, staff account, venue, game, clip, booking, payment and
 * audit row is gone, then the demo is loaded: two companies (Smash Point Group,
 * slug "default", and Dink House Inc.), each with its own Owner. Re-run it any time for a fresh
 * demo. Video files on disk are not deleted. Refuses NODE_ENV=production.
 *
 * Usage:
 *   npm run db:data
 *
 * Env (optional):
 *   DEMO_PASSWORD   password for every demo login — Owners and staff (default: random, printed once)
 *
 * Run `npm run db:setup` first (schema, permissions, the first super admin).
 */

import "dotenv/config";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import argon2 from "argon2";
import moment from "moment-timezone";

import { passwordProblem } from "../server/src/utils/passwordPolicy.js";
import { encryptSecret } from "../server/src/utils/crypto/secretBox.js";
import { randomPayCode, randomToken } from "../server/src/utils/crypto/tokens.js";

const TZ = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const DAYS_OF_HISTORY = 14;
const PLAYER_MAX_CAPTURES = 5; // court-QR and booked games (CR-027 / PLAN-003)

const EMAIL_DOMAIN = "demo.dynacam.test";
const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// What gets seeded
// ---------------------------------------------------------------------------

const ROLES = [
  {
    roleName: "Venue Manager",
    description: "Runs a venue: courts, cameras, bookings, games and payments.",
    grants: [
      ["dashboard", null, "read"],
      ["venues", "list", "write"],
      ["venues", "courts", "write"],
      ["bookings", null, "write"],
      ["clips", null, "write"],
      ["payments", null, "write"],
      ["alerts", null, "read"],
      ["users", "list", "read"],
      ["audit_trail", null, "read"],
    ],
  },
  {
    roleName: "Front Desk",
    description: "Takes bookings and cash, starts and pairs games.",
    grants: [
      ["dashboard", null, "read"],
      ["venues", "list", "read"],
      ["venues", "courts", "read"],
      ["bookings", null, "write"],
      ["clips", null, "write"],
      ["payments", null, "write"],
    ],
  },
  {
    roleName: "Bookkeeper",
    description: "Reads payments and bookings for the books.",
    grants: [
      ["dashboard", null, "read"],
      ["bookings", null, "read"],
      ["payments", null, "read"],
    ],
  },
];

const STAFF = [
  {
    key: "manager",
    firstName: "Maria",
    lastName: "Santos",
    role: "Venue Manager",
    phone: "0917 4521 336",
  },
  {
    key: "desk1",
    firstName: "Paolo",
    lastName: "Reyes",
    role: "Front Desk",
    phone: "0918 2207 145",
  },
  // A per-user override: this desk account can see payments but not take them
  {
    key: "desk2",
    firstName: "Angela",
    lastName: "Cruz",
    role: "Front Desk",
    phone: "0920 8813 502",
    override: ["payments", null, "read"],
  },
  { key: "books", firstName: "Ramon", lastName: "Dizon", role: "Bookkeeper", phone: null },
  {
    key: "former",
    firstName: "Jessa",
    lastName: "Lim",
    role: "Front Desk",
    phone: "0927 3390 618",
    status: "Inactive",
  },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const CAMERA = (n) => `rtsp://admin:demo1234@192.168.10.${n}:554/Streaming/Channels/101`;

// Demo bookings run this many days ahead (players can book any day — CR-048)
const DEMO_DAYS_AHEAD = 14;

const VENUES = [
  {
    key: "bgc",
    name: "Smash Point Pickleball — BGC",
    address: "32nd St cor. 9th Ave, Bonifacio Global City, Taguig",
    phone: "0917 5550 101",
    clipPrice: 150,
    onlineBooking: true,
    rules: {
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
    },
    hours: { weekday: [6, 23], weekend: [6, 24] },
    courts: [
      { key: "c1", name: "Court 1", cameras: 2, stream: true },
      { key: "c2", name: "Court 2", cameras: 2 },
      { key: "c3", name: "Court 3", cameras: 1 },
      { key: "c4", name: "Court 4", cameras: 1 },
    ],
    rates: [
      { name: "Off-peak", days: ALL_DAYS, start: 6, end: 17, price: 400 },
      { name: "Peak", days: WEEKDAYS, start: 17, end: 23, price: 600 },
      { name: "Weekend peak", days: WEEKEND, start: 17, end: 24, price: 700 },
    ],
    gamesPerCourtPerDay: [1, 4],
  },
  {
    key: "cebu",
    name: "Dink House Cebu",
    address: "Salinas Drive, Lahug, Cebu City",
    phone: "0932 4410 288",
    clipPrice: 120,
    onlineBooking: true,
    rules: {
      deskHoldMinutes: 60,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 12,
      checkInEarlyMinutes: 15,
    },
    hours: { weekday: [7, 22], weekend: [7, 22] },
    courts: [
      { key: "c1", name: "Court A", cameras: 1 },
      { key: "c2", name: "Court B", cameras: 1 },
      { key: "c3", name: "Center Court", cameras: 2 },
    ],
    rates: [
      { name: "Standard", days: ALL_DAYS, start: 7, end: 22, price: 350 },
      { name: "Center Court", court: "c3", days: ALL_DAYS, start: 7, end: 22, price: 500 },
    ],
    gamesPerCourtPerDay: [1, 3],
  },
  {
    key: "alabang",
    name: "Kitchen Line Pickleball — Alabang",
    address: "Madrigal Business Park, Alabang, Muntinlupa",
    phone: null,
    clipPrice: 100,
    onlineBooking: false, // booking link off: desk bookings only
    rules: {
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
    },
    hours: { weekday: [8, 21], weekend: [7, 22] },
    courts: [
      { key: "c1", name: "Court 1", cameras: 1 },
      { key: "c2", name: "Court 2", cameras: 1 },
      { key: "c3", name: "Court 3 (under repair)", cameras: 0, status: "Inactive" },
    ],
    rates: [{ name: "Flat rate", days: ALL_DAYS, start: 7, end: 22, price: 300 }],
    gamesPerCourtPerDay: [0, 2],
  },
];

const PLAYERS = [
  "Miguel Bautista",
  "Andrea Villanueva",
  "Carlo Mendoza",
  "Bea Navarro",
  "Josh Tan",
  "Kim Aquino",
  "Rafael Garcia",
  "Trish Ramos",
  "Enzo Castillo",
  "Nicole Fernandez",
  "Gab Torres",
  "Patricia Uy",
  "Marco Flores",
  "Denise Gonzales",
  "Luis Pascual",
  "Sam Chua",
  "Iya Morales",
  "Jerome Ocampo",
  "Claire Domingo",
  "Vince Salazar",
  "Hannah Lopez",
  "Rico De Leon",
  "Mika Sy",
  "Paulo Manalo",
  "Erika Javier",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG (mulberry32) — the same mix of demo rows on every run. */
const rng = (() => {
  let seed = 20261123;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (list) => list[Math.floor(rng() * list.length)];
const chance = (p) => rng() < p;

const NOW = moment().tz(TZ);
const fmt = (m) => m.clone().tz(TZ).format(FORMAT);
const nowText = fmt(NOW);
const atHour = (dayOffset, hour, minute = 0) =>
  NOW.clone().startOf("day").add(dayOffset, "days").add(hour, "hours").add(minute, "minutes");
/** The earlier of a time and now (a row can't have been written in the future). */
const notAfterNow = (m) => fmt(moment.min(m, NOW));

const phoneNumber = () =>
  `09${randInt(15, 99)} ${String(randInt(0, 9999)).padStart(4, "0")} ${String(randInt(0, 999)).padStart(3, "0")}`;
const emailOf = (name) =>
  `${name
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim()
    .replace(/\s+/g, ".")}@example.com`;
const staffEmail = (person) =>
  `${person.firstName}.${person.lastName}@${EMAIL_DOMAIN}`.toLowerCase();

const hashPassword = (password) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 3, parallelism: 1 });

function demoPassword() {
  const fromEnv = process.env.DEMO_PASSWORD;
  if (!fromEnv) return { password: crypto.randomBytes(12).toString("base64url"), generated: true };
  if (fromEnv.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`DEMO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  for (const person of STAFF) {
    const problem = passwordProblem(fromEnv, { email: staffEmail(person) });
    if (problem) throw new Error(`DEMO_PASSWORD refused: ${problem}`);
  }
  return { password: fromEnv, generated: false };
}

/** INSERT one row from an object (column names are this file's constants). */
async function insert(conn, table, row) {
  const columns = Object.keys(row);
  await conn.execute(
    `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
    columns.map((c) => (row[c] === undefined ? null : row[c]))
  );
}

async function uuid(conn) {
  const [rows] = await conn.execute(`SELECT UUID() AS id`);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Emptying the database first
// ---------------------------------------------------------------------------

/** Kept whole: which migrations ran, and the permission set from `db:setup`. */
// PLAN-008: the back office's super admins stay too (DGSports' own accounts, not demo data)
const KEEP_TABLES = new Set(["_migrations", "permissions", "platform_admins", "platform_admin_refresh_tokens"]);

/**
 * PLAN-008: the two demo companies, each with its own Owner (setup makes no company or
 * Owner — the back office onboards them; the demo does it here). The first has slug
 * "default", so it may use the .env Xendit keys in development (utils/companyPayments.js);
 * it owns the staff below and every venue but Dink House Cebu.
 */
const FIRST_COMPANY = {
  name: "Smash Point Group",
  slug: "default",
  owner: { firstName: "Carmela", lastName: "Ortiz" },
};
const SECOND_COMPANY = {
  name: "Dink House Inc.",
  slug: "dink-house",
  owner: { firstName: "Paolo", lastName: "Mendoza" },
};

/**
 * Empty every table but the ones above. TRUNCATE commits on its own, so this
 * runs before the seeding transaction: if seeding then fails, the database is
 * left empty (run it again).
 *
 * @returns {Promise<{ rows: number, videoRows: number }>} rows removed, and how
 *   many of them pointed at video files (the files stay on disk)
 */
async function truncateDatabase(conn) {
  const [tables] = await conn.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );

  const [[video]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM clips WHERE videoPath IS NOT NULL)
          + (SELECT COUNT(*) FROM session_videos WHERE videoPath IS NOT NULL) AS n`
  );

  let rows = 0;
  await conn.query(`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    for (const { name } of tables) {
      if (KEEP_TABLES.has(name)) continue;
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      rows += Number(n);
      await conn.query(`TRUNCATE TABLE \`${name}\``);
    }
  } finally {
    await conn.query(`SET FOREIGN_KEY_CHECKS = 1`);
  }
  return { rows, videoRows: Number(video.n) };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const tally = {
  companies: 0,
  roles: 0,
  staff: 0,
  venues: 0,
  courts: 0,
  rates: 0,
  closures: 0,
  games: 0,
  bookings: 0,
  payments: 0,
  audit: 0,
};

/** Codes handed out this run (bookingCode / payCode are UNIQUE). */
const usedCodes = new Set();
const freshCode = () => {
  for (;;) {
    const code = randomPayCode();
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
};

/** One demo company and its Owner (every permission, the demo password, no forced change). */
async function seedCompany(conn, password, { name, slug, owner }) {
  const created = fmt(NOW.clone().subtract(50, "days"));
  const companyId = await uuid(conn);
  await insert(conn, "companies", {
    companyId,
    name,
    slug,
    contactEmail: `hello@${slug}.${EMAIL_DOMAIN}`,
    status: "Active",
    dateCreated: created,
    dateUpdated: created,
  });
  const roleId = await uuid(conn);
  await insert(conn, "roles", {
    roleId,
    companyId,
    roleName: "Owner",
    description: "Full access owner role. Not visible in Admin portal.",
    status: "Active",
    dateCreated: created,
    dateUpdated: created,
  });
  await conn.query(
    `INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
     SELECT ?, permissionId, 'write', ? FROM permissions WHERE status = 'Active'`,
    [roleId, created]
  );
  const accountId = await uuid(conn);
  await insert(conn, "users", {
    accountId,
    companyId,
    firstName: owner.firstName,
    lastName: owner.lastName,
    roleId,
    status: "Active",
    dateCreated: created,
    dateUpdated: created,
  });
  const email = staffEmail(owner);
  await insert(conn, "credentials", {
    accountId,
    email,
    password: await hashPassword(password),
    type: "ADMIN",
    status: "Active",
    // The person running the demo uses these logins themselves
    mustChangePassword: 0,
    dateCreated: created,
    dateUpdated: created,
  });
  tally.companies += 1;
  return { companyId, ownerEmail: email, ownerAccountId: accountId };
}

/** PLAN-008: both demo companies → { defaultId, secondId, firstOwner, secondOwner, secondOwnerAccountId } */
async function seedCompanies(conn, password) {
  const first = await seedCompany(conn, password, FIRST_COMPANY);
  const second = await seedCompany(conn, password, SECOND_COMPANY);
  return {
    defaultId: first.companyId,
    firstOwner: first.ownerEmail,
    secondId: second.companyId,
    secondOwner: second.ownerEmail,
    secondOwnerAccountId: second.ownerAccountId,
  };
}

/**
 * The seeders pick desk staff from the default company; at the second company's venue
 * its own Owner made those rows (no company sees another company's staff).
 */
async function attributeSecondCompany(conn, companies) {
  const venueRows = `(SELECT venueId FROM venues WHERE companyId = ?)`;
  const columns = [
    ["court_closures", "createdByAccountId"],
    ["recording_sessions", "createdByAccountId"],
    ["bookings", "createdByAccountId"],
    ["payments", "receivedByAccountId"],
    ["payments", "refundedByAccountId"],
  ];
  for (const [table, column] of columns) {
    await conn.query(
      `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` IS NOT NULL AND venueId IN ${venueRows}`,
      [companies.secondOwnerAccountId, companies.secondId]
    );
  }
}

async function seedRolesAndStaff(conn, password, companyId) {
  const [perms] = await conn.query(
    `SELECT permissionId, module, submodule FROM permissions WHERE status = 'Active'`
  );
  const permissionId = (module, submodule) =>
    perms.find((p) => p.module === module && (p.submodule ?? null) === submodule)?.permissionId;

  const roleIds = {};
  for (const role of ROLES) {
    const roleId = await uuid(conn);
    roleIds[role.roleName] = roleId;
    await insert(conn, "roles", {
      roleId,
      companyId,
      roleName: role.roleName,
      description: role.description,
      status: "Active",
      dateCreated: fmt(NOW.clone().subtract(60, "days")),
      dateUpdated: fmt(NOW.clone().subtract(60, "days")),
    });
    for (const [module, submodule, accessLevel] of role.grants) {
      const id = permissionId(module, submodule);
      if (!id) continue; // a permission this database doesn't have
      await insert(conn, "role_permissions", {
        roleId,
        permissionId: id,
        accessLevel,
        dateCreated: fmt(NOW.clone().subtract(60, "days")),
      });
    }
    tally.roles += 1;
  }

  const staff = {};
  for (const person of STAFF) {
    const accountId = await uuid(conn);
    const created = fmt(NOW.clone().subtract(randInt(20, 55), "days"));
    const status = person.status || "Active";
    await insert(conn, "users", {
      accountId,
      companyId,
      firstName: person.firstName,
      lastName: person.lastName,
      phone: person.phone,
      roleId: roleIds[person.role],
      status,
      dateCreated: created,
      dateUpdated: created,
    });
    await insert(conn, "credentials", {
      accountId,
      email: staffEmail(person),
      password: await hashPassword(password),
      type: "ADMIN",
      status,
      // The person running the demo uses these logins themselves
      mustChangePassword: 0,
      dateCreated: created,
      dateUpdated: created,
    });
    if (person.override) {
      const [module, submodule, accessLevel] = person.override;
      const id = permissionId(module, submodule);
      if (id) {
        await insert(conn, "user_permissions", {
          userPermissionId: await uuid(conn),
          accountId,
          permissionId: id,
          accessLevel,
          dateCreated: created,
        });
      }
    }
    staff[person.key] = { accountId, ...person, email: staffEmail(person) };
    tally.staff += 1;
  }
  return staff;
}

/** Opening hours of a venue on a day of the week: [opensHour, closesHour]. */
const hoursOn = (venue, dayOfWeek) =>
  WEEKEND.includes(dayOfWeek) ? venue.hours.weekend : venue.hours.weekday;

/** A court's own rate beats a venue-wide one (utils/bookingPrice.js). */
const rateFor = (venue, courtKey, dayOfWeek, hour) => {
  const covers = (r) => r.days.includes(dayOfWeek) && hour >= r.start && hour < r.end;
  return (
    venue.rates.find((r) => r.court === courtKey && covers(r)) ||
    venue.rates.find((r) => !r.court && covers(r)) ||
    null
  );
};

/** Price of a whole-hour booking, or null when an hour has no rate. */
const priceFor = (venue, courtKey, start, hours) => {
  let total = 0;
  for (let i = 0; i < hours; i += 1) {
    const hourStart = start.clone().add(i, "hours");
    const rate = rateFor(venue, courtKey, hourStart.day(), hourStart.hours());
    if (!rate) return null;
    total += rate.price;
  }
  return total;
};

async function seedVenues(conn, companies) {
  const created = NOW.clone().subtract(45, "days");
  for (const venue of VENUES) {
    venue.venueId = await uuid(conn);
    await insert(conn, "venues", {
      venueId: venue.venueId,
      // PLAN-008: Dink House Cebu belongs to the second company
      companyId: venue.key === "cebu" ? companies.secondId : companies.defaultId,
      name: venue.name,
      address: venue.address,
      phone: venue.phone,
      clipRetentionDays: 7,
      clipPrice: venue.clipPrice,
      bookingToken: venue.onlineBooking ? randomToken() : null,
      ...venue.rules,
      status: "Active",
      dateCreated: fmt(created),
      dateUpdated: fmt(created),
    });
    tally.venues += 1;

    let cameraNumber = 60;
    for (const court of venue.courts) {
      court.courtId = await uuid(conn);
      court.busy = []; // [startText, endText] — games, live bookings, closures
      await insert(conn, "courts", {
        courtId: court.courtId,
        venueId: venue.venueId,
        name: court.name,
        cameraRtspUrl: court.cameras >= 1 ? encryptSecret(CAMERA((cameraNumber += 1))) : null,
        camera2RtspUrl: court.cameras >= 2 ? encryptSecret(CAMERA((cameraNumber += 1))) : null,
        qrToken: randomToken(),
        streamEnabled: 0,
        streamWatchUrl: court.stream ? "https://www.youtube.com/@smashpointbgc/live" : null,
        streamLayout: court.cameras >= 2 ? "STACKED" : "CAM1",
        status: court.status || "Active",
        dateCreated: fmt(created),
        dateUpdated: fmt(created),
      });
      tally.courts += 1;
    }
    venue.activeCourts = venue.courts.filter((c) => (c.status || "Active") === "Active");

    for (const dayOfWeek of ALL_DAYS) {
      const [opens, closes] = hoursOn(venue, dayOfWeek);
      await insert(conn, "venue_hours", {
        venueHourId: await uuid(conn),
        venueId: venue.venueId,
        dayOfWeek,
        opensAt: `${String(opens).padStart(2, "0")}:00:00`,
        closesAt: `${String(closes).padStart(2, "0")}:00:00`,
        status: "Active",
        dateCreated: fmt(created),
        dateUpdated: fmt(created),
      });
    }

    for (const rate of venue.rates) {
      await insert(conn, "court_rates", {
        rateId: await uuid(conn),
        venueId: venue.venueId,
        courtId: rate.court ? venue.courts.find((c) => c.key === rate.court).courtId : null,
        name: rate.name,
        daysOfWeek: [...rate.days].sort((a, b) => a - b).join(","),
        startTime: `${String(rate.start).padStart(2, "0")}:00:00`,
        endTime: `${String(rate.end).padStart(2, "0")}:00:00`,
        pricePerHour: rate.price,
        status: "Active",
        dateCreated: fmt(created),
        dateUpdated: fmt(created),
      });
      tally.rates += 1;
    }
  }
}

const overlaps = (busy, start, end) => busy.some(([s, e]) => s < end && start < e);

async function seedClosures(conn, staff) {
  const [bgc, cebu, alabang] = VENUES;
  const closures = [
    // Past, whole venue
    { venue: alabang, court: null, day: -9, from: 7, to: 12, reason: "Floor cleaning" },
    // Upcoming, one court
    { venue: bgc, court: bgc.courts[2], day: 3, from: 6, to: 12, reason: "Court resurfacing" },
    // Upcoming, whole venue
    { venue: cebu, court: null, day: 6, from: 7, to: 22, reason: "Private tournament" },
  ];
  for (const c of closures) {
    const start = fmt(atHour(c.day, c.from));
    const end = fmt(atHour(c.day, c.to));
    const createdAt = notAfterNow(atHour(c.day, 0).subtract(5, "days"));
    await insert(conn, "court_closures", {
      closureId: await uuid(conn),
      venueId: c.venue.venueId,
      courtId: c.court?.courtId || null,
      startAt: start,
      endAt: end,
      reason: c.reason,
      createdByAccountId: staff.manager.accountId,
      status: "Active",
      dateCreated: createdAt,
      dateUpdated: createdAt,
    });
    for (const court of c.court ? [c.court] : c.venue.courts) court.busy.push([start, end]);
    tally.closures += 1;
  }
}

/**
 * A free slot on a court on a day: whole hours inside opening hours, not
 * overlapping anything already placed. `when` limits it to the past (ended
 * before now) or the future (starting at least an hour from now).
 */
function findSlot(venue, court, dayOffset, hours, when, { halfHours = false } = {}) {
  const dayOfWeek = atHour(dayOffset, 0).day();
  const [opens, closes] = hoursOn(venue, dayOfWeek);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const startHour = randInt(opens, closes - Math.ceil(hours));
    const minute = halfHours && chance(0.3) ? 30 : 0;
    const start = atHour(dayOffset, startHour, minute);
    const end = start.clone().add(hours * 60, "minutes");
    if (end.isAfter(atHour(dayOffset, closes))) continue;
    if (when === "past" && !end.isBefore(NOW.clone().subtract(5, "minutes"))) continue;
    if (when === "future" && !start.isAfter(NOW.clone().add(1, "hour"))) continue;
    const s = fmt(start);
    const e = fmt(end);
    if (overlaps(court.busy, s, e)) continue;
    court.busy.push([s, e]);
    return { start, end, startText: s, endText: e };
  }
  return null;
}

const deskStaff = (staff) => [staff.manager, staff.desk1, staff.desk2];

async function insertPayment(conn, row) {
  const at = row.paidAt;
  await insert(conn, "payments", {
    paymentId: await uuid(conn),
    status: "Paid",
    method: "CASH",
    dateCreated: at,
    dateUpdated: row.refundedAt || at,
    ...row,
  });
  tally.payments += 1;
}

async function insertGame(conn, venue, court, slot, game) {
  const sessionId = await uuid(conn);
  const created = notAfterNow(slot.start.clone().subtract(game.leadMinutes ?? 2, "minutes"));
  const settled = notAfterNow(slot.end.clone().add(4, "minutes"));
  await insert(conn, "recording_sessions", {
    sessionId,
    venueId: venue.venueId,
    courtId: court.courtId,
    startAt: slot.startText,
    endAt: slot.endText,
    playerName: game.playerName || null,
    phone: game.phone || null,
    email: game.email || null,
    shareToken: randomToken(),
    createdByAccountId: game.createdByAccountId || null,
    startedByPlayer: game.startedByPlayer ? 1 : 0,
    bookingId: game.bookingId || null,
    maxCaptures: game.maxCaptures ?? null,
    failureReason: game.failureReason || null,
    wholeVideo: game.status === "Cancelled" ? null : "Done",
    status: game.status,
    paymentStatus: game.paymentStatus,
    payCode: game.payCode || null,
    dateCreated: created,
    dateUpdated: game.status === "Cancelled" ? created : settled,
  });
  tally.games += 1;
  return sessionId;
}

/** Why a past game is missing footage, if it is. */
function gameFailure(status, court, slot) {
  if (status === "Failed") return "None of the game could be recorded";
  if (status !== "Ready" || court.cameras !== 2 || !chance(0.08)) return null;
  const from = slot.start.clone().add(20, "minutes").format("h:mm");
  const to = slot.start.clone().add(23, "minutes").format("h:mm A");
  return `Cam 2: 3 minutes weren't recorded (${from} – ${to})`;
}

/** One walk-in game: a court-QR game (free) or a desk game (pay code, maybe cash). */
async function insertWalkInGame(conn, { staff, venue, court, slot, day }) {
  const roll = rng();
  const status = roll < 0.06 ? "Failed" : roll < 0.13 ? "Cancelled" : "Ready";
  const failureReason = gameFailure(status, court, slot);
  const name = pick(PLAYERS);

  if (chance(0.4)) {
    // CR-027: a player scanned the court QR — free, 5 saves
    await insertGame(conn, venue, court, slot, {
      status,
      failureReason,
      startedByPlayer: true,
      playerName: chance(0.6) ? name.split(" ")[0] : null,
      email: chance(0.3) ? emailOf(name) : null,
      maxCaptures: PLAYER_MAX_CAPTURES,
      paymentStatus: "Free",
      leadMinutes: 0,
    });
    return;
  }

  // A game staff started at the desk: a pay code, cash at the desk (the last
  // two days still have a few waiting to be paid)
  const desk = pick(deskStaff(staff));
  const comped = status !== "Cancelled" && chance(0.05);
  const paid = !comped && status === "Ready" && (day < -2 || chance(0.6));
  const sessionId = await insertGame(conn, venue, court, slot, {
    status,
    failureReason,
    createdByAccountId: desk.accountId,
    playerName: name,
    phone: chance(0.7) ? phoneNumber() : null,
    email: chance(0.4) ? emailOf(name) : null,
    paymentStatus: comped ? "Free" : paid ? "Paid" : "Unpaid",
    payCode: comped ? null : freshCode(),
    leadMinutes: randInt(1, 30),
  });
  if (paid) {
    await insertPayment(conn, {
      sessionId,
      venueId: venue.venueId,
      amount: venue.clipPrice,
      receivedByAccountId: desk.accountId,
      note: chance(0.15) ? "GCash to the desk phone" : null,
      paidAt: notAfterNow(slot.end.clone().add(randInt(3, 40), "minutes")),
    });
  }
}

/** Two weeks of walk-in games: staff-made (cash) and court-QR (free). */
async function seedPastGames(conn, staff) {
  for (const venue of VENUES) {
    for (let day = -DAYS_OF_HISTORY; day <= 0; day += 1) {
      for (const court of venue.activeCourts) {
        const count = randInt(...venue.gamesPerCourtPerDay);
        for (let i = 0; i < count; i += 1) {
          const hours = pick([1, 1, 1.5, 2]);
          const slot = findSlot(venue, court, day, hours, "past", { halfHours: true });
          if (slot) await insertWalkInGame(conn, { staff, venue, court, slot, day });
        }
      }
    }
  }
}

/**
 * Bookings, past and future, with their payments — and for the ones that were
 * played, the game check-in made.
 */
async function seedBookings(conn, staff) {
  const PAST = [
    ["Completed", 0.45],
    ["NoShow", 0.1],
    ["CancelledPlayer", 0.15],
    ["CancelledStaff", 0.1],
    ["Expired", 0.2],
  ];
  const FUTURE = [
    ["ConfirmedCash", 0.3],
    ["ConfirmedOnline", 0.3],
    ["ConfirmedFree", 0.08],
    ["Hold", 0.22],
    ["Moved", 0.1],
  ];
  const draw = (table) => {
    let roll = rng();
    for (const [kind, weight] of table) {
      roll -= weight;
      if (roll < 0) return kind;
    }
    return table[0][0];
  };

  for (const venue of VENUES) {
    const perDay = venue.onlineBooking ? [1, 3] : [0, 1];
    for (let day = -10; day <= DEMO_DAYS_AHEAD - 1; day += 1) {
      const count = randInt(...perDay);
      for (let i = 0; i < count; i += 1) {
        const court = pick(venue.activeCourts);
        const hours = pick([1, 1, 2]);
        const future = day > 0 || (day === 0 && chance(0.5));
        const slot = findSlot(venue, court, day, hours, future ? "future" : "past");
        if (!slot) continue;
        const price = priceFor(venue, court.key, slot.start, hours);
        if (price === null) continue;
        await insertBooking(conn, {
          staff,
          venue,
          court,
          slot,
          price,
          kind: draw(future ? FUTURE : PAST),
        });
      }
    }
  }

  // Always show one "Refund failed" (Admin → Bookings / Payments)
  const bgc = VENUES[0];
  const court = bgc.activeCourts[1];
  const slot = findSlot(bgc, court, 5, 1, "future");
  if (slot) {
    await insertBooking(conn, {
      staff,
      venue: bgc,
      court,
      slot,
      price: priceFor(bgc, court.key, slot.start, 1),
      kind: "RefundFailed",
    });
  }
}

const ONLINE_KINDS = ["ConfirmedOnline", "CancelledPlayer", "RefundFailed"];
const CANCELLED_KINDS = ["CancelledPlayer", "CancelledStaff", "RefundFailed"];

/** The kind the app could really produce here. */
function possibleKind(venue, slot, wanted) {
  // Without online booking there's no online payment, and a player can't
  // cancel a cash booking themselves — staff do
  if (!venue.onlineBooking && ONLINE_KINDS.includes(wanted)) {
    return wanted === "ConfirmedOnline" ? "ConfirmedCash" : "CancelledStaff";
  }
  // A desk hold runs out deskHoldMinutes before the start: too close → paid at the desk
  const holdEnds = slot.start.clone().subtract(venue.rules.deskHoldMinutes + 10, "minutes");
  if (wanted === "Hold" && !holdEnds.isAfter(NOW)) return "ConfirmedCash";
  return wanted;
}

/** Status, payment status and cancel details for a kind. */
function bookingOutcome({ kind, free, createdAt }) {
  if (kind === "Hold") return { status: "Pending", paymentStatus: "Unpaid" };
  if (kind === "Expired") return { status: "Expired", paymentStatus: "Unpaid" };
  const paymentStatus = free ? "Free" : "Paid";
  if (kind === "NoShow" || kind === "Completed") return { status: kind, paymentStatus };
  if (!CANCELLED_KINDS.includes(kind)) return { status: "Confirmed", paymentStatus };

  const byStaff = kind === "CancelledStaff";
  return {
    status: "Cancelled",
    // A failed refund leaves the money with Dyna Cam: still Paid
    paymentStatus: free || kind === "RefundFailed" ? paymentStatus : "Refunded",
    cancelledAt: notAfterNow(createdAt.clone().add(randInt(2, 20), "hours")),
    cancelledBy: byStaff ? "Staff" : "Player",
    cancelReason: byStaff
      ? pick(["Rain leak over the court", "Asked by phone", "Double booking at the desk"])
      : null,
  };
}

/**
 * The email columns, as if the app had sent them. Played or missed: reminded on
 * time. Upcoming: the reminder is claimed now, so the booking job never emails
 * a demo player (their addresses are @example.com).
 */
function emailMarks({ email, outcome, createdAt, slot }) {
  if (!email) return {};
  const { status, cancelledAt } = outcome;
  const sentOnBooking = notAfterNow(createdAt.clone().add(1, "minute"));
  const reminderTime = slot.start.clone().subtract(120, "minutes");
  let reminderSentAt = null;
  if (status === "Confirmed") reminderSentAt = sentOnBooking;
  if (["Completed", "NoShow"].includes(status) && reminderTime.isAfter(createdAt)) {
    reminderSentAt = fmt(reminderTime);
  }
  return {
    confirmationSentAt: status === "Pending" || status === "Expired" ? null : sentOnBooking,
    reminderSentAt,
    cancelledEmailSentAt: status === "Cancelled" ? cancelledAt : null,
  };
}

/** When the row was last changed. */
function lastUpdated({ outcome, created, holdExpiresAt, slot }) {
  if (outcome.cancelledAt) return outcome.cancelledAt;
  if (outcome.status === "Expired") return holdExpiresAt;
  if (outcome.status === "Confirmed" || outcome.status === "Pending") return created;
  return notAfterNow(slot.end);
}

/** The booking's payment: cash at the desk or a Xendit invoice, maybe refunded. */
async function insertBookingPayment(conn, b) {
  const refunded = b.outcome.paymentStatus === "Refunded";
  await insertPayment(conn, {
    bookingId: b.bookingId,
    venueId: b.venue.venueId,
    amount: b.price,
    method: b.payOnline ? "ONLINE" : "CASH",
    provider: b.payOnline ? "xendit" : null,
    providerRef: b.payOnline ? `inv_demo_${randomToken(9)}` : null,
    providerRefundRef: refunded && b.payOnline ? `rfd_demo_${randomToken(9)}` : null,
    refundError:
      b.kind === "RefundFailed"
        ? "Xendit refused the refund: the payment channel doesn't allow refunds"
        : null,
    receivedByAccountId: b.payOnline ? null : b.desk.accountId,
    status: refunded ? "Refunded" : "Paid",
    paidAt: notAfterNow(b.createdAt.clone().add(randInt(b.payOnline ? 1 : 0, 6), "minutes")),
    refundedAt: refunded ? b.outcome.cancelledAt : null,
    refundedByAccountId: refunded && b.outcome.cancelledBy === "Staff" ? b.desk.accountId : null,
  });
}

async function insertBooking(conn, { staff, venue, court, slot, price, kind: wanted }) {
  const kind = possibleKind(venue, slot, wanted);
  const name = pick(PLAYERS);
  const desk = pick(deskStaff(staff));
  const payOnline = ONLINE_KINDS.includes(kind);
  // Booked on the venue's booking link (paid online, or "pay at the desk"), or by staff
  const online =
    payOnline ||
    (venue.onlineBooking && !["ConfirmedCash", "ConfirmedFree"].includes(kind) && chance(0.5));
  const free = kind === "ConfirmedFree" || price === 0;
  const hold = kind === "Hold" || kind === "Expired";

  // When it was made: 1–6 days before it starts, never in the future
  const createdAt = moment.min(
    slot.start.clone().subtract(randInt(1, 6), "days").add(randInt(0, 10), "hours"),
    NOW.clone().subtract(randInt(10, 300), "minutes")
  );
  const created = fmt(createdAt);
  const holdExpiresAt = hold
    ? fmt(slot.start.clone().subtract(venue.rules.deskHoldMinutes, "minutes"))
    : null;

  // A desk hold is usually phoned in: a phone, no email (no "released" email to send)
  let email = null;
  if (!hold && (online || chance(0.6))) email = emailOf(name);
  const phone = hold || chance(0.6) ? phoneNumber() : null;
  const outcome = bookingOutcome({ kind, free, createdAt });

  const bookingId = await uuid(conn);
  await insert(conn, "bookings", {
    bookingId,
    venueId: venue.venueId,
    courtId: court.courtId,
    startAt: slot.startText,
    endAt: slot.endText,
    playerName: name,
    phone,
    email,
    price: free ? 0 : price,
    paymentStatus: outcome.paymentStatus,
    payMethod: payOnline ? "Online" : "Desk",
    source: online ? "Online" : "Desk",
    bookingCode: freshCode(),
    manageToken: randomToken(),
    holdExpiresAt,
    rescheduledCount: kind === "Moved" ? 1 : 0,
    cancelledAt: outcome.cancelledAt || null,
    cancelledBy: outcome.cancelledBy || null,
    cancelReason: outcome.cancelReason || null,
    ...emailMarks({ email, outcome, createdAt, slot }),
    createdByAccountId: online ? null : desk.accountId,
    status: outcome.status,
    dateCreated: created,
    dateUpdated: lastUpdated({ outcome, created, holdExpiresAt, slot }),
  });
  tally.bookings += 1;

  // Cancelled / expired bookings free their slot again
  if (["Cancelled", "Expired"].includes(outcome.status)) {
    court.busy = court.busy.filter(([s, e]) => !(s === slot.startText && e === slot.endText));
  }

  if (!free && !hold) {
    await insertBookingPayment(conn, {
      bookingId,
      venue,
      price,
      payOnline,
      kind,
      desk,
      createdAt,
      outcome,
    });
  }

  // Played: the check-in made its game (free, 5 saves), now settled
  if (outcome.status === "Completed") {
    const sessionId = await insertGame(conn, venue, court, slot, {
      status: "Ready",
      createdByAccountId: chance(0.5) ? desk.accountId : null,
      bookingId,
      playerName: name,
      phone,
      email,
      maxCaptures: PLAYER_MAX_CAPTURES,
      paymentStatus: "Free",
      leadMinutes: randInt(0, 10),
    });
    await conn.execute(`UPDATE bookings SET sessionId = ? WHERE bookingId = ?`, [
      sessionId,
      bookingId,
    ]);
  }
}

async function seedAuditTrail(conn, staff, companyId) {
  const entries = [
    [staff.manager, "UPDATE", "venues", 13, "/api/v1/admin/venues"],
    [staff.manager, "CREATE", "courts", 12, "/api/v1/admin/courts"],
    [staff.manager, "UPDATE", "booking-settings", 11, "/api/v1/admin/booking-settings"],
    [staff.manager, "CREATE", "closures", 6, "/api/v1/admin/closures"],
    [staff.desk1, "CREATE", "sessions", 4, "/api/v1/admin/sessions"],
    [staff.desk1, "CREATE", "payments", 4, "/api/v1/admin/payments"],
    [staff.desk2, "CREATE", "bookings", 3, "/api/v1/admin/bookings"],
    [staff.desk1, "UPDATE", "bookings", 2, "/api/v1/admin/bookings"],
    [staff.desk2, "CREATE", "sessions", 1, "/api/v1/admin/sessions"],
    [staff.desk1, "CREATE", "payments", 0, "/api/v1/admin/payments"],
  ];
  for (const [who, action, module, daysAgo, path] of entries) {
    const at = notAfterNow(
      NOW.clone().subtract(daysAgo, "days").subtract(randInt(5, 300), "minutes")
    );
    await insert(conn, "audit_trail", {
      auditId: await uuid(conn),
      companyId,
      accountId: who.accountId,
      action,
      module,
      description: `${action} ${module}`,
      metadata: JSON.stringify({ path, demo: true }),
      ipAddress: "192.168.1.24",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (demo data)",
      dateCreated: at,
    });
    tally.audit += 1;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  let conn;

  try {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Demo data is for development — refusing to run with NODE_ENV=production");
    }
    const { password, generated } = demoPassword();

    console.log("🔌 Connecting to MySQL...");
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_DATABASE,
      timezone: "+08:00",
    });

    const [[{ ready }]] = await conn.query(
      `SELECT COUNT(*) AS ready FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN ('bookings', 'permissions')`
    );
    if (Number(ready) < 2) {
      throw new Error("The schema isn't there yet — run `npm run db:setup` first");
    }

    console.log(
      `\n🧹 Emptying database "${process.env.DB_DATABASE}" (keeping permissions and the super admins)...`
    );
    const removed = await truncateDatabase(conn);
    console.log(`   ✅ ${removed.rows} row(s) removed`);
    if (removed.videoRows > 0) {
      console.log(
        `   ℹ️  ${removed.videoRows} of them pointed at video files — those files are still under public/uploads`
      );
    }

    await conn.beginTransaction();

    console.log(`\n🌱 Seeding demo data (${nowText}, ${TZ})...`);
    const companies = await seedCompanies(conn, password);
    const staff = await seedRolesAndStaff(conn, password, companies.defaultId);
    await seedVenues(conn, companies);
    await seedClosures(conn, staff);
    await seedBookings(conn, staff); // before walk-ins: bookings get the good slots
    await seedPastGames(conn, staff);
    await seedAuditTrail(conn, staff, companies.defaultId);
    await attributeSecondCompany(conn, companies);

    await conn.commit();

    console.log(
      "\n   ✅ " +
        Object.entries(tally)
          .map(([k, v]) => `${v} ${k}`)
          .join(" · ")
    );

    console.log("\n   📋 Demo staff logins (Admin portal):");
    console.log(`      ${`Owner (${FIRST_COMPANY.name})`} ${companies.firstOwner}`);
    for (const person of STAFF) {
      const note = person.status === "Inactive" ? "  (Inactive — can't sign in)" : "";
      console.log(`      ${person.role.padEnd(14)} ${staffEmail(person)}${note}`);
    }
    console.log(
      `      Owner (${SECOND_COMPANY.name}) ${companies.secondOwner}   ← a second company: sees only Dink House Cebu`
    );
    console.log(
      generated
        ? `      Password: ${password}   ← generated now, shown only this once`
        : "      Password: the value of DEMO_PASSWORD"
    );

    const [links] = await conn.query(
      `SELECT name, bookingToken FROM venues WHERE venueId IN (?) AND bookingToken IS NOT NULL`,
      [VENUES.map((v) => v.venueId)]
    );
    if (links.length) {
      console.log("\n   🔗 Booking links (on the web app):");
      links.forEach((v) => console.log(`      ${v.name}: /book/${v.bookingToken}`));
    }

    console.log(
      "\n   ✉️  Demo players use @example.com addresses; upcoming bookings are marked as" +
        "\n      already reminded, so the booking job never emails them."
    );
    console.log("\n🎉 Demo data loaded. No video was seeded.");
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error("\n❌ Demo data failed:", error.message);
    console.error("   If it failed while seeding, the database is left empty — run it again.");
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

main();
