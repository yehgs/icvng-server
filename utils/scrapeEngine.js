//server
// utils/scrapeEngine.js  (updated — B2C people-search support)
// B2C mode automatically builds people-targeting queries and returns
// { fullName, jobTitle, email, phone, ... } instead of company-centric results.
//
// Install: npm install cheerio serpapi

import axios from "axios";

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?234|0)(?:[\s\-.]?\d){9,10}/g;

const KNOWN_DOMAINS = {
  "vconnect.com": scrapeVConnect,
  "yellowpages.com.ng": scrapeYellowPagesNG,
};

function uniqueArr(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractFromHtml(html) {
  const emails = uniqueArr(
    (html.match(EMAIL_REGEX) || []).filter(
      (e) => !e.includes("example.com") && !e.includes("yourdomain"),
    ),
  );
  const phones = uniqueArr(html.match(PHONE_REGEX) || []);
  return { emails, phones };
}

async function fetchHtml(url, timeoutMs = 15000) {
  const { data } = await axios.get(url, {
    timeout: timeoutMs,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  return data;
}

// ── B2C: build people-targeted query ────────────────────────────────────────
// For individual (B2C) searches we append context that surfaces personal profiles
// and directories rather than business listings.
function buildB2CQuery(baseQuery) {
  const lower = baseQuery.toLowerCase();
  // If query already looks person-focused, keep it
  if (
    lower.includes("profile") ||
    lower.includes("contact") ||
    lower.includes("linkedin.com/in")
  ) {
    return baseQuery;
  }
  // Append people-search context
  return `${baseQuery} contact email phone Nigeria`;
}

// ── B2C: parse a result as an individual person ──────────────────────────────
function parseB2CResult(r) {
  // Try to detect a personal name from title (heuristic: ≤4 words, no Inc/Ltd/Co)
  const title = r.title || r.companyName || "";
  const isPersonName =
    title.split(" ").length <= 4 &&
    !/\b(Ltd|Inc|Co\.|Corp|Limited|Nigeria|Group|Services|Global)\b/i.test(
      title,
    );

  return {
    fullName: isPersonName ? title : "",
    companyName: isPersonName ? "" : title,
    jobTitle:
      r.jobTitle || r.rich_snippet?.top?.detected_extensions?.category || "",
    email: r.email || "",
    emails: r.emails || [],
    phone: r.phone || "",
    phones: r.phones || [],
    website: r.link || r.website || "",
    linkedinUrl: r.link?.includes("linkedin.com")
      ? r.link
      : r.linkedinUrl || "",
    description: r.snippet || r.description || "",
    source: r.scrapeSource || r.link || "",
    scrapeSource: r.scrapeSource || r.link || "",
    leadType: "B2C",
  };
}

// ── Google Search via SerpAPI ─────────────────────────────────────────────────
async function scrapeGoogleSearch(job) {
  const results = [];
  const apiKey = process.env.SERP_API_KEY;
  const isB2C = job.leadType === "B2C";

  if (!apiKey) {
    const cseKey = process.env.GOOGLE_CSE_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (cseKey && cseId) return scrapeGoogleCSE(job, cseKey, cseId);
    throw new Error("SERP_API_KEY or GOOGLE_CSE_KEY not configured");
  }

  const { getJson } = await import("serpapi");
  const query = isB2C ? buildB2CQuery(job.searchQuery) : job.searchQuery;

  for (let page = 0; page < job.maxPages; page++) {
    const data = await getJson({
      engine: "google",
      q: query,
      api_key: apiKey,
      num: 10,
      start: page * 10,
      gl: "ng",
      hl: "en",
    });

    for (const r of data.organic_results || []) {
      const entry = isB2C
        ? parseB2CResult({ ...r, scrapeSource: r.link })
        : {
            companyName: r.title || "",
            website: r.link || "",
            description: r.snippet || "",
            scrapeSource: r.link,
          };

      // Augment with email/phone from the actual page
      if (r.link && job.extractFields?.emails) {
        try {
          const html = await fetchHtml(r.link, 8000);
          const ex = extractFromHtml(html);
          entry.emails = ex.emails;
          entry.phones = ex.phones;
          if (isB2C && ex.emails[0]) entry.email = ex.emails[0];
        } catch {
          /* skip */
        }
      }
      results.push(entry);
      if (results.length >= job.maxResults) break;
    }
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── B2C: LinkedIn People search ───────────────────────────────────────────────
async function scrapeLinkedInPeople(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY required");
  const { getJson } = await import("serpapi");
  const results = [];

  // site:linkedin.com/in finds individual profiles, not companies
  const query = `site:linkedin.com/in ${job.searchQuery}`;
  const data = await getJson({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: Math.min(10, job.maxResults),
    gl: "ng",
  });

  for (const r of data.organic_results || []) {
    const namePart = r.title
      ?.replace(" | LinkedIn", "")
      .replace(" - LinkedIn", "")
      .split(" - ")[0]
      .trim();
    const jobTitlePart = r.title?.split(" - ")[1]?.trim() || "";
    results.push({
      fullName: namePart || "",
      companyName: "",
      jobTitle: jobTitlePart,
      linkedinUrl: r.link || "",
      description: r.snippet || "",
      scrapeSource: r.link,
      leadType: "B2C",
    });
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── Google Custom Search Engine (CSE) ────────────────────────────────────────
async function scrapeGoogleCSE(job, apiKey, cseId) {
  const results = [];
  const isB2C = job.leadType === "B2C";
  const query = isB2C ? buildB2CQuery(job.searchQuery) : job.searchQuery;

  for (let page = 0; page < job.maxPages; page++) {
    const start = page * 10 + 1;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&start=${start}&num=10`;
    const { data } = await axios.get(url);
    for (const item of data.items || []) {
      const entry = isB2C
        ? parseB2CResult({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            scrapeSource: item.link,
          })
        : {
            companyName: item.title,
            website: item.link,
            description: item.snippet,
            scrapeSource: item.link,
          };

      if (item.link && job.extractFields?.emails) {
        try {
          const html = await fetchHtml(item.link, 8000);
          const ex = extractFromHtml(html);
          entry.emails = ex.emails;
          entry.phones = ex.phones;
        } catch {
          /* skip */
        }
      }
      results.push(entry);
      if (results.length >= job.maxResults) break;
    }
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── Google Maps ───────────────────────────────────────────────────────────────
async function scrapeGoogleMaps(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY required for Google Maps");

  const { getJson } = await import("serpapi");
  const results = [];
  const data = await getJson({
    engine: "google_maps",
    q: job.searchQuery,
    api_key: apiKey,
    ll: "@6.5244,3.3792,12z",
    type: "search",
  });

  for (const place of data.local_results || []) {
    results.push({
      companyName: place.title || "",
      address: place.address || "",
      phone: place.phone || "",
      website: place.website || "",
      rating: place.rating,
      category: place.type || "",
      scrapeSource: place.place_id_search || "",
      leadType: job.leadType || "B2B",
    });
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── LinkedIn (B2B: company pages) ─────────────────────────────────────────────
async function scrapeLinkedIn(job) {
  if (job.leadType === "B2C") return scrapeLinkedInPeople(job);

  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY required for LinkedIn");
  const { getJson } = await import("serpapi");
  const results = [];
  const query = `site:linkedin.com/company ${job.searchQuery}`;
  const data = await getJson({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: Math.min(10, job.maxResults),
    gl: "ng",
  });

  for (const r of data.organic_results || []) {
    results.push({
      companyName:
        r.title?.replace(" | LinkedIn", "").replace(" - LinkedIn", "").trim() ||
        "",
      linkedinUrl: r.link || "",
      description: r.snippet || "",
      scrapeSource: r.link,
    });
  }
  return results;
}

// ── Facebook ──────────────────────────────────────────────────────────────────
async function scrapeFacebook(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY required for Facebook");
  const { getJson } = await import("serpapi");
  const results = [];
  // B2C: search personal profiles (facebook.com/people or regular profiles)
  // B2B: search business pages
  const query =
    job.leadType === "B2C"
      ? `site:facebook.com ${job.searchQuery} -pages`
      : `site:facebook.com/pages ${job.searchQuery}`;

  const data = await getJson({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: Math.min(10, job.maxResults),
    gl: "ng",
  });

  for (const r of data.organic_results || []) {
    const entry =
      job.leadType === "B2C"
        ? parseB2CResult({ ...r, scrapeSource: r.link })
        : {
            companyName: r.title || "",
            facebookUrl: r.link || "",
            description: r.snippet || "",
            scrapeSource: r.link,
          };
    results.push(entry);
  }
  return results;
}

// ── VConnect NG ───────────────────────────────────────────────────────────────
async function scrapeVConnect(job) {
  const results = [];
  try {
    const { load } = await import("cheerio");
    for (let page = 1; page <= job.maxPages; page++) {
      const url = `https://www.vconnect.com/search?q=${encodeURIComponent(job.searchQuery)}&page=${page}`;
      const html = await fetchHtml(url);
      const $ = load(html);
      $('.search-result-item, .company-card, [class*="result"]').each(
        (_, el) => {
          const name = $(el)
            .find('h2,h3,[class*="name"],[class*="title"]')
            .first()
            .text()
            .trim();
          const phone = $(el)
            .find('[class*="phone"],[href^="tel:"]')
            .first()
            .text()
            .trim();
          const email =
            $(el).find('[href^="mailto:"]').first().text().trim() || "";
          const addr = $(el)
            .find('[class*="address"],[class*="location"]')
            .first()
            .text()
            .trim();
          if (name)
            results.push({
              companyName: name,
              phone,
              email,
              address: addr,
              scrapeSource: url,
            });
        },
      );
      if (results.length >= job.maxResults) break;
    }
  } catch (err) {
    throw new Error(`VConnect scrape failed: ${err.message}`);
  }
  return results.slice(0, job.maxResults);
}

// ── Yellow Pages NG ───────────────────────────────────────────────────────────
async function scrapeYellowPagesNG(job) {
  const results = [];
  try {
    const { load } = await import("cheerio");
    for (let page = 1; page <= job.maxPages; page++) {
      const url = `https://www.yellowpages.com.ng/search?q=${encodeURIComponent(job.searchQuery)}&page=${page}`;
      const html = await fetchHtml(url);
      const $ = load(html);
      $('.listing, .business-card, [class*="business"]').each((_, el) => {
        const name = $(el).find('h2,h3,[class*="title"]').first().text().trim();
        const phone = $(el)
          .find('[class*="phone"],[href^="tel:"]')
          .first()
          .text()
          .trim();
        const email =
          $(el).find('[href^="mailto:"]').first().text().trim() || "";
        const addr = $(el).find('[class*="address"]').first().text().trim();
        if (name)
          results.push({
            companyName: name,
            phone,
            email,
            address: addr,
            scrapeSource: url,
          });
      });
      if (results.length >= job.maxResults) break;
    }
  } catch (err) {
    throw new Error(`Yellow Pages NG scrape failed: ${err.message}`);
  }
  return results.slice(0, job.maxResults);
}

// ── Custom URL ────────────────────────────────────────────────────────────────
async function scrapeCustomUrl(job) {
  const results = [];
  try {
    const { load } = await import("cheerio");
    const html = await fetchHtml(job.targetUrl);
    const $ = load(html);
    const { emails, phones } = extractFromHtml(html);

    const listingSelectors = [
      '[class*="listing"]',
      '[class*="card"]',
      '[class*="result"]',
      "article",
      ".item",
      ".entry",
    ];
    let found = false;
    for (const selector of listingSelectors) {
      const els = $(selector);
      if (els.length > 2) {
        els.each((_, el) => {
          const name = $(el)
            .find('h1,h2,h3,h4,[class*="title"],[class*="name"]')
            .first()
            .text()
            .trim();
          const phone = $(el)
            .find('[class*="phone"],[href^="tel:"]')
            .first()
            .text()
            .trim();
          const emailEl = $(el).find('[href^="mailto:"]').first().text().trim();
          const addr = $(el)
            .find('[class*="address"],[class*="location"]')
            .first()
            .text()
            .trim();
          const link = $(el).find("a[href]").first().attr("href") || "";
          if (name)
            results.push({
              companyName: name,
              phone,
              email: emailEl,
              address: addr,
              website: link.startsWith("http") ? link : "",
              scrapeSource: job.targetUrl,
            });
        });
        found = true;
        break;
      }
    }
    if (!found) {
      const title = $("title").text().trim();
      results.push({
        companyName: title,
        emails,
        phones,
        website: job.targetUrl,
        scrapeSource: job.targetUrl,
      });
    }
  } catch (err) {
    throw new Error(`Custom URL scrape failed: ${err.message}`);
  }
  return results.slice(0, job.maxResults);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────
export async function runScrapeJob(job) {
  switch (job.platform) {
    case "Google Search":
      return scrapeGoogleSearch(job);
    case "Google Maps":
      return scrapeGoogleMaps(job);
    case "LinkedIn":
      return scrapeLinkedIn(job); // auto-switches to people search for B2C
    case "Facebook":
      return scrapeFacebook(job);
    case "VConnect NG":
      return scrapeVConnect(job);
    case "Yellow Pages NG":
      return scrapeYellowPagesNG(job);
    case "Custom URL":
      return scrapeCustomUrl(job);
    default:
      return scrapeGoogleSearch(job);
  }
}
