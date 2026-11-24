import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { isPaymentSandbox } from "../../../lib/payments/xendit.js";
import { checkoutView, payCheckout } from "../../../lib/payments/sandbox.js";
import { paymentSandboxParamsSchema } from "../../../validators/public.validator.js";

/**
 * CR-033 — the payment sandbox's test checkout, mounted at
 * /api/v1/public/payment-sandbox with NO login (the checkout's random ID is
 * the credential, as Xendit's checkout link is). Everything here answers 404
 * unless PAYMENT_SANDBOX is on (lib/payments/xendit.js isPaymentSandbox()).
 *
 *   GET  /:checkoutId       the booking's description, amount, status, return link
 *   POST /:checkoutId/pay   mark it paid → { returnUrl }
 *
 * Paying only marks the sandbox's invoice PAID; the booking turns Paid the
 * usual way, when the player's booking page asks (utils/bookingPayments.js).
 */
const router = express.Router();

const sandboxOnly = (req, res, next) =>
  isPaymentSandbox() ? next() : res.sendError("Not found", 404);

// Per IP: a player taps Pay once or twice
const payLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_PAY_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-sandbox-pay:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

router.get(
  "/:checkoutId",
  sandboxOnly,
  validateParams(paymentSandboxParamsSchema),
  catchAsync((req, res) => {
    const checkout = checkoutView(req.params.checkoutId);
    if (!checkout) return res.sendError("This checkout doesn't exist", 404);
    return res.sendSuccess("Test checkout", { checkout });
  })
);

router.post(
  "/:checkoutId/pay",
  sandboxOnly,
  payLimiter,
  validateParams(paymentSandboxParamsSchema),
  catchAsync((req, res) => {
    const result = payCheckout(req.params.checkoutId);
    if (!result.ok) return res.sendError(result.message, result.status);
    return res.sendSuccess("Test payment made", { returnUrl: result.returnUrl });
  })
);

export default router;
