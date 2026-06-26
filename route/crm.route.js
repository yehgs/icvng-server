//server
// route/crm.route.js  (updated)
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import {
  getCrmMetaController,
  getLeadsController,
  createLeadController,
  updateLeadController,
  moveLeadStageController,
  deleteLeadController,
  reviewDeleteRequestController,
  getDeleteRequestsController,
  addActivityController,
  bulkImportLeadsController,
  getCrmStatsController,
} from "../controllers/crm-lead.controller.js";

const crmRouter = Router();
crmRouter.use(auth);
crmRouter.use(adminAuth);

crmRouter.get("/meta", getCrmMetaController);
crmRouter.get("/stats", getCrmStatsController);
crmRouter.get("/leads", getLeadsController);
crmRouter.get("/delete-requests", getDeleteRequestsController);
crmRouter.post("/leads", createLeadController);
crmRouter.post("/leads/bulk-import", bulkImportLeadsController);
crmRouter.put("/leads/:id", updateLeadController);
crmRouter.put("/leads/:id/stage", moveLeadStageController);
crmRouter.delete("/leads/:id", deleteLeadController); // body: { reason } for non-IT/Director
crmRouter.put("/leads/:id/delete-request", reviewDeleteRequestController); // body: { action: 'approve'|'reject', reviewNote }
crmRouter.post("/leads/:id/activity", addActivityController);

export default crmRouter;
