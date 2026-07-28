// route/contact-message.route.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listContactMessagesController,
  updateContactMessageStatusController,
} from "../controllers/contact-message.controller.js";

const contactMessageRouter = Router();

contactMessageRouter.use(auth);
contactMessageRouter.use(adminAuth);
contactMessageRouter.use(countryScope); // populates req.countryScope for country-filtered reads/writes
contactMessageRouter.use(requirePermission("contact.view"));

contactMessageRouter.get("/", listContactMessagesController);
contactMessageRouter.patch("/:id/status", requirePermission("contact.manage"), updateContactMessageStatusController);

export default contactMessageRouter;
