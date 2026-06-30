/**
 * route/seo.route.js
 */
import express from "express";
import { robotsTxt, sitemapXml, getSeoMeta } from "../controllers/seo.controller.js";

const seoRouter = express.Router();

seoRouter.get("/robots.txt", robotsTxt);
seoRouter.get("/sitemap.xml", sitemapXml);
seoRouter.get("/api/seo/meta", getSeoMeta);

export default seoRouter;
