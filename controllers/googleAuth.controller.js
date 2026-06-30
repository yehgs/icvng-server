/**
 * controllers/googleAuth.controller.js
 *
 * Google OAuth 2.0 — POPUP / TOKEN mode (no URL redirect).
 *
 * Flow (replaces the old redirect flow):
 *
 *   1. Client opens a popup to GET /api/auth/google/initiate
 *      (or uses the Google Identity Services JS SDK — see option 2 below)
 *   2. User grants permission. Google posts an auth code to the popup.
 *   3. Client sends POST /api/auth/google/token  { code, redirectUri }
 *   4. Server exchanges code for tokens, upserts user, returns our own
 *      JWT pair as JSON — no redirect, no tokens in URL query strings.
 *
 * Why no redirect?
 *   - Tokens in query strings leak into browser history, server logs,
 *     Referer headers, and analytics tools.
 *   - JSON response + localStorage storage is the standard SPA pattern.
 *
 * The two endpoints:
 *   GET  /api/auth/google          → build & return the Google OAuth URL (JSON)
 *   POST /api/auth/google/callback → exchange code, return { accessToken, refreshToken, user }
 */

import axios from "axios";
import jwt from "jsonwebtoken";
import UserModel from "../models/user.model.js";
import { getCountryByDomain, COUNTRY_CONFIG } from "../config/countries/index.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SERVER_BASE_URL      = process.env.SERVER_BASE_URL || "https://api.i-coffee.ng";

// The redirect_uri registered in Google Cloud Console.
// Must be your SERVER (not the client app) — we handle the code here.
// For popup flow the client passes its own redirect_uri that matches a
// registered Google OAuth redirect. We accept it as a parameter.
const DEFAULT_REDIRECT_URI = `${SERVER_BASE_URL}/api/auth/google/callback`;

// Allowed client origins to prevent open-redirect/CSRF
const ALLOWED_CLIENT_ORIGINS = Object.values(COUNTRY_CONFIG).flatMap((c) => [
  `https://${c.domain}`,
  `https://www.${c.domain}`,
]);
ALLOWED_CLIENT_ORIGINS.push(
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177"
);

function isAllowedOrigin(origin) {
  return ALLOWED_CLIENT_ORIGINS.some((o) => origin?.startsWith(o));
}

// ── STEP 1 — GET /api/auth/google ────────────────────────────────────────────
/**
 * Returns the Google OAuth URL as JSON so the client can open it
 * in a popup window (window.open) rather than a full-page redirect.
 *
 * Query params (all optional):
 *   ?redirectUri=https://...   — the URI registered with Google for popup close
 *   ?state=<opaque>            — caller-supplied state for CSRF protection
 *   ?prompt=select_account     — force account picker
 */
export async function initiateGoogleAuth(req, res) {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({
        success: false,
        error: true,
        message: "Google OAuth is not configured on this server.",
      });
    }

    const redirectUri = req.query.redirectUri || DEFAULT_REDIRECT_URI;
    const callerState = req.query.state || "";
    const prompt      = req.query.prompt || "select_account";

    // Validate redirectUri against allowed origins
    const parsedUri = new URL(redirectUri);
    if (!isAllowedOrigin(parsedUri.origin) && !redirectUri.startsWith(SERVER_BASE_URL)) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "Invalid redirectUri — not in allowed origins list.",
      });
    }

    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         "openid email profile",
      access_type:   "offline",
      state:         callerState,
      prompt,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Return the URL as JSON — the client opens it in a popup
    return res.json({
      success: true,
      error: false,
      data: { authUrl },
    });
  } catch (err) {
    console.error("[googleAuth] initiateGoogleAuth error:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "OAuth initiation failed.",
    });
  }
}

// ── STEP 2 — POST /api/auth/google/callback ───────────────────────────────────
/**
 * Exchanges a Google authorisation code for our own JWT tokens.
 * Called by the client after it receives the code from the popup.
 *
 * Body: { code: string, redirectUri: string }
 *
 * Returns: { success, data: { accessToken, refreshToken, user } }
 *
 * NO URL redirect. NO tokens in query strings.
 */
export async function handleGoogleCallback(req, res) {
  try {
    const { code, redirectUri } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "Missing authorisation code.",
      });
    }

    const effectiveRedirectUri = redirectUri || DEFAULT_REDIRECT_URI;

    // ── Exchange code for Google tokens ───────────────────────────────────
    let googleTokens;
    try {
      const tokenRes = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          code,
          client_id:     GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri:  effectiveRedirectUri,
          grant_type:    "authorization_code",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      googleTokens = tokenRes.data;
    } catch (tokenErr) {
      console.error("[googleAuth] token exchange error:", tokenErr?.response?.data || tokenErr.message);
      return res.status(400).json({
        success: false,
        error: true,
        message: "Failed to exchange code with Google. It may have expired.",
      });
    }

    const { access_token } = googleTokens;

    // ── Get user profile from Google ──────────────────────────────────────
    let googleUser;
    try {
      const profileRes = await axios.get(
        "https://www.googleapis.com/oauth2/v1/userinfo",
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      googleUser = profileRes.data;
    } catch (profileErr) {
      console.error("[googleAuth] profile fetch error:", profileErr.message);
      return res.status(400).json({
        success: false,
        error: true,
        message: "Failed to fetch Google profile.",
      });
    }

    const { id: googleId, email, name, picture } = googleUser;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "Google account has no email address.",
      });
    }

    // ── Upsert user in our DB ─────────────────────────────────────────────
    let user = await UserModel.findOne({ email });

    if (user) {
      user.googleId        = user.googleId || googleId;
      user.avatar          = user.avatar   || picture;
      user.verify_email    = true;
      user.last_login_date = new Date();
      await user.save();
    } else {
      user = await UserModel.create({
        name,
        email,
        googleId,
        avatar:          picture,
        verify_email:    true,
        mobile:          null,
        role:            "USER",
        status:          "Active",
        last_login_date: new Date(),
        // Password not required for OAuth users; set a random placeholder
        password:        Math.random().toString(36).slice(-12) + "Gg1!",
      });
    }

    // ── Issue our own JWTs ────────────────────────────────────────────────
    const accessToken = jwt.sign(
      { id: user._id, email: user.email },
      process.env.SECRET_KEY_ACCESS_TOKEN,
      { expiresIn: "5h" }
    );
    const refreshToken = jwt.sign(
      { id: user._id, email: user.email },
      process.env.SECRET_KEY_REFRESH_TOKEN,
      { expiresIn: "7d" }
    );

    await UserModel.findByIdAndUpdate(user._id, { refresh_token: refreshToken });

    // ── Return tokens as JSON (no URL redirect) ───────────────────────────
    return res.json({
      success: true,
      error: false,
      message: "Google authentication successful",
      data: {
        accessToken,
        refreshToken,
        user: {
          _id:          user._id,
          name:         user.name,
          email:        user.email,
          role:         user.role,
          subRole:      user.subRole,
          avatar:       user.avatar,
          verify_email: user.verify_email,
        },
      },
    });
  } catch (err) {
    console.error("[googleAuth] handleGoogleCallback error:", err.message);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Server error during Google authentication.",
    });
  }
}
