// Importing Express framework
import { Router } from "express";

const router = Router();

// Importing route modules
import adminRoute from "./v1/admin/index.js";
import uploadRoute from "../controllers/v1/upload/upload.controller.js";
import { auditTrail } from "../middlewares/auditTrail.middleware.js";
import { idempotencyMiddleware } from "../middlewares/idempotency.middleware.js";

// Idempotent mutations: requests carrying an Idempotency-Key header get their
// successful response cached and replayed on retry (opt-in, Stripe-style)
router.use(idempotencyMiddleware());

// Mount the Admin portal routes
router.use("/v1/admin", adminRoute);

// Shared routes (accessible by all authenticated users)
import passport from "passport";
import { requirePasswordChanged } from "../middlewares/requirePasswordChanged.middleware.js";
// A valid JWT, and no pending forced password change
const requireAuth = [passport.authenticate("jwt", { session: false }), requirePasswordChanged];
router.use("/v1/upload", requireAuth, auditTrail("upload"), uploadRoute);

// Dyna Cam (PLAN-001)
// Recorder boxes — authenticated by their device token, not a user JWT
import deviceRoute from "../controllers/v1/device/device.controller.js";
import { requireDevice } from "../middlewares/deviceAuth.middleware.js";
router.use("/v1/device", requireDevice, deviceRoute);

// Players — no login; the court QR code / clip share link is the credential
import publicRoute from "../controllers/v1/public/public.controller.js";
router.use("/v1/public", publicRoute);

// PLAN-002 pairing — a 6-digit key is the credential, once (no login)
import pairingRoute from "../controllers/v1/pairing/pairing.controller.js";
router.use("/v1/pair", pairingRoute);

// PLAN-002 paired staff phones — Authorization: App <token>, scoped to one venue
import appRoute from "../controllers/v1/app/app.controller.js";
import { requirePairedApp } from "../middlewares/pairedAppAuth.middleware.js";
router.use("/v1/app", requirePairedApp, appRoute);

// Exporting the router to be used in the main app
export default router;
