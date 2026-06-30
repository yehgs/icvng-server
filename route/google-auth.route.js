/**
 * route/google-auth.route.js
 *
 * GET  /api/auth/google           → returns { authUrl } as JSON (no redirect)
 * POST /api/auth/google/callback  → exchanges code, returns { accessToken, refreshToken, user }
 */

import express from "express";
import { initiateGoogleAuth, handleGoogleCallback } from "../controllers/googleAuth.controller.js";

const googleAuthRouter = express.Router();

// Step 1: Client requests the Google OAuth URL
googleAuthRouter.get("/", initiateGoogleAuth);

// Step 2: Client posts the code it received from the popup
googleAuthRouter.post("/callback", handleGoogleCallback);

export default googleAuthRouter;
