import express from "express";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { encryptSecret } from "../../../utils/crypto/secretBox.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { callerCompany, inCompanyVenues } from "../../../utils/companyScope.js";
import { paymentAccountForCompany } from "../../../utils/companyPayments.js";
import { getBalance, isPaymentSandbox, keyMode, XenditError } from "../../../lib/payments/xendit.js";
import { saveCompanyPaymentsSchema } from "../../../validators/company-payments.validator.js";

/**
 * PLAN-008 phase C — the company's own Xendit account, mounted at
 * /api/v1/admin/company-payments. Players pay straight into it; refunds come
 * out of it. The secret key and webhook token are write-only: stored encrypted
 * (utils/crypto/secretBox.js) and never returned — the page only learns whether
 * it's connected, test or live, and the webhook URL to paste into Xendit.
 * Permission: payments (read to look, write to connect / disconnect).
 */
const router = express.Router();

/** Where Xendit sends this company's events: its own random key in the path. */
const webhookUrl = (req, webhookKey) => {
  if (!webhookKey) return null;
  const configured = (process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
  const base = configured || `${req.protocol}://${req.get("host")}`;
  return `${base}/api/v1/webhooks/xendit/${webhookKey}`;
};

/** Unpaid online checkouts still open at the company's venues (a key change strands them). */
const openCheckouts = async (db, companyId, now) => {
  const [row] = await db.query(
    `SELECT COUNT(*) AS n FROM bookings b
     WHERE b.status = 'Pending' AND b.paymentStatus = 'Unpaid' AND b.checkoutId IS NOT NULL
       AND b.holdExpiresAt > ? AND ${inCompanyVenues("b")}`,
    [now, companyId]
  );
  return Number(row?.n || 0);
};

const view = async (req, companyId) => {
  const [company] = await req.db.query(
    `SELECT xenditMode, xenditWebhookKey FROM companies WHERE companyId = ? LIMIT 1`,
    [companyId]
  );
  const account = await paymentAccountForCompany(req.db, companyId);
  return {
    // "company": its own keys · "env": the server's keys (the default company, until it saves its own) · "none"
    source: account.source,
    connected: account.source !== "none",
    mode: account.source === "company" ? company?.xenditMode || null : account.source === "env" ? keyMode(account.secretKey) : null,
    webhookUrl: webhookUrl(req, company?.xenditWebhookKey),
    // CR-033: the built-in test checkout stands in for Xendit on this server
    sandbox: isPaymentSandbox(),
    openCheckouts: await openCheckouts(req.db, companyId, getCurrentTimestampLocal()),
  };
};

/** GET / — is the company's Xendit connected, and where its webhook goes. */
router.get(
  "/",
  checkPermission("payments", null, "read"),
  catchAsync(async (req, res) => {
    return res.sendSuccess("Online payment", { payment: await view(req, callerCompany(req)) });
  })
);

/**
 * PUT / — connect (or replace) the company's Xendit keys. The key is checked with
 * Xendit first (its balance), so a wrong key is refused before it's saved.
 */
router.put(
  "/",
  checkPermission("payments", null, "write"),
  validateBody(saveCompanyPaymentsSchema),
  catchAsync(async (req, res) => {
    const companyId = callerCompany(req);
    const { secretKey, callbackToken } = req.body;
    try {
      await getBalance({ secretKey, callbackToken });
    } catch (err) {
      if (err instanceof XenditError && !err.transient) {
        return res.sendError("Xendit didn't accept that secret key — copy it again from Xendit", 400);
      }
      if (err instanceof XenditError) {
        return res.sendError("Xendit couldn't be reached — try again in a minute", 502);
      }
      throw err;
    }

    const now = getCurrentTimestampLocal();
    await req.db.query(
      `UPDATE companies
       SET xenditSecretKeyEnc = ?, xenditCallbackTokenEnc = ?, xenditMode = ?,
           xenditWebhookKey = COALESCE(xenditWebhookKey, ?), dateUpdated = ?
       WHERE companyId = ?`,
      [encryptSecret(secretKey), encryptSecret(callbackToken), keyMode(secretKey), randomToken(24), now, companyId]
    );
    return res.sendSuccess("Xendit connected — paste the webhook URL into Xendit", {
      payment: await view(req, companyId),
    });
  })
);

/** DELETE / — disconnect: the company's venues stop taking online payment. */
router.delete(
  "/",
  checkPermission("payments", null, "write"),
  catchAsync(async (req, res) => {
    const companyId = callerCompany(req);
    await req.db.query(
      `UPDATE companies
       SET xenditSecretKeyEnc = NULL, xenditCallbackTokenEnc = NULL, xenditMode = NULL, dateUpdated = ?
       WHERE companyId = ?`,
      [getCurrentTimestampLocal(), companyId]
    );
    return res.sendSuccess("Xendit disconnected", { payment: await view(req, companyId) });
  })
);

export default router;
