//server
// route/scraper.route.js  (updated — quota endpoints)
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import {
  getPlatformsController,
  getJobsController,
  getJobByIdController,
  createAndRunJobController,
  deleteResultRowController,
  deleteBulkResultRowsController,
  importJobResultsController,
  deleteJobController,
} from "../controllers/scrape-job.controller.js";
import {
  checkQuotaController,
  getMyQuotaController,
  getAllQuotasController,
  setUserQuotaController,
  resetUserQuotaController,
} from "../controllers/scraper-quota.controller.js";

const scraperRouter = Router();
scraperRouter.use(auth);
scraperRouter.use(adminAuth);

// ── Quota routes ──────────────────────────────────────────────────────────────
scraperRouter.get("/quota/check", checkQuotaController); // user checks own quota before running
scraperRouter.get("/quota/me", getMyQuotaController); // user's quota summary
scraperRouter.get("/quota/all", getAllQuotasController); // Manager/IT/Director: all users
scraperRouter.put("/quota/:userId", setUserQuotaController); // Manager/IT/Director: set limit
scraperRouter.post("/quota/:userId/reset", resetUserQuotaController); // Manager/IT/Director: reset usage

// ── Job routes ────────────────────────────────────────────────────────────────
scraperRouter.get("/platforms", getPlatformsController);
scraperRouter.get("/jobs", getJobsController);
scraperRouter.get("/jobs/:id", getJobByIdController);
scraperRouter.post("/jobs", createAndRunJobController);

// Row-level delete (before import)
scraperRouter.delete("/jobs/:id/results/bulk", deleteBulkResultRowsController);
scraperRouter.delete("/jobs/:id/results/:index", deleteResultRowController);

scraperRouter.post("/jobs/:id/import", importJobResultsController);
scraperRouter.delete("/jobs/:id", deleteJobController);

export default scraperRouter;
