//server
// route/profile.route.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { uploadImage } from "../middleware/multer.js";
import {
  getProfileController,
  updateProfileController,
  updateAvatarController,
  changeOwnPasswordController,
  forgotPasswordRequestController,
} from "../controllers/profile.controller.js";

const profileRouter = Router();

// ── Public (no auth) — forgot password request from login page ───────────────
profileRouter.post("/forgot-password-request", forgotPasswordRequestController);

// ── Protected — requires auth ─────────────────────────────────────────────────
profileRouter.use(auth);
profileRouter.use(adminAuth);

profileRouter.get("/me", getProfileController);
profileRouter.put("/update", updateProfileController);
profileRouter.post(
  "/avatar",
  uploadImage.single("image"),
  updateAvatarController,
);
profileRouter.put("/change-password", changeOwnPasswordController);

export default profileRouter;
