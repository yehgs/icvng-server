//server
// utils/scrapeEngine.js
//
// Uses:
//  - axios + cheerio  for direct HTML parsing  (npm install cheerio)
//  - SerpAPI          for Google/Maps results   (npm install serpapi)  — optional, uses SERP_API_KEY env
//  - Custom regex     for email/phone extraction from raw HTML
//
// Install: npm install cheerio serpapi

import axios from 'axios';

// ── Regex patterns ──────────────────────────────────────────────────────────
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?234|0)(?:[\s\-.]?\d){9,10}/g;
const PHONE_INTL_REGEX = /\+?[\d\s\-().]{10,18}/g;

// ── Nigerian / African listing domains we know the structure of ───────────────
const KNOWN_DOMAINS = {
  'vconnect.com': scrapeVConnect,
  'yellowpages.com.ng': scrapeYellowPagesNG,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function uniqueArr(arr) { return [...new Set(arr.filter(Boolean))]; }

function extractFromHtml(html) {
  const emails = uniqueArr((html.match(EMAIL_REGEX) || [])
    .filter((e) => !e.includes('example.com') && !e.includes('yourdomain')));
  const phones = uniqueArr((html.match(PHONE_REGEX) || []));
  return { emails, phones };
}

async function fetchHtml(url, timeoutMs = 15000) {
  const { data } = await axios.get(url, {
    timeout: timeoutMs,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  return data;
}

// ── Google Search via SerpAPI ─────────────────────────────────────────────────
async function scrapeGoogleSearch(job) {
  const results = [];
  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    // Fallback: use Google Custom Search JSON API if available
    const cseKey = process.env.GOOGLE_CSE_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (cseKey && cseId) {
      return scrapeGoogleCSE(job, cseKey, cseId);
    }
    throw new Error('SERP_API_KEY or GOOGLE_CSE_KEY not configured. Please add to .env');
  }

  try {
    const { getJson } = await import('serpapi');
    for (let page = 0; page < job.maxPages; page++) {
      const data = await getJson({
        engine: 'google',
        q: job.searchQuery,
        api_key: apiKey,
        num: 10,
        start: page * 10,
        gl: 'ng',
        hl: 'en',
      });

      const organicResults = data.organic_results || [];
      for (const r of organicResults) {
        const entry = {
          companyName: r.title || '',
          website: r.link || '',
          description: r.snippet || '',
          scrapeSource: r.link,
        };
        // Try to fetch the website to get email/phone
        if (r.link && job.extractFields.emails) {
          try {
            const html = await fetchHtml(r.link, 8000);
            const extracted = extractFromHtml(html);
            entry.emails = extracted.emails;
            entry.phones = extracted.phones;
          } catch { /* skip if fetch fails */ }
        }
        results.push(entry);
        if (results.length >= job.maxResults) break;
      }
      if (results.length >= job.maxResults) break;
    }
  } catch (err) {
    throw new Error(`Google Search scrape failed: ${err.message}`);
  }
  return results;
}

// ── Google Custom Search Engine (CSE) ────────────────────────────────────────
async function scrapeGoogleCSE(job, apiKey, cseId) {
  const results = [];
  for (let page = 0; page < job.maxPages; page++) {
    const start = page * 10 + 1;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(job.searchQuery)}&start=${start}&num=10`;
    const { data } = await axios.get(url);
    const items = data.items || [];
    for (const item of items) {
      const entry = { companyName: item.title, website: item.link, description: item.snippet, scrapeSource: item.link };
      if (item.link && job.extractFields.emails) {
        try {
          const html = await fetchHtml(item.link, 8000);
          const ex = extractFromHtml(html);
          entry.emails = ex.emails;
          entry.phones = ex.phones;
        } catch { /* skip */ }
      }
      results.push(entry);
      if (results.length >= job.maxResults) break;
    }
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── Google Maps (via SerpAPI) ─────────────────────────────────────────────────
async function scrapeGoogleMaps(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error('SERP_API_KEY required for Google Maps scraping');

  const { getJson } = await import('serpapi');
  const results = [];
  const data = await getJson({
    engine: 'google_maps',
    q: job.searchQuery,
    api_key: apiKey,
    ll: '@6.5244,3.3792,12z', // Default: Lagos
    type: 'search',
  });

  const places = data.local_results || [];
  for (const place of places) {
    results.push({
      companyName: place.title || '',
      address: place.address || '',
      phone: place.phone || '',
      website: place.website || '',
      rating: place.rating,
      category: place.type || '',
      city: place.address?.split(',').pop()?.trim() || '',
      scrapeSource: place.place_id_search || '',
    });
    if (results.length >= job.maxResults) break;
  }
  return results;
}

// ── LinkedIn (via SerpAPI Google + LinkedIn domain filter) ───────────────────
async function scrapeLinkedIn(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error('SERP_API_KEY required for LinkedIn scraping');

  const { getJson } = await import('serpapi');
  const results = [];
  const query = `site:linkedin.com/company ${job.searchQuery}`;

  const data = await getJson({
    engine: 'google',
    q: query,
    api_key: apiKey,
    num: Math.min(10, job.maxResults),
    gl: 'ng',
  });

  const organic = data.organic_results || [];
  for (const r of organic) {
    const companyName = r.title?.replace(' | LinkedIn', '').replace(' - LinkedIn', '').trim();
    results.push({
      companyName: companyName || '',
      linkedinUrl: r.link || '',
      description: r.snippet || '',
      website: '',
      scrapeSource: r.link,
    });
  }
  return results;
}

// ── Facebook (via SerpAPI Google + Facebook domain filter) ───────────────────
async function scrapeFacebook(job) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error('SERP_API_KEY required for Facebook scraping');

  const { getJson } = await import('serpapi');
  const results = [];
  const query = `site:facebook.com ${job.searchQuery}`;

  const data = await getJson({
    engine: 'google',
    q: query,
    api_key: apiKey,
    num: Math.min(10, job.maxResults),
    gl: 'ng',
  });

  const organic = data.organic_results || [];
  for (const r of organic) {
    const name = r.title?.replace(' | Facebook', '').replace(' - Facebook', '').replace(' - Home', '').trim();
    results.push({
      companyName: name || '',
      facebookUrl: r.link || '',
      description: r.snippet || '',
      scrapeSource: r.link,
    });
  }
  return results;
}

// ── VConnect NG ──────────────────────────────────────────────────────────────
async function scrapeVConnect(job) {
  const results = [];
  const query = encodeURIComponent(job.searchQuery);
  try {
    const { load } = await import('cheerio');
    for (let page = 1; page <= job.maxPages; page++) {
      const url = `https://www.vconnect.com/search?q=${query}&page=${page}`;
      const html = await fetchHtml(url);
      const $ = load(html);

      $('.business-listing, .biz-listing, [class*="listing"]').each((_, el) => {
        const name = $(el).find('[class*="name"], h2, h3').first().text().trim();
        const phone = $(el).find('[class*="phone"], [href^="tel:"]').first().text().trim();
        const addr = $(el).find('[class*="address"], [class*="location"]').first().text().trim();
        const website = $(el).find('a[href*="http"]').attr('href') || '';
        if (name) results.push({ companyName: name, phone, address: addr, website, scrapeSource: url });
      });

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
    const { load } = await import('cheerio');
    const query = job.searchQuery.replace(/\s+/g, '-').toLowerCase();
    for (let page = 1; page <= job.maxPages; page++) {
      const url = `https://www.yellowpages.com.ng/search?q=${encodeURIComponent(job.searchQuery)}&page=${page}`;
      const html = await fetchHtml(url);
      const $ = load(html);

      $('.listing, .business-card, [class*="business"]').each((_, el) => {
        const name = $(el).find('h2, h3, [class*="title"]').first().text().trim();
        const phone = $(el).find('[class*="phone"], [href^="tel:"]').first().text().trim();
        const email = $(el).find('[href^="mailto:"]').first().text().trim() || '';
        const addr = $(el).find('[class*="address"]').first().text().trim();
        if (name) results.push({ companyName: name, phone, email, address: addr, scrapeSource: url });
      });

      if (results.length >= job.maxResults) break;
    }
  } catch (err) {
    throw new Error(`Yellow Pages NG scrape failed: ${err.message}`);
  }
  return results.slice(0, job.maxResults);
}

// ── Custom URL scraper ────────────────────────────────────────────────────────
async function scrapeCustomUrl(job) {
  const results = [];
  try {
    const { load } = await import('cheerio');
    const url = job.targetUrl;
    const html = await fetchHtml(url);
    const $ = load(html);
    const { emails, phones } = extractFromHtml(html);

    // Best-effort: find any structured listing cards
    const listingSelectors = [
      '[class*="listing"]', '[class*="card"]', '[class*="result"]',
      '[class*="business"]', 'article', '.item', '.entry',
    ];

    let found = false;
    for (const selector of listingSelectors) {
      const els = $(selector);
      if (els.length > 2) {
        els.each((_, el) => {
          const name = $(el).find('h1,h2,h3,h4,[class*="title"],[class*="name"]').first().text().trim();
          const phone = $(el).find('[class*="phone"],[href^="tel:"]').first().text().trim();
          const emailEl = $(el).find('[href^="mailto:"]').first().text().trim();
          const addr = $(el).find('[class*="address"],[class*="location"]').first().text().trim();
          const link = $(el).find('a[href]').first().attr('href') || '';
          if (name) {
            results.push({ companyName: name, phone, email: emailEl, address: addr, website: link.startsWith('http') ? link : '', scrapeSource: url });
          }
        });
        found = true;
        break;
      }
    }

    // Fallback: page-level email/phone extraction
    if (!found) {
      const title = $('title').text().trim();
      results.push({
        companyName: title,
        emails,
        phones,
        website: url,
        scrapeSource: url,
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
    case 'Google Search': return scrapeGoogleSearch(job);
    case 'Google Maps': return scrapeGoogleMaps(job);
    case 'LinkedIn': return scrapeLinkedIn(job);
    case 'Facebook': return scrapeFacebook(job);
    case 'VConnect NG': return scrapeVConnect(job);
    case 'Yellow Pages NG': return scrapeYellowPagesNG(job);
    case 'Custom URL': return scrapeCustomUrl(job);
    default: return scrapeGoogleSearch(job);
  }
}
