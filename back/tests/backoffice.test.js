// PLAN-008 phase B — the back office: DGSports' super admins (their own sign-in and
// token audience) onboard companies, edit them, suspend / reactivate them and reset
// a company Owner's password.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  OWNER,
  STAFF_PASSWORD,
  startTestApp,
  SUPERADMIN,
} from "./helpers/testApp.js";

describe("back office (PLAN-008 phase B)", () => {
  let ctx;
  let su;

  const bo = (method, url, body, token = su.token) => ctx.api(method, `/backoffice${url}`, { token, body });

  /** Onboard a company through the API → { companyId, ownerEmail, temporaryPassword } */
  let made = 0;
  const onboard = async (name, overrides = {}) => {
    made += 1;
    const ownerEmail = `bo-owner-${made}@example.test`;
    const res = await bo("POST", "/companies", {
      name,
      contactEmail: "hello@example.test",
      contactPhone: "09171234567",
      owner: { firstName: "Olive", lastName: "Owner", email: ownerEmail },
      ...overrides,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { companyId: res.data.companyId, slug: res.data.slug, ownerEmail, password: res.data.owner.temporaryPassword };
  };

  /** Sign a company's Owner in and do the first password change → staff token */
  const ownerSignIn = async (email, temporary) => {
    const first = await ctx.login(email, temporary);
    assert.equal(first.user.mustChangePassword, true);
    const changed = await ctx.api("PUT", "/admin/auth/me/password", {
      token: first.token,
      body: { currentPassword: temporary, newPassword: STAFF_PASSWORD },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    return changed.data.token;
  };

  before(async () => {
    ctx = await startTestApp();
  });
  after(async () => {
    await ctx?.stop();
  });

  it("signs the seeded super admin in with SUPERADMIN_PASSWORD — no forced change", async () => {
    const wrong = await ctx.api("POST", "/backoffice/auth/login", {
      body: { email: SUPERADMIN.email, password: "Not-The-Passw0rd" },
    });
    assert.equal(wrong.status, 401);

    const first = await ctx.api("POST", "/backoffice/auth/login", {
      body: { email: SUPERADMIN.email, password: SUPERADMIN.password },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.data.admin.mustChangePassword, false);
    assert.ok(first.data.refreshToken.token);
    assert.equal((await bo("GET", "/companies", undefined, first.data.token)).status, 200);

    su = await ctx.superAdmin();
    assert.equal(su.admin.mustChangePassword, false);
    assert.equal((await bo("GET", "/companies")).status, 200);

    // Refresh rotates; the old refresh token then ends every session
    const refreshed = await ctx.api("POST", "/backoffice/auth/refresh", { body: { refreshToken: su.refreshToken } });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    const reused = await ctx.api("POST", "/backoffice/auth/refresh", { body: { refreshToken: su.refreshToken } });
    assert.equal(reused.status, 401);
    const afterReuse = await ctx.api("POST", "/backoffice/auth/refresh", {
      body: { refreshToken: refreshed.data.refreshToken.token },
    });
    assert.equal(afterReuse.status, 401);

    // Sign in again for the rest
    const again = await ctx.api("POST", "/backoffice/auth/login", {
      body: { email: SUPERADMIN.email, password: SUPERADMIN.password },
    });
    assert.equal(again.status, 200);
    su = { token: again.data.token, refreshToken: again.data.refreshToken.token };
  });

  it("locks a super admin out after too many wrong passwords", async () => {
    const { hashPassword } = await ctx.importFromBack("server/src/utils/hashing/argonHash.js");
    await ctx.sql.query(
      `INSERT INTO platform_admins (platformAdminId, firstName, lastName, email, password, status,
         mustChangePassword, dateCreated, dateUpdated)
       VALUES ('pa-lockout', 'Lock', 'Out', 'lockout@dgsports.test', ?, 'Active', 0, NOW(), NOW())`,
      [await hashPassword("Right-Passw0rd-123")]
    );
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await ctx.api("POST", "/backoffice/auth/login", {
        body: { email: "lockout@dgsports.test", password: "Wrong-Passw0rd-123" },
      });
    }
    assert.equal(last.status, 423);
    const right = await ctx.api("POST", "/backoffice/auth/login", {
      body: { email: "lockout@dgsports.test", password: "Right-Passw0rd-123" },
    });
    assert.equal(right.status, 423);
  });

  it("keeps staff and back-office tokens apart", async () => {
    const staff = await ctx.owner();
    const staffOnBo = await bo("GET", "/companies", undefined, staff.token);
    assert.equal(staffOnBo.status, 401);
    const boOnAdmin = await ctx.api("GET", "/admin/venues", { token: su.token });
    assert.equal(boOnAdmin.status, 401);
    const boOnMe = await ctx.api("GET", "/admin/auth/me", { token: su.token });
    assert.equal(boOnMe.status, 401);
    assert.equal((await ctx.api("GET", "/backoffice/companies")).status, 401);
    // A player token isn't a back-office token either
    const player = await ctx.signInPlayer({ email: "bo-player@example.test", name: "Bo Player" });
    const playerOnBo = await ctx.api("GET", "/backoffice/companies", {
      headers: { Authorization: `Bearer ${player.token}` },
    });
    assert.equal(playerOnBo.status, 401);
  });

  it("onboards a company whose Owner signs in, must change the password, and starts empty", async () => {
    const company = await onboard("Rally Point Inc.");
    assert.equal(company.slug, "rally-point-inc");
    assert.ok(company.password.length >= 12);

    const first = await ctx.login(company.ownerEmail, company.password);
    const pending = await ctx.api("GET", "/admin/venues", { token: first.token });
    assert.equal(pending.status, 403);
    assert.equal(pending.body.code, "PASSWORD_CHANGE_REQUIRED");

    const token = await ownerSignIn(company.ownerEmail, company.password);
    const venues = await ctx.api("GET", "/admin/venues", { token });
    assert.equal(venues.status, 200, JSON.stringify(venues.body));
    assert.equal(venues.data.venues.length, 0);

    // The back office shows it, with its Owner and zero counts
    const detail = await bo("GET", `/companies/${company.companyId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.company.name, "Rally Point Inc.");
    assert.equal(detail.data.company.contactPhone, "0917 1234 567");
    assert.equal(detail.data.company.owner.email, company.ownerEmail);
    assert.equal(detail.data.company.counts.venues, 0);

    const list = await bo("GET", "/companies?search=rally");
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.data.companies.map((c) => c.companyId),
      [company.companyId]
    );
    // The default company is listed too
    const all = await bo("GET", "/companies");
    assert.ok(all.data.companies.some((c) => c.slug === "default" && c.isDefault));
  });

  it("refuses a used company link or staff email", async () => {
    await onboard("Smash Club", { slug: "smash-club" });
    const sameSlug = await bo("POST", "/companies", {
      name: "Another Smash",
      slug: "smash-club",
      owner: { firstName: "A", lastName: "B", email: "new-owner@example.test" },
    });
    assert.equal(sameSlug.status, 409);
    const sameEmail = await bo("POST", "/companies", {
      name: "Dup Email Co",
      owner: { firstName: "A", lastName: "B", email: OWNER.email },
    });
    assert.equal(sameEmail.status, 409);
    const badSlug = await bo("POST", "/companies", {
      name: "Bad Slug Co",
      slug: "Not A Slug!",
      owner: { firstName: "A", lastName: "B", email: "bad-slug@example.test" },
    });
    assert.equal(badSlug.status, 400);
  });

  it("suspends a company: its staff are signed out and its venues stop taking online bookings", async () => {
    const company = await onboard("Dink House");
    const token = await ownerSignIn(company.ownerEmail, company.password);
    const venue = await ctx.api("POST", "/admin/venues", { token, body: { name: "Dink House Main" } });
    assert.equal(venue.status, 201, JSON.stringify(venue.body));
    const { venueId } = venue.data;
    const court = await ctx.api("POST", "/admin/courts", {
      token,
      body: { venueId, name: "Court 1", cameraRtspUrl: "rtsp://u:p@10.0.42.1:554/stream1" },
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const link = await ctx.api("POST", `/admin/booking-settings/${venueId}/link`, { token });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const bookingToken = link.data.bookingUrl.split("/book/")[1];

    assert.equal((await ctx.api("GET", `/public/book/${bookingToken}`)).status, 200);
    let directory = await ctx.api("GET", "/public/venues");
    assert.ok(directory.data.venues.some((v) => v.bookingToken === bookingToken));

    const suspended = await bo("POST", `/companies/${company.companyId}/suspend`);
    assert.equal(suspended.status, 200);
    assert.equal(suspended.data.company.status, "Suspended");

    const login = await ctx.api("POST", "/admin/auth/login", {
      body: { email: company.ownerEmail, password: STAFF_PASSWORD },
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, "COMPANY_SUSPENDED");
    assert.equal((await ctx.api("GET", "/admin/venues", { token })).status, 401);
    assert.equal((await ctx.api("GET", `/public/book/${bookingToken}`)).status, 404);
    directory = await ctx.api("GET", "/public/venues");
    assert.ok(!directory.data.venues.some((v) => v.bookingToken === bookingToken));

    const counts = await bo("GET", `/companies/${company.companyId}`);
    assert.equal(counts.data.company.counts.venues, 1);
    assert.equal(counts.data.company.counts.courts, 1);
    const onlySuspended = await bo("GET", "/companies?status=Suspended");
    assert.deepEqual(
      onlySuspended.data.companies.map((c) => c.companyId),
      [company.companyId]
    );

    const reactivated = await bo("POST", `/companies/${company.companyId}/reactivate`);
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.data.company.status, "Active");
    const back = await ctx.login(company.ownerEmail, STAFF_PASSWORD);
    assert.ok(back.token);
    assert.equal((await ctx.api("GET", `/public/book/${bookingToken}`)).status, 200);
  });

  it("edits a company's details, but not the default company's link", async () => {
    const company = await onboard("Kitchen Line");
    const edited = await bo("PATCH", `/companies/${company.companyId}`, {
      name: "Kitchen Line Co.",
      slug: "kitchen-line-co",
      contactEmail: "",
      contactPhone: "0918 2223 333",
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.data.company.name, "Kitchen Line Co.");
    assert.equal(edited.data.company.slug, "kitchen-line-co");
    assert.equal(edited.data.company.contactEmail, null);

    const all = await bo("GET", "/companies");
    const def = all.data.companies.find((c) => c.slug === "default");
    const renameDefault = await bo("PATCH", `/companies/${def.companyId}`, { name: "Main", slug: "main" });
    assert.equal(renameDefault.status, 400);
    const nameOnly = await bo("PATCH", `/companies/${def.companyId}`, { name: "DGSports HQ" });
    assert.equal(nameOnly.status, 200);
    assert.equal(nameOnly.data.company.slug, "default");
  });

  it("resets a company Owner's password: a new temporary one, the old one stops working", async () => {
    const company = await onboard("Third Shot");
    await ownerSignIn(company.ownerEmail, company.password);
    const reset = await bo("POST", `/companies/${company.companyId}/owner/reset-password`);
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const fresh = reset.data.owner.temporaryPassword;

    const old = await ctx.api("POST", "/admin/auth/login", {
      body: { email: company.ownerEmail, password: STAFF_PASSWORD },
    });
    assert.equal(old.status, 401);
    const signedIn = await ctx.login(company.ownerEmail, fresh);
    assert.equal(signedIn.user.mustChangePassword, true);
  });

  it("treats an unknown or deleted company as missing", async () => {
    assert.equal((await bo("GET", "/companies/not-a-company")).status, 404);
    const company = await onboard("Gone Courts");
    await ctx.sql.query(`UPDATE companies SET status = 'Deleted' WHERE companyId = ?`, [company.companyId]);
    assert.equal((await bo("GET", `/companies/${company.companyId}`)).status, 404);
    assert.equal((await bo("PATCH", `/companies/${company.companyId}`, { name: "Back" })).status, 404);
    assert.equal((await bo("POST", `/companies/${company.companyId}/suspend`)).status, 404);
    assert.equal((await bo("POST", `/companies/${company.companyId}/reactivate`)).status, 404);
    assert.equal((await bo("POST", `/companies/${company.companyId}/owner/reset-password`)).status, 404);
    const [[row]] = await ctx.sql.query(`SELECT name, status FROM companies WHERE companyId = ?`, [
      company.companyId,
    ]);
    assert.equal(row.name, "Gone Courts");
    assert.equal(row.status, "Deleted");
    const list = await bo("GET", "/companies?search=gone");
    assert.equal(list.data.companies.length, 0);
  });
});
