/**
 * route/seo.route.js
 *
 * Mounted at "/" and "/api/seo" (see index.js). The storefront's vercel.json rewrites
 * /robots.txt, /sitemap*.xml, /indexnow-key.txt and crawler user-agents to the /api/seo/* paths.
 */
import express from "express";
import {
  robotsTxt,
  sitemapFile,
  renderForCrawler,
  indexNowKeyFile,
  getSeoMeta,
} from "../controllers/seo.controller.js";

const seoRouter = express.Router();

seoRouter.get("/robots/:code", robotsTxt);
seoRouter.get("/sitemap/:code/:file", sitemapFile);
seoRouter.get("/render/:code", renderForCrawler);
seoRouter.get("/indexnow-key.txt", indexNowKeyFile);
seoRouter.get("/meta", getSeoMeta);

// Direct hits on the API host (e.g. api.i-coffee.ng/robots.txt) keep working for the detected country.
seoRouter.get("/robots.txt", (req, res) => robotsTxt({ ...req, params: { code: req.country?.code } }, res));
seoRouter.get("/sitemap.xml", (req, res) => sitemapFile({ ...req, params: { code: req.country?.code, file: "index" } }, res));

export default seoRouter;
