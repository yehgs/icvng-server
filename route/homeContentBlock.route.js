// server/route/homeContentBlock.route.js
import { Router } from "express";
import auth from "../middleware/auth.js";
import { countryScope, assertCountryAccess } from "../middleware/countryScope.js";
import {
  getPublicHomeContentBlocks,
  getAdminHomeContentBlocks,
  createHomeContentBlock,
  updateHomeContentBlock,
  deleteHomeContentBlock,
} from "../controllers/homeContentBlock.controller.js";

const homeContentBlockRouter = Router();

// Public — storefront (trust-badge strip + testimonials grid), scoped to
// the visited domain's country with HQ (Nigeria) fallback.
homeContentBlockRouter.get("/public", getPublicHomeContentBlocks);

// Admin — countryScope activates per-country isolation: an editor assigned
// to a country only sees/edits that market's trust badges and testimonials.
homeContentBlockRouter.get("/admin", auth, countryScope, getAdminHomeContentBlocks);
homeContentBlockRouter.post("/add", auth, countryScope, assertCountryAccess("body.countryCode"), createHomeContentBlock);
homeContentBlockRouter.put("/update", auth, countryScope, updateHomeContentBlock);
homeContentBlockRouter.delete("/delete", auth, countryScope, deleteHomeContentBlock);

export default homeContentBlockRouter;
