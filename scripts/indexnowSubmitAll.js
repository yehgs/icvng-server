// node scripts/indexnowSubmitAll.js [NG TG BJ IT]
// One-off: reads each country's LIVE sitemaps and submits every URL to IndexNow (Bing, Yandex, Seznam, Naver, …).
// Needs INDEXNOW_KEY (same value the server serves at /indexnow-key.txt) and outbound internet.
import "dotenv/config";
import { COUNTRY_CONFIG } from "../config/countries/index.js";

const key = process.env.INDEXNOW_KEY;
if (!key) { console.error("Set INDEXNOW_KEY first."); process.exit(1); }
const codes = process.argv.slice(2).length ? process.argv.slice(2).map((c) => c.toUpperCase()) : Object.keys(COUNTRY_CONFIG);

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
for (const code of codes) {
  const c = COUNTRY_CONFIG[code]; if (!c) { console.warn("skip", code); continue; }
  const base = `https://${c.domain}`;
  const parts = locs(await (await fetch(`${base}/sitemap.xml`)).text());
  const urls = [];
  for (const part of parts) urls.push(...locs(await (await fetch(part)).text()));
  for (let i = 0; i < urls.length; i += 10000) {
    const r = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: c.domain, key, keyLocation: `${base}/indexnow-key.txt`, urlList: urls.slice(i, i + 10000) }),
    });
    console.log(code, `${Math.min(i + 10000, urls.length)}/${urls.length}`, "HTTP", r.status); // 200/202 = accepted
  }
}
