// route/uiTranslation.route.js
import { Router } from "express";
import { guard, guardPublic } from "../core/guard.js";
import {
  getMergedUiTranslationsController,
  getUiTranslationNamespacesController,
  listUiTranslationsController,
  upsertUiTranslationController,
} from "../controllers/uiTranslation.controller.js";

const uiTranslationRouter = Router();

// Public — the live admin/client apps fetch this on boot/language change
// (see i18n/index.js in each app). UI chrome, not sensitive.
uiTranslationRouter.get("/merged", ...guardPublic(), getMergedUiTranslationsController);

// Admin browse/edit — same permissions as the rest of the translation
// system (translations.view/.manage — EDITOR/MANAGER/IT/DIRECTOR).
const view = () =>
  guard({
    permissions: ["translations.view", "translations.manage"],
    mode: "any",
    hqOnly: true,
  });
const manage = () => guard({ permissions: "translations.manage", hqOnly: true });

uiTranslationRouter.get("/namespaces", ...view(), getUiTranslationNamespacesController);
uiTranslationRouter.get("/", ...view(), listUiTranslationsController);
uiTranslationRouter.put("/", ...manage(), upsertUiTranslationController);

export default uiTranslationRouter;
