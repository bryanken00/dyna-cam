// PLAN-009 phase A — the mobile app signs players in with Google through the same flow,
// coming back to dgsports://signed-in. Its single-use code needs the app's PKCE-style
// secret (verifier): a caught redirect is worthless without it.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const VERIFIER = crypto.randomBytes(32).toString("base64url"); // 43 characters
const CHALLENGE = crypto.createHash("sha256").update(VERIFIER).digest("base64url");

describe("mobile app sign-in (PLAN-009)", () => {
  let ctx;
  let signInFromGoogle;
  let n = 0;

  const identity = () => {
    n += 1;
    return {
      sub: `app-sub-${n}`,
      email: `app${n}@example.com`,
      emailVerified: true,
      name: `App Player${n}`,
      givenName: "App",
      familyName: `Player${n}`,
      photoUrl: null,
    };
  };
  const redeem = (body) => ctx.api("POST", "/player/session", { body });

  before(async () => {
    // Google sign-in off (back/.env may have real keys): the "off" answer is predictable
    ctx = await startTestApp({
      env: { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_LOGIN_REDIRECT_URI: "" },
    });
    ({ signInFromGoogle } = await ctx.importFromBack("server/src/utils/players.js"));
  });
  after(async () => {
    await ctx?.stop();
  });

  it("redeems an app's code only with its secret — and burns it on a wrong one", async () => {
    const withSecret = await signInFromGoogle(ctx.db, identity(), { challenge: CHALLENGE });
    const ok = await redeem({ code: withSecret.code, verifier: VERIFIER });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.data.accessToken || ok.data.token || ok.data.session);

    const noSecret = await signInFromGoogle(ctx.db, identity(), { challenge: CHALLENGE });
    assert.equal((await redeem({ code: noSecret.code })).status, 400);
    // Burnt: even the right secret can't use it now
    assert.equal((await redeem({ code: noSecret.code, verifier: VERIFIER })).status, 400);

    const wrong = await signInFromGoogle(ctx.db, identity(), { challenge: CHALLENGE });
    const other = crypto.randomBytes(32).toString("base64url");
    assert.equal((await redeem({ code: wrong.code, verifier: other })).status, 400);
  });

  it("leaves the web's codes as they were (no challenge, no verifier needed)", async () => {
    const web = await signInFromGoogle(ctx.db, identity());
    assert.equal((await redeem({ code: web.code })).status, 200);
  });

  it("the app start needs a challenge, and comes back to the app's address", async () => {
    const missing = await ctx.get("/api/v1/auth/google/start?app=1", { redirect: "manual" });
    assert.equal(missing.status, 400);

    // Sign-in isn't set up in the tests: the app is sent its own "off" answer
    const started = await ctx.get(`/api/v1/auth/google/start?app=1&challenge=${CHALLENGE}`, {
      redirect: "manual",
    });
    assert.equal(started.status, 303);
    assert.match(started.headers.get("location"), /^dgsports:\/\/signed-in\?error=off$/);
  });

  it("carries the challenge in the sign-in state, and the web's state has none", async () => {
    const { signLoginState, readLoginState } = await ctx.importFromBack("server/src/utils/googleSignIn.js");
    const app = readLoginState(signLoginState({ returnPath: "/me/games", nonce: "n1", challenge: CHALLENGE }));
    assert.equal(app.challenge, CHALLENGE);
    assert.equal(readLoginState(signLoginState({ returnPath: "/me/games", nonce: "n2" })).challenge, null);
  });
});
