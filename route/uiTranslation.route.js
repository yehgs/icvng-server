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
//
// FIX: this used to also pass hqOnly: true, which inserts
// blockCountryScopedAdmins into the guard chain — that hard-blocks ANY
// country-scoped admin regardless of permissions held, contradicting (a)
// translations.view/.manage's own hqOnly: false in config/permissions.js,
// (b) route/translation.route.js (DB-content translations for products/
// categories/etc.), which already lets a country-scoped MANAGER through
// with no scope restriction at all, and (c) App.jsx's frontend route,
// which already lists MANAGER in allowedSubRoles. A Togo/Benin MANAGER
// needs this to translate their own storefront's UI copy — hqOnly here was
// blocking that with a 403 despite everything else in the app already
// intending to allow it.
//
// Worth noting plainly: uiTranslation.model.js has no countryCode field —
// rows are keyed by (app, key, language), not by country. A country-scoped
// admin is now restricted to their own country's PRIMARY language only
// (see getAllowedLanguagesForRequest in the controller — enforced on both
// the list/browse and the upsert endpoints), which narrows their blast
// radius considerably, but it is still not full per-country isolation:
// Togo and Benin both default to "fr", so a Togo MANAGER editing "fr"
// still affects Benin's storefront too. There is no way to separate those
// two within a single shared language, only to keep a manager out of
// languages that aren't theirs at all (e.g. a Togo manager can't touch
// "it" or "en").
const view = () =>
  guard({
    permissions: ["translations.view", "translations.manage"],
    mode: "any",
  });
const manage = () => guard({ permissions: "translations.manage" });

uiTranslationRouter.get("/namespaces", ...view(), getUiTranslationNamespacesController);
uiTranslationRouter.get("/", ...view(), listUiTranslationsController);
uiTranslationRouter.put("/", ...manage(), upsertUiTranslationController);

export default uiTranslationRouter;
