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
} from "../controllers/translation.controller.js";

const translationRouter = express.Router();

// Public (client reads translations without auth)
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
