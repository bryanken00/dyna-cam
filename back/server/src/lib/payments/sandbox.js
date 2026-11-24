import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { randomToken } from "../../utils/crypto/tokens.js";
import { appUrl } from "../../utils/clips.js";
import { logger } from "../../../config/logger.js";

/**
 * CR-033 — the payment sandbox: a built-in stand-in for Xendit, for trying
 * online payment without a Xendit account. On with PAYMENT_SANDBOX=true in
 * back/.env (never in production — see isPaymentSandbox() in xendit.js).
 *
 * It answers the same calls xendit.js makes (create / get / expire an
 * invoice, create / get a refund) with Xendit-shaped JSON, as
 * `{ status, body }` like an HTTP reply, so xendit.js parses it exactly as it
 * parses Xendit — nothing above that file knows the difference. Its
 * checkout page is the player app's /payment-sandbox/:checkoutId, which reads
 * and pays through checkoutView() / payCheckout() (public API
 * /api/v1/public/payment-sandbox). Paying only marks the invoice PAID; the
 * booking turns Paid the usual way, when the player's booking page asks.
 *
 * State lives in a small JSON file (PAYMENT_SANDBOX_FILE, default
 * back/storage/payment-sandbox.json, git-ignored) so an API restart keeps open
 * checkouts. Refunds succeed at once.
 */

const DEFAULT_FILE = fileURLToPath(new URL("../../../../storage/payment-sandbox.json", import.meta.url));
const KEEP_DAYS = 30;

export const SANDBOX_ID_PREFIX = "sandbox_";
const ID_PATTERN = /^sandbox_[A-Za-z0-9_-]{16,64}$/;

const storeFile = () => process.env.PAYMENT_SANDBOX_FILE || DEFAULT_FILE;

const load = () => {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    return { invoices: data.invoices || {}, refunds: data.refunds || {} };
  } catch (err) {
    if (err.code !== "ENOENT") logger.warn("Payment sandbox: store unreadable, starting empty", { error: err.message });
    return { invoices: {}, refunds: {} };
  }
};

const save = (state) => {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, inv] of Object.entries(state.invoices)) {
    if (Date.parse(inv.created) < cutoff) delete state.invoices[id];
  }
  for (const [id, r] of Object.entries(state.refunds)) {
    if (Date.parse(r.created) < cutoff) delete state.refunds[id];
  }
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
};

const newId = () => `${SANDBOX_ID_PREFIX}${randomToken(16)}`;

/** A PENDING invoice past its expiry reads as EXPIRED, like Xendit's. */
const current = (inv) =>
  inv.status === "PENDING" && Date.parse(inv.expiry_date) <= Date.now() ? { ...inv, status: "EXPIRED" } : inv;

const reply = (status, body) => ({ status, body });
const notFound = (code = "DATA_NOT_FOUND") => reply(404, { error_code: code, message: "Not found" });

/**
 * One Xendit API call, answered by the sandbox.
 *
 * @param {string} method
 * @param {string} apiPath - the Xendit path xendit.js would call, e.g. "/v2/invoices"
 * @param {Object|undefined} body
 * @returns {{ status: number, body: Object }}
 */
export const handle = (method, apiPath, body) => {
  const state = load();

  if (method === "POST" && apiPath === "/v2/invoices") {
    const id = newId();
    const created = new Date();
    const invoice = {
      id,
      external_id: body.external_id,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      payer_email: body.payer_email || null,
      success_redirect_url: body.success_redirect_url,
      failure_redirect_url: body.failure_redirect_url,
      status: "PENDING",
      invoice_url: `${appUrl()}/payment-sandbox/${id}`,
      expiry_date: new Date(created.getTime() + body.invoice_duration * 1000).toISOString(),
      created: created.toISOString(),
    };
    state.invoices[id] = invoice;
    save(state);
    return reply(200, invoice);
  }

  let match = /^\/v2\/invoices\/([^/]+)$/.exec(apiPath);
  if (method === "GET" && match) {
    const inv = state.invoices[decodeURIComponent(match[1])];
    return inv ? reply(200, current(inv)) : notFound("INVOICE_NOT_FOUND_ERROR");
  }

  match = /^\/invoices\/([^/]+)\/expire!$/.exec(apiPath);
  if (method === "POST" && match) {
    const id = decodeURIComponent(match[1]);
    const inv = state.invoices[id] && current(state.invoices[id]);
    if (!inv || inv.status !== "PENDING") return notFound("INVOICE_NOT_FOUND_ERROR");
    state.invoices[id] = { ...inv, status: "EXPIRED" };
    save(state);
    return reply(200, state.invoices[id]);
  }

  if (method === "POST" && apiPath === "/refunds") {
    const inv = state.invoices[body.invoice_id];
    if (!inv || inv.status !== "PAID") {
      return reply(400, { error_code: "INVALID_PAYMENT_STATUS", message: "Only a paid invoice can be refunded" });
    }
    const id = newId();
    const refund = {
      id,
      invoice_id: body.invoice_id,
      reference_id: body.reference_id,
      amount: body.amount,
      reason: body.reason,
      status: "SUCCEEDED",
      created: new Date().toISOString(),
    };
    state.refunds[id] = refund;
    save(state);
    return reply(200, refund);
  }

  match = /^\/refunds\/([^/]+)$/.exec(apiPath);
  if (method === "GET" && match) {
    const refund = state.refunds[decodeURIComponent(match[1])];
    return refund ? reply(200, refund) : notFound();
  }

  return reply(404, { error_code: "NOT_FOUND", message: `The payment sandbox doesn't handle ${method} ${apiPath}` });
};

/**
 * What the test checkout page shows, or null for an unknown checkout.
 *
 * @param {string} checkoutId
 * @returns {null | { description, amount, currency, status, expiresAt, returnUrl }}
 */
export const checkoutView = (checkoutId) => {
  if (!ID_PATTERN.test(checkoutId)) return null;
  const inv = load().invoices[checkoutId];
  if (!inv) return null;
  const c = current(inv);
  return {
    description: c.description,
    amount: Number(c.amount),
    currency: c.currency,
    status: c.status,
    expiresAt: c.expiry_date,
    returnUrl: c.success_redirect_url,
  };
};

/**
 * The player taps Pay: a PENDING checkout turns PAID.
 *
 * @returns {{ ok: true, returnUrl: string } | { ok: false, status: number, message: string }}
 */
export const payCheckout = (checkoutId) => {
  if (!ID_PATTERN.test(checkoutId)) return { ok: false, status: 404, message: "This checkout doesn't exist" };
  const state = load();
  const inv = state.invoices[checkoutId];
  if (!inv) return { ok: false, status: 404, message: "This checkout doesn't exist" };
  const c = current(inv);
  if (c.status === "PAID") return { ok: true, returnUrl: c.success_redirect_url };
  if (c.status !== "PENDING") {
    return { ok: false, status: 409, message: "This checkout has closed — go back to your booking" };
  }
  state.invoices[checkoutId] = { ...inv, status: "PAID", paid_at: new Date().toISOString() };
  save(state);
  return { ok: true, returnUrl: c.success_redirect_url };
};
