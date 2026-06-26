//server
// route/scraper.route.js  (v2)
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

const scraperRouter = Router();
scraperRouter.use(auth);
scraperRouter.use(adminAuth);

scraperRouter.get("/platforms", getPlatformsController);
scraperRouter.get("/jobs", getJobsController);
scraperRouter.get("/jobs/:id", getJobByIdController);
scraperRouter.post("/jobs", createAndRunJobController);

// Row-level delete within a completed job
scraperRouter.delete("/jobs/:id/results/bulk", deleteBulkResultRowsController);
scraperRouter.delete("/jobs/:id/results/:index", deleteResultRowController);

scraperRouter.post("/jobs/:id/import", importJobResultsController);
scraperRouter.delete("/jobs/:id", deleteJobController);

export default scraperRouter;
