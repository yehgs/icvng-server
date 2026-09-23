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
// rows are keyed by (app, key, language), not by country — so this grants
// the same UNSCOPED write access to UI copy that translation.route.js
// already grants for content translations, not a per-country-isolated
// version of it. A Togo MANAGER editing "fr" affects Benin's storefront
// too (both default to fr); there is no per-country UI-copy isolation to
// enforce here, only per-language, which isn't the same thing.
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
