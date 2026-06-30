/**
 * route/foreign-admin.route.js
 */
import express from "express";
import auth from "../middleware/auth.js";
import adminAuth from "../middleware/adminAuth.js";
import {
  createForeignAdmin,
  listForeignAdmins,
  updateForeignAdmin,
  updateForeignAdminSubRoles,
  deleteForeignAdmin,
  promoteToForeignAdmin,
} from "../controllers/foreignAdmin.controller.js";

const foreignAdminRouter = express.Router();

// All routes require auth + admin
foreignAdminRouter.use(auth, adminAuth);

foreignAdminRouter.post("/", createForeignAdmin);
foreignAdminRouter.get("/", listForeignAdmins);
foreignAdminRouter.patch("/:id", updateForeignAdmin);
foreignAdminRouter.patch("/:id/subroles", updateForeignAdminSubRoles);
foreignAdminRouter.delete("/:id", deleteForeignAdmin);

export default foreignAdminRouter;
