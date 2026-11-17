import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createButtonServer, Debouncer, keyMatches, routeRequest } from "../src/buttons.js";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("routeRequest", () => {
  it("accepts GET and POST /press/:code, with the key from the query", () => {
    assert.deepEqual(routeRequest("GET", "/press/court-1?key=abc"), {
      route: "press",
      code: "court-1",
      key: "abc",
    });
    assert.deepEqual(routeRequest("POST", "/press/BTN_07/"), {
      route: "press",
      code: "BTN_07",
      key: null,
    });
    assert.deepEqual(routeRequest("GET", "/health"), { route: "health" });
  });

  it("rejects bad codes (400), other paths (404) and other methods (405)", () => {
    for (const code of ["ab", "x".repeat(33), "bad.code", "sp%20ace", "%E0%A4%A"]) {
      assert.equal(routeRequest("GET", `/press/${code}`).status, 400, code);
    }
    assert.equal(routeRequest("GET", "/press").status, 404);
    assert.equal(routeRequest("GET", "/press/abc/extra").status, 404);
    assert.equal(routeRequest("GET", "/").status, 404);
    assert.equal(routeRequest("PUT", "/press/abc").status, 405);
  });
});

describe("keyMatches", () => {
  it("passes everything when no key is set, else needs the exact key", () => {
    assert.equal(keyMatches("", null), true);
    assert.equal(keyMatches("s3cret-key", "s3cret-key"), true);
    assert.equal(keyMatches("s3cret-key", "s3cret-kez"), false);
    assert.equal(keyMatches("s3cret-key", "s3cret"), false);
    assert.equal(keyMatches("s3cret-key", null), false);
  });
});

describe("Debouncer", () => {
  it("ignores the same code within 3 s of its last accepted press, per code", () => {
    const d = new Debouncer(3000);
    assert.equal(d.accept("a", 10_000), true);
    assert.equal(d.accept("a", 12_999), false);
    assert.equal(d.accept("b", 12_999), true);
    assert.equal(d.accept("a", 13_000), true);
    assert.equal(d.accept("a", 14_000), false);
  });
});

describe("button server", () => {
  let server;
  let base;
  let clock = 1_794_881_000_000;
  const presses = [];

  before(async () => {
    server = createButtonServer({
      key: "venue-key-1",
      log: silent,
      now: () => clock,
      onPress: async (press) => {
        await new Promise((resolve) => setTimeout(resolve, 200)); // a slow relay must not delay the answer
        presses.push(press);
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it("answers 202 at once and records the receipt time as the press time", async () => {
    const started = Date.now();
    const res = await fetch(`${base}/press/court-1?key=venue-key-1`);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
    assert.ok(Date.now() - started < 150, "did not wait for the relay");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(presses, [{ buttonCode: "court-1", pressedAtMs: clock }]);
  });

  it("refuses a wrong or missing key (401) and a bad code (400)", async () => {
    clock += 10_000;
    assert.equal((await fetch(`${base}/press/court-1?key=nope`)).status, 401);
    assert.equal((await fetch(`${base}/press/court-1`, { method: "POST", body: "x" })).status, 401);
    assert.equal((await fetch(`${base}/press/no?key=venue-key-1`)).status, 400);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  it("debounces a double press", async () => {
    clock += 10_000;
    presses.length = 0;
    assert.equal(
      (await fetch(`${base}/press/court-2?key=venue-key-1`, { method: "POST" })).status,
      202
    );
    clock += 1000;
    const second = await fetch(`${base}/press/court-2?key=venue-key-1`);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(presses.length, 1);
  });
});
