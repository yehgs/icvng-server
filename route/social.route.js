// server/route/social.route.js
//   PUBLIC  GET /api/social/public
//   ADMIN   /api/social/admin/*   (auth + admin + requirePermission; country decided in the controller)
import { Router } from "express";
import auth from "../middleware/auth.js";
import { admin } from "../middleware/Admin.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { socialMeta, listSocial, createSocial, updateSocial, deleteSocial, reorderSocial, publicSocial } from "../controllers/social.controller.js";

const router = Router();
router.get("/public", publicSocial);

const base = [auth, admin];
const view = [...base, requirePermission("social.view")];
const manage = [...base, requirePermission("social.manage")];
router.get("/admin/meta", ...view, socialMeta);
router.get("/admin/list", ...view, listSocial);
router.post("/admin/create", ...manage, createSocial);
router.post("/admin/reorder", ...manage, reorderSocial);
router.put("/admin/:id", ...manage, updateSocial);
router.delete("/admin/:id", ...manage, deleteSocial);
export default router;
