/**
 * route/translation.route.js
 */
import express from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import {
  triggerTranslation,
  getEntityTranslation,
  getAllTranslationsForEntity,
  updateTranslation,
  translateSingleText,
  getBulkTranslationsController,
} from "../controllers/translation.controller.js";

const translationRouter = express.Router();

// Public (client reads translations without auth)
// PHASE 5: bulk endpoint — one request for a whole product grid (fixes N+1).
translationRouter.post("/bulk", getBulkTranslationsController);
translationRouter.get(
  "/:entityType/:entityId/:language",
  getEntityTranslation
);

// Admin only
translationRouter.use(auth, adminAuth);

translationRouter.post("/trigger", triggerTranslation);
translationRouter.post("/text", translateSingleText);
translationRouter.get("/:entityType/:entityId", getAllTranslationsForEntity);
translationRouter.put(
  "/:entityType/:entityId/:language",
  updateTranslation
);

export default translationRouter;
