/**
 * services/ai/openaiTranslationClient.js
 *
 * Thin, focused layer around the OpenAI Responses API dedicated to
 * translation. This is the ONLY file that talks to OpenAI directly —
 * everything else (utils/translationService.js and every controller that
 * calls it) goes through the functions exported here.
 *
 * Responsibilities kept separate on purpose (per project convention):
 *   - prompt construction         → buildTranslationInput()
 *   - structured output contract  → TRANSLATION_BATCH_SCHEMA
 *   - the actual API call + retry → callResponsesAPI()
 *   - public, business-friendly   → translateBatchAI() / translateOneAI()
 *
 * Env vars:
 *   OPENAI_API_KEY            required. Never hardcode, never send to the
 *                              frontend — this module only runs server-side.
 *   OPENAI_TRANSLATION_MODEL  optional. Defaults to "gpt-5-mini" (fast/cheap,
 *                              plenty for short-to-medium marketing/product
 *                              copy). Set to "gpt-5" for higher-fidelity
 *                              long-form content if quality issues show up.
 */

import OpenAI from "openai";

// ── Client ───────────────────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. AI translation requires an OpenAI API key " +
        "(server-side env var only — never expose it to the frontend).",
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

// Read lazily (not as a frozen top-level const) so this always reflects the
// actual environment at call time, regardless of module import order — see
// the comment at the top of index.js about dotenv/config needing to be the
// first import. A frozen top-level const evaluated before dotenv.config()
// ran would silently ignore OPENAI_TRANSLATION_MODEL forever.
function getModel() {
  return process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini";
}

// A single request that's too large (huge blog post body, e.g.) risks
// truncation / excessive latency. Anything longer than this is translated
// in its own solo call instead of being batched with the rest.
const LARGE_TEXT_CHARS = 6000;

// Batches larger than this are chunked — keeps prompts small, keeps a
// single slow/failing item from blocking everything else in the entity.
const MAX_BATCH_SIZE = 25;

// ── Language names (for a clearer, less error-prone prompt than raw codes) ──

const LANGUAGE_NAMES = {
  en: "English",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  sw: "Swahili",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
  nl: "Dutch",
  tw: "Twi",
};

function languageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

// ── Prompting ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional translator working on an e-commerce and content platform (a coffee retailer's product catalog, blog, and marketing copy).

Translate the given text(s) from the source language to the target language.

Requirements:
- Preserve meaning, tone, and register (marketing copy stays persuasive; technical text stays precise).
- Preserve punctuation, emojis, and line breaks exactly where they make sense in the target language.
- Preserve ALL HTML tags and attributes exactly as-is (class, id, style, href, src) — translate only the visible text content inside tags.
- Preserve markdown formatting (headings, bold, italics, links, lists).
- Preserve placeholders exactly as written and in the same position where possible: {{name}}, {{email}}, {{price}}, {username}, %s, etc.
- Preserve brand names, product names, proper nouns, numbers, dates, currency codes, and SKUs — do not translate or alter them.
- Do not add explanations, notes, or commentary.
- Do not wrap the output in quotes.
- If a string is empty or whitespace-only, return it unchanged.
- Return exactly one translation per input string, in the same order, with none omitted.`;

/**
 * JSON schema for the structured output — a same-length, order-preserved
 * array of translated strings. Using json_schema strict mode means we don't
 * have to hope the model returns clean JSON; the API guarantees the shape.
 */
const TRANSLATION_BATCH_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

function buildTranslationInput(texts, sourceLang, targetLang) {
  const sourceName = languageName(sourceLang);
  const targetName = languageName(targetLang);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Source language: ${sourceName} (${sourceLang})\n` +
        `Target language: ${targetName} (${targetLang})\n\n` +
        `Translate each of the following ${texts.length} string(s). ` +
        `Return them in the "translations" array, in the exact same order, one output string per input string:\n\n` +
        JSON.stringify(texts, null, 2),
    },
  ];
}

// ── Retry / backoff ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(err) {
  const status = err?.status || err?.response?.status;
  // 429 rate limit, 500/502/503/504 transient server issues, or a raw
  // network/timeout error from the SDK (no status at all).
  return status === 429 || (status >= 500 && status < 600) || !status;
}

/**
 * Low-level call to the OpenAI Responses API with structured JSON output,
 * retrying transient failures with exponential backoff.
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {number} maxRetries
 * @returns {Promise<string[]>}
 */
async function callResponsesAPI(texts, sourceLang, targetLang, maxRetries = 3) {
  const client = getClient();
  const input = buildTranslationInput(texts, sourceLang, targetLang);

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.responses.create({
        model: getModel(),
        input,
        text: {
          format: {
            type: "json_schema",
            name: "translation_batch",
            schema: TRANSLATION_BATCH_SCHEMA,
            strict: true,
          },
        },
      });

      const raw = response.output_text;
      if (!raw) throw new Error("Empty response from OpenAI");

      const parsed = JSON.parse(raw);
      const translations = parsed.translations;

      if (!Array.isArray(translations) || translations.length !== texts.length) {
        throw new Error(
          `OpenAI returned ${translations?.length ?? 0} translations for ${texts.length} inputs`,
        );
      }

      return translations;
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === maxRetries;

      if (!isLastAttempt && isRetryableError(err)) {
        await sleep(1000 * 2 ** attempt); // 1s, 2s, 4s
        continue;
      }
      break;
    }
  }

  throw lastErr;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// Small, process-lifetime cache to avoid re-paying for an identical
// (text, sourceLang, targetLang) translation within the same deploy —
// e.g. re-saving a product without changing its description. Not a
// substitute for the persisted Translation collection, just a guard
// against redundant API calls in a single request burst.

const CACHE_MAX_ENTRIES = 2000;
const cache = new Map();

function cacheKey(text, sourceLang, targetLang) {
  return `${sourceLang}→${targetLang}::${text}`;
}

function cacheGet(text, sourceLang, targetLang) {
  return cache.get(cacheKey(text, sourceLang, targetLang));
}

function cacheSet(text, sourceLang, targetLang, translated) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(cacheKey(text, sourceLang, targetLang), translated);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Translate a batch of strings, preserving order, using OpenAI.
 * Falls back to returning the original text for any string that ultimately
 * fails after retries — never throws for individual bad items, so a single
 * entity-level translation run doesn't die because of one problem field.
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string[]>}
 */
export async function translateBatchAI(texts, sourceLang = "en", targetLang = "fr") {
  if (!texts || texts.length === 0) return texts || [];
  if (sourceLang === targetLang) return texts;

  const results = new Array(texts.length);
  const toTranslate = []; // { index, text }

  texts.forEach((text, index) => {
    if (!text || typeof text !== "string" || !text.trim()) {
      results[index] = text;
      return;
    }
    const cached = cacheGet(text, sourceLang, targetLang);
    if (cached !== undefined) {
      results[index] = cached;
      return;
    }
    toTranslate.push({ index, text });
  });

  if (toTranslate.length === 0) return results;

  // Split off anything long enough to risk crowding/truncating a batch —
  // translate those solo.
  const large = toTranslate.filter((t) => t.text.length > LARGE_TEXT_CHARS);
  const normal = toTranslate.filter((t) => t.text.length <= LARGE_TEXT_CHARS);

  // Chunk the "normal" set into manageable batch sizes.
  const chunks = [];
  for (let i = 0; i < normal.length; i += MAX_BATCH_SIZE) {
    chunks.push(normal.slice(i, i + MAX_BATCH_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const translated = await callResponsesAPI(
        chunk.map((c) => c.text),
        sourceLang,
        targetLang,
      );
      chunk.forEach((c, i) => {
        results[c.index] = translated[i];
        cacheSet(c.text, sourceLang, targetLang, translated[i]);
      });
    } catch (err) {
      console.error(
        `[openaiTranslationClient] Batch of ${chunk.length} → ${targetLang} failed after retries:`,
        err.message,
      );
      // Fall back to the source text for this chunk rather than failing
      // the whole entity translation.
      chunk.forEach((c) => {
        results[c.index] = c.text;
      });
    }
  }

  // Large items, one call each (each is its own try/catch internally).
  for (const item of large) {
    try {
      const [translated] = await callResponsesAPI([item.text], sourceLang, targetLang);
      results[item.index] = translated;
      cacheSet(item.text, sourceLang, targetLang, translated);
    } catch (err) {
      console.error(
        `[openaiTranslationClient] Large text → ${targetLang} failed after retries:`,
        err.message,
      );
      results[item.index] = item.text;
    }
  }

  return results;
}

/**
 * Translate a single string. Convenience wrapper around translateBatchAI.
 *
 * @param {string} text
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
export async function translateOneAI(text, sourceLang = "en", targetLang = "fr") {
  const [result] = await translateBatchAI([text], sourceLang, targetLang);
  return result;
}

/**
 * Detect the language of a piece of text using the same model, returned as
 * an ISO 639-1 code. Used where source language isn't already known (e.g.
 * a foreign-admin authoring content directly in French).
 *
 * @param {string} text
 * @returns {Promise<string>} ISO 639-1 code, e.g. "fr". Falls back to "en".
 */
export async function detectLanguageAI(text) {
  if (!text || !text.trim()) return "en";
  try {
    const client = getClient();
    const response = await client.responses.create({
      model: getModel(),
      input: [
        {
          role: "system",
          content:
            "Detect the language of the given text. Respond with only the ISO 639-1 two-letter language code, nothing else.",
        },
        { role: "user", content: text.slice(0, 500) },
      ],
    });
    const code = (response.output_text || "").trim().toLowerCase().slice(0, 2);
    return /^[a-z]{2}$/.test(code) ? code : "en";
  } catch (err) {
    console.error("[openaiTranslationClient] Language detection failed:", err.message);
    return "en";
  }
}
