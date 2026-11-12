// server/route/marketing.route.js
//   PUBLIC  GET|POST /api/marketing/unsubscribe   (signed link, one-click)
//   ADMIN   /api/marketing/admin/*                (auth + admin + requirePermission)
// Territory (whose customers) is decided inside the controller from utils/featureScope.js.
import { Router } from "express";
import auth from "../middleware/auth.js";
import { admin } from "../middleware/Admin.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getMarketingMeta, listMarketing, getMarketing, audienceCount, createMarketing, updateMarketing, duplicateMarketing,
  deleteMarketing, previewMarketing, testSendMarketing, sendMarketing, processMarketingBatch, cancelMarketing,
  listRecipients, unsubscribe,
} from "../controllers/marketing.controller.js";

const router = Router();
router.get("/unsubscribe", unsubscribe);
router.post("/unsubscribe", unsubscribe);

const base = [auth, admin];
const view = [...base, requirePermission("marketing.view")];
const manage = [...base, requirePermission("marketing.manage")];
const send = [...base, requirePermission("marketing.send")];

router.get("/admin/meta", ...view, getMarketingMeta);
router.get("/admin/list", ...view, listMarketing);
router.get("/admin/audience/count", ...view, audienceCount);
router.post("/admin/preview", ...manage, previewMarketing);
router.post("/admin/create", ...manage, createMarketing);
router.get("/admin/:id", ...view, getMarketing);
router.get("/admin/:id/preview", ...view, previewMarketing);
router.get("/admin/:id/recipients", ...view, listRecipients);
router.put("/admin/:id", ...manage, updateMarketing);
router.post("/admin/:id/duplicate", ...manage, duplicateMarketing);
router.post("/admin/:id/test", ...manage, testSendMarketing);
router.delete("/admin/:id", ...manage, deleteMarketing);
router.post("/admin/:id/send", ...send, sendMarketing);
router.post("/admin/:id/process-batch", ...send, processMarketingBatch);
router.post("/admin/:id/cancel", ...send, cancelMarketing);

export default router;
