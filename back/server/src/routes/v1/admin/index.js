import { Router } from "express";
import passport from "passport";

import authController from "../../../controllers/v1/auth/auth.controller.js";
import usersController from "../../../controllers/v1/admin/users.controller.js";
import rolesController from "../../../controllers/v1/admin/roles.controller.js";
import permissionsController from "../../../controllers/v1/admin/permissions.controller.js";
import userPermissionsController from "../../../controllers/v1/admin/user-permissions.controller.js";
import auditTrailController from "../../../controllers/v1/admin/audit-trail.controller.js";
import settingsController from "../../../controllers/v1/admin/settings.controller.js";
import dashboardController from "../../../controllers/v1/admin/dashboard.controller.js";
import { auditTrail } from "../../../middlewares/auditTrail.middleware.js";
import { requirePasswordChanged } from "../../../middlewares/requirePasswordChanged.middleware.js";

const router = Router();
// A valid JWT
const requireJwt = passport.authenticate("jwt", { session: false });
// ...and no pending forced password change
const requireAuth = [requireJwt, requirePasswordChanged];

// Public routes (no auth required)
router.use("/auth", authController);

// Protected routes (JWT required + auto audit logging)
router.use("/users", requireAuth, auditTrail("users"), usersController);
router.use("/roles", requireAuth, auditTrail("roles"), rolesController);
// JWT only: the layout loads the caller's own permissions to draw the sidebar,
// which must still work while a password change is pending. Read-only data.
router.use("/permissions", requireJwt, permissionsController);
router.use(
  "/user-permissions",
  requireAuth,
  auditTrail("user-permissions"),
  userPermissionsController
);
router.use("/audit-trail", requireAuth, auditTrailController);
router.use("/settings", requireAuth, auditTrail("settings"), settingsController);
router.use("/dashboard", requireAuth, dashboardController);

export default router;
