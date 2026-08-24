// route/language.route.js
import { Router } from "express";
import { guard, guardPublic } from "../core/guard.js";
import {
  getActiveLanguagesController,
  getAllLanguagesController,
  createLanguageController,
  updateLanguageController,
  deleteLanguageController,
} from "../controllers/language.controller.js";

const languageRouter = Router();

// Public — client + admin language switchers only need the active list.
languageRouter.get("/active", ...guardPublic(), getActiveLanguagesController);

// Admin CRUD — gated on the same translations.view/translations.manage
// permissions that already govern the rest of the translation system
// (EDITOR holds both), since the language lib is part of that system.
const view = () =>
  guard({
    permissions: ["translations.view", "translations.manage"],
    mode: "any",
    hqOnly: true,
  });
const manage = () => guard({ permissions: "translations.manage", hqOnly: true });

languageRouter.get("/", ...view(), getAllLanguagesController);
languageRouter.post("/", ...manage(), createLanguageController);
languageRouter.put("/:languageId", ...manage(), updateLanguageController);
languageRouter.delete("/:languageId", ...manage(), deleteLanguageController);

export default languageRouter;
