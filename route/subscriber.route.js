// route/subscriber.route.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { subscribeController, listSubscribersController } from "../controllers/subscriber.controller.js";

const subscriberRouter = Router();

// Public — anyone on the storefront can subscribe. No auth.
subscriberRouter.post("/subscribe", subscribeController);

// Admin — country-scoped, gated on the same contact.view permission as
// contact messages (they're both "inbound marketing contact" data).
subscriberRouter.get(
  "/admin/subscribers",
  auth,
  adminAuth,
  countryScope,
  requirePermission("contact.view"),
  listSubscribersController
);

export default subscriberRouter;
