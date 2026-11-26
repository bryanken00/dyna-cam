import crypto from "node:crypto";

import * as sandbox from "./sandbox.js";

/**
 * PLAN-003 Phase F — Xendit. PLAN-008 phase C: each company has its own Xendit
 * account (players pay straight into it); every call takes the account to use. Each booking is paid through a Xendit **Invoice**: a hosted checkout
 * page offering the account's enabled methods (GCash, Maya, cards…).
 *
 * Online payment is ON only when both XENDIT_SECRET_KEY and
 * XENDIT_CALLBACK_TOKEN are set (test-mode keys work the same way). Without
 * them the booking page offers "Pay at the desk" only.
 *
 * CR-033: PAYMENT_SANDBOX=true answers every call below from the built-in
 * payment sandbox (./sandbox.js) instead of Xendit — no keys needed, and no
 * request leaves the server. Ignored when NODE_ENV=production.
 *
 * This file is the only place that knows Xendit's API, so a contract change
 * (or a second provider) stays here. XENDIT_API_URL points the client at a
 * fake server in tests.
 *
 * Contract (checked against docs.xendit.co, 2026-11): Basic auth with the
 * secret key as the username; Invoices are POST /v2/invoices and
 * GET /v2/invoices/:id (status PENDING, PAID, SETTLED or EXPIRED) — Xendit
 * now calls them "legacy" next to its Sessions API. Expire is
 * POST /invoices/:id/expire!. Refunds of an invoice go to POST /refunds with
 * invoice_id. Xendit's v3 Refunds API takes a payment_id instead, so check
 * this call in test mode before going live (plan open question).
 */

const API_URL = () => (process.env.XENDIT_API_URL || "https://api.xendit.co").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 15000;

/** Refund reasons Xendit accepts. */
export const REFUND_REASONS = ["CANCELLATION", "REQUESTED_BY_CUSTOMER", "DUPLICATE", "OTHERS"];

export class XenditError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, transient?: boolean }} [details]
   */
  constructor(message, { status = 0, code = null, transient = false } = {}) {
    super(message);
    this.name = "XenditError";
    this.status = status;
    this.code = code;
    // Xendit couldn't be reached or failed on its side: worth trying again
    this.transient = transient;
  }
}

/** CR-033: is the built-in payment sandbox standing in for Xendit? Never in production. */
export const isPaymentSandbox = () =>
  String(process.env.PAYMENT_SANDBOX || "").trim().toLowerCase() === "true" &&
  process.env.NODE_ENV !== "production";

/**
 * PLAN-008 phase C: a Xendit account — `{ secretKey, callbackToken }`. Each company
 * has its own (utils/companyPayments.js); `envAccount()` is the one in back/.env
 * (the default company's, until it saves its own). Every call below takes the
 * account to use; leaving it out means the .env one.
 */
export const envAccount = () => ({
  secretKey: process.env.XENDIT_SECRET_KEY || "",
  callbackToken: process.env.XENDIT_CALLBACK_TOKEN || "",
});

/** Is online payment configured for this account (its keys, or the sandbox)? */
export const isOnlinePaymentOn = (account = envAccount()) =>
  isPaymentSandbox() || (Boolean(account?.secretKey) && Boolean(account?.callbackToken));

const authHeader = (account) => `Basic ${Buffer.from(`${account?.secretKey || ""}:`).toString("base64")}`;

/** One call to Xendit → the parsed JSON body, or a XenditError. */
const request = async (method, path, body, account = envAccount()) => {
  if (!isOnlinePaymentOn(account)) {
    throw new XenditError("Online payment is not set up", { code: "NOT_CONFIGURED" });
  }
  if (isPaymentSandbox()) {
    const { status, body: json } = sandbox.handle(method, path, body);
    return parseReply(status, json);
  }
  let res;
  try {
    res = await fetch(`${API_URL()}${path}`, {
      method,
      headers: {
        Authorization: authHeader(account),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new XenditError(`Xendit could not be reached (${err.name || "network error"})`, {
      transient: true,
    });
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return parseReply(res.status, json);
};

/** Xendit's reply (or the sandbox's) → its JSON body, or a XenditError. */
const parseReply = (status, json) => {
  if (status < 200 || status >= 300) {
    // Xendit errors are { error_code, message }
    throw new XenditError(json?.message || `Xendit answered ${status}`, {
      status,
      code: json?.error_code || null,
      transient: status >= 500 || status === 429,
    });
  }
  return json || {};
};

const toInvoice = (raw) => {
  const status = String(raw.status || "").toUpperCase();
  return {
    id: raw.id,
    externalId: raw.external_id || null,
    status,
    // PAID becomes SETTLED once the money reaches the balance: both are paid
    paid: status === "PAID" || status === "SETTLED",
    amount: Number(raw.amount),
    currency: raw.currency || null,
    url: raw.invoice_url || null,
    expiresAt: raw.expiry_date || null,
  };
};

/**
 * A hosted checkout for one booking.
 *
 * @param {Object} invoice
 * @param {string} invoice.externalId - ours: "booking-<bookingCode>"
 * @param {number} invoice.amount - the booking's price (pesos), never a client-sent value
 * @param {number} invoice.durationSeconds - how long the checkout stays payable (the hold)
 * @param {string} invoice.returnUrl - the player's booking page (success and failure)
 * @param {string|null} [invoice.email] - the payer's email (Xendit sends its receipt)
 * @param {string} invoice.description
 * @returns {Promise<{ id, externalId, status, paid, amount, url, expiresAt }>}
 */
export const createInvoice = async (
  { externalId, amount, durationSeconds, returnUrl, email = null, description },
  account = envAccount()
) =>
  toInvoice(
    await request(
      "POST",
      "/v2/invoices",
      {
        external_id: externalId,
        amount,
        currency: "PHP",
        description: description.slice(0, 255),
        invoice_duration: Math.max(60, Math.floor(durationSeconds)),
        success_redirect_url: returnUrl,
        failure_redirect_url: returnUrl,
        ...(email ? { payer_email: email } : {}),
      },
      account
    )
  );

/** The invoice as Xendit has it — the only source a payment is believed from. */
export const getInvoice = async (invoiceId, account = envAccount()) =>
  toInvoice(await request("GET", `/v2/invoices/${encodeURIComponent(invoiceId)}`, undefined, account));

/**
 * Close an unpaid checkout so it can't be paid any more (the booking was
 * cancelled, moved, or paid at the desk). An invoice that is already paid or
 * expired can't be expired: that's reported, not thrown.
 *
 * @returns {Promise<{ expired: boolean, status?: string }>}
 */
export const expireInvoice = async (invoiceId, account = envAccount()) => {
  try {
    const raw = await request("POST", `/invoices/${encodeURIComponent(invoiceId)}/expire!`, undefined, account);
    return { expired: true, status: toInvoice(raw).status };
  } catch (err) {
    if (err instanceof XenditError && !err.transient && err.status >= 400 && err.status < 500) {
      return { expired: false, status: err.code || String(err.status) };
    }
    throw err;
  }
};

/**
 * Give a paid invoice's money back.
 *
 * @param {Object} refund
 * @param {string} refund.invoiceId - the paid invoice (payments.providerRef)
 * @param {number} refund.amount
 * @param {string} refund.referenceId - ours (the paymentId), so a retry is traceable
 * @param {string} [refund.reason] - one of REFUND_REASONS
 * @returns {Promise<{ id: string, status: string }>} status PENDING, SUCCEEDED or FAILED
 */
export const refund = async ({ invoiceId, amount, referenceId, reason = "CANCELLATION" }, account = envAccount()) => {
  const raw = await request(
    "POST",
    "/refunds",
    {
      invoice_id: invoiceId,
      reference_id: referenceId,
      amount,
      reason: REFUND_REASONS.includes(reason) ? reason : "OTHERS",
    },
    account
  );
  return {
    id: raw.id || raw.refund_id,
    status: String(raw.status || "PENDING").toUpperCase(),
    failureCode: raw.failure_code || null,
  };
};

/** A refund as Xendit has it (for its refund.succeeded / refund.failed events). */
export const getRefund = async (refundId, account = envAccount()) => {
  const raw = await request("GET", `/refunds/${encodeURIComponent(refundId)}`, undefined, account);
  return {
    id: raw.id || raw.refund_id,
    status: String(raw.status || "").toUpperCase(),
    failureCode: raw.failure_code || null,
  };
};

/**
 * PLAN-008: prove a company's secret key works — its account's cash balance
 * (GET /balance). The sandbox answers for any key.
 * @returns {Promise<{ balance: number }>}
 */
export const getBalance = async (account) => {
  if (isPaymentSandbox()) return { balance: 0 };
  const raw = await request("GET", "/balance", undefined, account);
  return { balance: Number(raw.balance || 0) };
};

/** "xnd_development_…" → "test", "xnd_production_…" → "live" (null: not a Xendit secret key). */
export const keyMode = (secretKey) => {
  if (/^xnd_development_/.test(secretKey || "")) return "test";
  if (/^xnd_production_/.test(secretKey || "")) return "live";
  return null;
};

/**
 * Is this the x-callback-token header Xendit signs every webhook with?
 * Compared in constant time (as SHA-256 digests, so lengths never leak).
 */
export const checkCallbackToken = (header, account = envAccount()) => {
  const expected = account?.callbackToken || "";
  if (!expected || typeof header !== "string" || header.length === 0) return false;
  const a = crypto.createHash("sha256").update(header).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};
