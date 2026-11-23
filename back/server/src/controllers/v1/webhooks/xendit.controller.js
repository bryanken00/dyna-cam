import express from "express";
import { logger } from "../../../../config/logger.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { checkCallbackToken, XenditError } from "../../../lib/payments/xendit.js";
import { handleRefundEvent, settleInvoice } from "../../../utils/bookingPayments.js";
import { xenditWebhookSchema } from "../../../validators/webhooks.validator.js";

/**
 * PLAN-003 Phase F — Xendit's webhooks, mounted at /api/v1/webhooks/xendit
 * with NO login. Xendit sends its x-callback-token header, which must equal
 * XENDIT_CALLBACK_TOKEN (constant-time compare) — anything else is a 401 and
 * nothing changes.
 *
 * Xendit doesn't sign the body, so the body is only a hint: the handler reads
 * the invoice (or refund) back from Xendit's API by ID and acts only on what
 * Xendit says there (utils/bookingPayments.js).
 *
 *   invoice paid      → a payment row (once) and the booking Confirmed, or refunded
 *   invoice expired   → nothing (the hold runs out on its own)
 *   refund.failed     → the payment shows "Refund failed" in Admin
 *
 * Every event we've handled (or chosen to ignore) answers 200, so Xendit stops
 * retrying it. Only when Xendit's own API can't be reached do we answer 503,
 * so it tries again later instead of the payment being lost.
 */
const router = express.Router();

const requireCallbackToken = (req, res, next) => {
  if (!checkCallbackToken(req.get("x-callback-token"))) {
    logger.warn("Xendit webhook with a wrong callback token", { ip: req.ip });
    return res.sendError("Invalid callback token", 401);
  }
  return next();
};

router.post(
  "/",
  requireCallbackToken,
  validateBody(xenditWebhookSchema),
  catchAsync(async (req, res) => {
    const { event, data, id } = req.body;
    try {
      if (typeof event === "string" && event.startsWith("refund.")) {
        const refundId = data?.id || data?.refund_id;
        const { outcome } = await handleRefundEvent(req.db, refundId);
        return res.sendSuccess("Refund event handled", { outcome });
      }
      const { outcome } = await settleInvoice(req.db, id || data?.id);
      return res.sendSuccess("Invoice event handled", { outcome });
    } catch (err) {
      if (err instanceof XenditError && (err.transient || err.status === 0)) {
        logger.error("Xendit webhook: Xendit's API couldn't be read — asking for a retry", {
          error: err.message,
        });
        return res.sendError("Xendit could not be reached — try again", 503);
      }
      if (err instanceof XenditError) {
        // Xendit says the invoice/refund doesn't exist (a forged or stray ID)
        logger.warn("Xendit webhook for an ID Xendit doesn't know", { error: err.message });
        return res.sendSuccess("Ignored", { outcome: "UNKNOWN" });
      }
      throw err;
    }
  })
);

export default router;
