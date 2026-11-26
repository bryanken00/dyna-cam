// PLAN-008 phase F — each company's own recorder-box enroll key, made by a super admin
// in the back office: it enrols boxes only into that company's venues; Regenerate stops
// the old key (enrolled boxes keep working), Turn off stops enrolment, a suspended
// company's key is refused. The key is shown once and never stored, logged or audited.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("company enroll keys (PLAN-008 phase F)", () => {
  let ctx;
  let su;
  const home = {};
  const other = {};
  let ipNo = 0;
  const keysSeen = [];

  const bo = (method, url, body, headers) => ctx.api(method, `/backoffice${url}`, { token: su.token, body, headers });
  /** Each enrolment from its own documentation-range IP (the per-IP limits stay on). */
  const enrol = (enrollKey, venueId, name = "Box") => {
    ipNo += 1;
    return ctx.api("POST", "/pair/enroll", {
      body: { enrollKey, venueId, name, agentVersion: "test" },
      headers: { "X-Forwarded-For": `198.18.0.${ipNo}` },
    });
  };
  const generate = async (companyId) => {
    const res = await bo("POST", `/companies/${companyId}/enroll-key`, undefined, {
      "Idempotency-Key": `enroll-${companyId}-${keysSeen.length}`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.data.enrollKey.length >= 43, "at least 32 random bytes");
    keysSeen.push(res.data.enrollKey);
    return res.data.enrollKey;
  };
  const detail = async (companyId) => (await bo("GET", `/companies/${companyId}`)).data.company;
  const refusedLikeAWrongKey = (res) => {
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /isn't accepted/);
    assert.equal(res.body.code, "INVALID_INPUT");
  };

  before(async () => {
    ctx = await startTestApp({ env: { PAIR_MAX_FAILURES: "1000", RATE_LIMIT_PAIR_POINTS: "1000" } });
    su = await ctx.superAdmin();

    const owner = await ctx.owner();
    home.venueId = (
      await ctx.api("POST", "/admin/venues", { token: owner.token, body: { name: "Home Courts" } })
    ).data.venueId;
    const [[row]] = await ctx.sql.query(`SELECT companyId FROM companies WHERE slug = 'default'`);
    home.companyId = row.companyId;

    const company = await ctx.createCompany("Other Club");
    other.companyId = company.companyId;
    other.venueId = (
      await ctx.api("POST", "/admin/venues", { token: company.owner.token, body: { name: "Other Courts" } })
    ).data.venueId;
  });
  after(async () => {
    await ctx?.stop();
  });

  it("starts off: no key, no boxes, and enrolment refused", async () => {
    const company = await detail(other.companyId);
    assert.deepEqual(company.enrollKey, { on: false, createdAt: null });
    assert.deepEqual(company.boxes, []);
    refusedLikeAWrongKey(await enrol("x".repeat(43), other.venueId));
  });

  it("enrols a box into its own company's venue, and the company page lists it", async () => {
    other.key = await generate(other.companyId);
    const res = await enrol(other.key, other.venueId, "Court Box 1");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    other.deviceToken = res.data.token;

    const company = await detail(other.companyId);
    assert.equal(company.enrollKey.on, true);
    assert.ok(company.enrollKey.createdAt);
    assert.equal(company.boxes.length, 1);
    assert.equal(company.boxes[0].name, "Court Box 1");
    assert.equal(company.boxes[0].venueName, "Other Courts");
    assert.equal(company.boxes[0].status, "Active");
    assert.equal(company.boxes[0].online, true);
    assert.ok(!JSON.stringify(company).includes(other.key), "the key is never shown again");

    // Only its hash is stored, and the reply never went into the idempotency cache
    const [[row]] = await ctx.sql.query(`SELECT enrollKeyHash FROM companies WHERE companyId = ?`, [
      other.companyId,
    ]);
    assert.notEqual(row.enrollKeyHash, other.key);
    assert.equal(row.enrollKeyHash.length, 64);
    const [cached] = await ctx.sql.query(`SELECT responseBody FROM idempotency_keys`);
    assert.ok(!JSON.stringify(cached).includes(other.key));
  });

  it("refuses another company's venue exactly like a wrong key", async () => {
    const wrong = await enrol("y".repeat(43), other.venueId);
    refusedLikeAWrongKey(wrong);
    const intoHome = await enrol(other.key, home.venueId);
    refusedLikeAWrongKey(intoHome);
    assert.deepEqual(intoHome.body, wrong.body);
    const [[count]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM devices WHERE venueId = ?`, [home.venueId]);
    assert.equal(count.n, 0);
  });

  it("regenerates: the old key stops enrolling, the enrolled box keeps working", async () => {
    const before = await detail(other.companyId);
    const fresh = await generate(other.companyId);
    assert.notEqual(fresh, other.key);
    refusedLikeAWrongKey(await enrol(other.key, other.venueId));

    const heartbeat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${other.deviceToken}` },
    });
    assert.equal(heartbeat.status, 200, JSON.stringify(heartbeat.body));

    assert.equal((await enrol(fresh, other.venueId, "Court Box 2")).status, 201);
    other.key = fresh;
    const after = await detail(other.companyId);
    assert.equal(after.boxes.length, 2);
    assert.ok(after.enrollKey.createdAt >= before.enrollKey.createdAt);
  });

  it("turns the key off: no new boxes", async () => {
    const off = await bo("DELETE", `/companies/${other.companyId}/enroll-key`);
    assert.equal(off.status, 200, JSON.stringify(off.body));
    refusedLikeAWrongKey(await enrol(other.key, other.venueId));
    assert.deepEqual((await detail(other.companyId)).enrollKey, { on: false, createdAt: null });
    // Turning it off again changes nothing (and isn't recorded twice)
    assert.equal((await bo("DELETE", `/companies/${other.companyId}/enroll-key`)).status, 200);
  });

  it("refuses a suspended company's key until it's reactivated", async () => {
    other.key = await generate(other.companyId);
    assert.equal((await bo("POST", `/companies/${other.companyId}/suspend`)).status, 200);
    refusedLikeAWrongKey(await enrol(other.key, other.venueId));
    assert.equal((await bo("POST", `/companies/${other.companyId}/reactivate`)).status, 200);
    assert.equal((await enrol(other.key, other.venueId, "Court Box 3")).status, 201);
  });

  it("records generate / regenerate / off in the back office and the company's audit trail — never the key", async () => {
    const activity = await bo("GET", `/activity?companyId=${other.companyId}&pageSize=100`);
    const actions = activity.data.activity.map((r) => r.action);
    assert.equal(actions.filter((a) => a === "COMPANY_ENROLL_KEY_GENERATE").length, 2);
    assert.equal(actions.filter((a) => a === "COMPANY_ENROLL_KEY_REGENERATE").length, 1);
    assert.equal(actions.filter((a) => a === "COMPANY_ENROLL_KEY_OFF").length, 1);
    assert.ok(activity.data.actions.includes("COMPANY_ENROLL_KEY_OFF"));
    const filtered = await bo("GET", "/activity?action=COMPANY_ENROLL_KEY_REGENERATE");
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.activity.length, 1);

    const [companyRows] = await ctx.sql.query(
      `SELECT action, description, metadata FROM audit_trail WHERE companyId = ? AND module = 'company'`,
      [other.companyId]
    );
    assert.ok(companyRows.some((r) => r.action === "COMPANY_ENROLL_KEY_OFF"));
    const [platformRows] = await ctx.sql.query(`SELECT description, metadata FROM platform_audit_trail`);
    const everything = JSON.stringify([activity.data, companyRows, platformRows]);
    for (const key of keysSeen) assert.ok(!everything.includes(key), "a key in the audit");
  });

  it("treats an unknown or deleted company as missing", async () => {
    assert.equal((await bo("POST", "/companies/nope/enroll-key")).status, 404);
    assert.equal((await bo("DELETE", "/companies/nope/enroll-key")).status, 404);
    const gone = await ctx.createCompany("Gone Club");
    await ctx.sql.query(`UPDATE companies SET status = 'Deleted' WHERE companyId = ?`, [gone.companyId]);
    assert.equal((await bo("POST", `/companies/${gone.companyId}/enroll-key`)).status, 404);
    assert.equal((await bo("DELETE", `/companies/${gone.companyId}/enroll-key`)).status, 404);
    const [[row]] = await ctx.sql.query(`SELECT enrollKeyHash FROM companies WHERE companyId = ?`, [gone.companyId]);
    assert.equal(row.enrollKeyHash, null);
  });

  it("ctx.pairBox still enrols with the venue's company key", async () => {
    const box = await ctx.pairBox(null, home.venueId, "Harness Box");
    assert.equal(box.status, 201);
  });
});
