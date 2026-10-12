// route/catalogue.route.js — mounted at /api/admin/catalogue
import { Router } from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import { countryScope } from "../middleware/countryScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import catalogueAccess from "../middleware/catalogueAccess.js";
import {
  getCatalogueOptions,
  previewCatalogue,
  downloadCataloguePdf,
} from "../controllers/catalogue.controller.js";

const catalogueRouter = Router();
catalogueRouter.use(auth, adminAuth, countryScope, requirePermission("catalogue.download"), catalogueAccess);

catalogueRouter.get("/options", getCatalogueOptions);
catalogueRouter.post("/preview", previewCatalogue);
catalogueRouter.post("/pdf", downloadCataloguePdf);

export default catalogueRouter;
