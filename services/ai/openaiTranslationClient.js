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
  // Debug aid: confirms at the moment of first real use (not just at
  // server boot, when dotenv timing issues could still be misleading —
  // see index.js) that a key is actually present, without ever logging
  // the key itself. If translations are failing, this line (or its
  // absence) in the logs tells you immediately whether it's an env-var
  // problem or something else (auth/quota/network) further downstream.
  console.log(
    `[openaiTranslationClient] Initializing OpenAI client — API key present ` +
      `(${apiKey.slice(0, 3)}...${apiKey.slice(-4)}, ${apiKey.length} chars), ` +
      `model=${getModel()}.`,
  );
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
  // The two GLOBAL_EXTRA_LANGUAGES (config/countries/index.js) that were
  // missing here — without an entry, languageName() fell back to the raw
  // code ("hi"/"zh") in the AI prompt instead of the language name, which
  // still mostly worked but was a weaker, more error-prone prompt than
  // every other supported language got.
  hi: "Hindi",
  zh: "Chinese (Simplified)",
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

/**
 * Classifies an OpenAI SDK error into one of a small set of stable codes so
 * callers up the stack (translationService.js → controllers → admin UI) can
 * show a message that actually matches the real cause, instead of a generic
 * "Translation failed" for everything.
 *
 * "quota_exceeded" is the one this was specifically added for: the account
 * has run out of credit / hit its billing limit. OpenAI reports this as a
 * 429 with type/code "insufficient_quota" — which looks identical to an
 * ordinary rate limit (also a 429) unless you inspect the body, so a plain
 * `status === 429` check (what this file used to do) can't tell "you're
 * sending requests too fast, back off and retry" apart from "there is no
 * money left, retrying will never succeed" — one of these is worth
 * retrying, the other never is, and previously both just retried 3 times,
 * failed, and surfaced the raw OpenAI error text (which is written for a
 * developer reading API docs, not for an admin clicking a translate
 * button).
 *
 * @param {any} err
 * @returns {"quota_exceeded" | "auth" | "rate_limited" | "bad_model" | "server_error" | "network" | "unknown"}
 */
function classifyTranslationError(err) {
  const status = err?.status || err?.response?.status;
  const code = (err?.code || err?.error?.code || "").toString().toLowerCase();
  const type = (err?.type || err?.error?.type || "").toString().toLowerCase();
  const message = (err?.message || "").toLowerCase();

  const looksLikeQuota =
    code.includes("insufficient_quota") ||
    type.includes("insufficient_quota") ||
    message.includes("insufficient_quota") ||
    message.includes("exceeded your current quota") ||
    message.includes("billing") ||
    status === 402;

  if (looksLikeQuota) return "quota_exceeded";
  if (status === 401 || status === 403) return "auth";
  if (status === 404 || message.includes("model")) return "bad_model";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "server_error";
  if (!status) return "network";
  return "unknown";
}

// A short, human-readable message per error class — this is what ends up in
// front of an admin (via translateEntity's results[lang].error and the
// "Auto" button's toast), so it needs to say what happened and what to do
// about it, not just restate the HTTP status.
const FRIENDLY_ERROR_MESSAGES = {
  quota_exceeded:
    "The OpenAI account has run out of credit or hit its usage/billing limit. " +
    "Auto-translation can't run until billing is topped up — contact IT/Finance. " +
    "(Manual translation edits still work normally.)",
  auth: "The OpenAI API key is missing, invalid, or was revoked. Contact IT to check OPENAI_API_KEY.",
  bad_model: "The configured OpenAI model is unavailable or misspelled. Contact IT to check OPENAI_TRANSLATION_MODEL.",
  rate_limited: "OpenAI is rate-limiting requests right now. This usually clears on its own — try again in a minute.",
  server_error: "OpenAI's servers had a temporary issue. Try again shortly.",
  network: "Couldn't reach OpenAI (network/connectivity issue). Try again shortly.",
  unknown: null, // fall back to the raw error message — nothing more specific to say
};

/**
 * Public helper so translationService.js can attach the same classification
 * (and friendly text) to results it reports back to the admin UI, without
 * duplicating the detection logic.
 */
export function describeTranslationError(err) {
  const code = classifyTranslationError(err);
  return { code, friendlyMessage: FRIENDLY_ERROR_MESSAGES[code] || null };
}

function isRetryableError(err) {
  const code = classifyTranslationError(err);
  // Quota exhaustion, a bad/missing API key, and a bad model name will
  // never succeed no matter how many times we retry — burning 3 more
  // attempts (with backoff) just delays telling the admin what's actually
  // wrong. Only genuinely transient conditions are worth retrying.
  return code === "rate_limited" || code === "server_error" || code === "network";
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
  const model = getModel();

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptLabel = `attempt ${attempt + 1}/${maxRetries + 1}`;
    try {
      const response = await client.responses.create({
        model,
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
      if (!raw) {
        // Debug aid: an empty output_text usually means the model didn't
        // return a normal completion — e.g. it hit its own internal
        // reasoning/output token cap, or the API version doesn't populate
        // output_text (older/newer SDK mismatch). Log the raw response
        // shape (not the full payload — could be large) so this is
        // diagnosable without needing to reproduce it live.
        console.error(
          `[openaiTranslationClient] Empty output_text (${attemptLabel}, model=${model}, ` +
            `${sourceLang}→${targetLang}, ${texts.length} item(s), response.id=${response?.id}, ` +
            `status=${response?.status}, incomplete_reason=${response?.incomplete_details?.reason}).`,
        );
        throw new Error(
          `Empty response from OpenAI (status=${response?.status || "unknown"}, ` +
            `incomplete_reason=${response?.incomplete_details?.reason || "none"})`,
        );
      }

      const parsed = JSON.parse(raw);
      const translations = parsed.translations;

      if (!Array.isArray(translations) || translations.length !== texts.length) {
        console.error(
          `[openaiTranslationClient] Shape mismatch (${attemptLabel}, model=${model}, ` +
            `${sourceLang}→${targetLang}): expected ${texts.length} translations, got ` +
            `${translations?.length ?? "non-array"}. Raw output_text (truncated): ` +
            `${raw.slice(0, 500)}`,
        );
        throw new Error(
          `OpenAI returned ${translations?.length ?? 0} translations for ${texts.length} inputs`,
        );
      }

      return translations;
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === maxRetries;
      const status = err?.status || err?.response?.status;
      const errType = err?.type || err?.code || err?.name;

      // This is the key diagnostic line for "translation says complete but
      // nothing actually translated" — every failure (including the ones
      // that get silently retried) is logged with enough detail to tell
      // API-key/auth issues (401/403), quota/billing issues (429 with a
      // quota-type error, or 402), bad model name (404), and transient
      // server issues (5xx/network) apart at a glance, without needing to
      // reproduce the failure live.
      console.error(
        `[openaiTranslationClient] Call failed (${attemptLabel}, model=${model}, ` +
          `${sourceLang}→${targetLang}, ${texts.length} item(s)): ` +
          `status=${status ?? "n/a"} type=${errType ?? "n/a"} message="${err.message}"` +
          (isLastAttempt ? " — giving up (max retries reached)" : " — will retry"),
      );

      if (!isLastAttempt && isRetryableError(err)) {
        await sleep(1000 * 2 ** attempt); // 1s, 2s, 4s
        continue;
      }
      break;
    }
  }

  // Tag the error with a stable classification + friendly message before it
  // leaves this module, so every caller up the chain (translateBatchAIDetailed
  // → translationService.js → controllers → admin UI) can react to *why* it
  // failed instead of just knowing that it failed.
  const { code, friendlyMessage } = describeTranslationError(lastErr);
  lastErr.translationErrorCode = code;
  if (friendlyMessage) lastErr.friendlyMessage = friendlyMessage;
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
 * Translate a batch of strings, preserving order, using OpenAI. Returns
 * rich per-item status (not just the translated strings) so callers can
 * tell a real translation apart from a same-as-source fallback — the
 * simpler `translateBatchAI()` below collapses that distinction away,
 * which is exactly what let a failed OpenAI call look like a successful
 * "Translation complete" with nothing actually translated (issue: auto
 * translation reported success but did nothing). Prefer this function in
 * any caller that reports outcomes back to a human (translationService.js).
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<{results: string[], succeeded: boolean[], failedCount: number, lastError: string|null}>}
 */
export async function translateBatchAIDetailed(texts, sourceLang = "en", targetLang = "fr") {
  if (!texts || texts.length === 0) {
    return { results: texts || [], succeeded: [], failedCount: 0, lastError: null, lastErrorCode: null };
  }
  if (sourceLang === targetLang) {
    return { results: texts, succeeded: texts.map(() => true), failedCount: 0, lastError: null, lastErrorCode: null };
  }

  const results = new Array(texts.length);
  const succeeded = new Array(texts.length).fill(true); // empty/cached/skipped strings count as "succeeded" (nothing to fail)
  const toTranslate = []; // { index, text }
  let lastError = null;
  let lastErrorCode = null; // see describeTranslationError() above

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

  if (toTranslate.length === 0) {
    return { results, succeeded, failedCount: 0, lastError: null };
  }

  // Split off anything long enough to risk crowding/truncating a batch —
  // translate those solo.
  const large = toTranslate.filter((t) => t.text.length > LARGE_TEXT_CHARS);
  const normal = toTranslate.filter((t) => t.text.length <= LARGE_TEXT_CHARS);

  // Chunk the "normal" set into manageable batch sizes.
  const chunks = [];
  for (let i = 0; i < normal.length; i += MAX_BATCH_SIZE) {
    chunks.push(normal.slice(i, i + MAX_BATCH_SIZE));
  }

  let failedCount = 0;
  // Once we know it's quota exhaustion, every remaining chunk/large item in
  // THIS call will fail for the exact same reason — stop making doomed API
  // calls (each with its own 3-retry backoff) and just mark the rest failed
  // immediately. Matters most on a "translate whole entity" run with many
  // fields: without this, a single out-of-credit account turns one Auto
  // click into a dozen-plus guaranteed-failing round trips.
  let stopEarly = false;

  for (const chunk of chunks) {
    if (stopEarly) {
      chunk.forEach((c) => {
        results[c.index] = c.text;
        succeeded[c.index] = false;
        failedCount++;
      });
      continue;
    }
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
      lastError = err.friendlyMessage || err.message;
      lastErrorCode = err.translationErrorCode || null;
      console.error(
        `[openaiTranslationClient] Batch of ${chunk.length} → ${targetLang} failed after retries — ` +
          `these field(s) will be left untranslated (not silently substituted with English) so the ` +
          `caller can report a real failure instead of a false "success" (errorCode=${lastErrorCode}):`,
        err.message,
      );
      // Fall back to the source text for this chunk (so the caller always
      // gets a same-length array back and can decide what to do), but mark
      // it as NOT succeeded so translationService.js knows not to persist
      // this as if it were a real translation.
      chunk.forEach((c) => {
        results[c.index] = c.text;
        succeeded[c.index] = false;
        failedCount++;
      });
      if (lastErrorCode === "quota_exceeded" || lastErrorCode === "auth" || lastErrorCode === "bad_model") {
        stopEarly = true;
      }
    }
  }

  // Large items, one call each (each is its own try/catch internally).
  for (const item of large) {
    if (stopEarly) {
      results[item.index] = item.text;
      succeeded[item.index] = false;
      failedCount++;
      continue;
    }
    try {
      const [translated] = await callResponsesAPI([item.text], sourceLang, targetLang);
      results[item.index] = translated;
      cacheSet(item.text, sourceLang, targetLang, translated);
    } catch (err) {
      lastError = err.friendlyMessage || err.message;
      lastErrorCode = err.translationErrorCode || null;
      console.error(
        `[openaiTranslationClient] Large text (${item.text.length} chars) → ${targetLang} failed after retries (errorCode=${lastErrorCode}):`,
        err.message,
      );
      results[item.index] = item.text;
      succeeded[item.index] = false;
      failedCount++;
    }
  }

  return { results, succeeded, failedCount, lastError, lastErrorCode };
}

/**
 * Translate a batch of strings, preserving order, using OpenAI.
 * Falls back to returning the original text for any string that ultimately
 * fails after retries — never throws for individual bad items, so a single
 * entity-level translation run doesn't die because of one problem field.
 *
 * Thin wrapper around translateBatchAIDetailed() for callers that just want
 * the strings and don't need to distinguish a real translation from a
 * same-as-source fallback (e.g. translateOneAI below). Prefer
 * translateBatchAIDetailed() directly wherever the result of a translation
 * run gets reported back to a human.
 *
 * @param {string[]} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string[]>}
 */
export async function translateBatchAI(texts, sourceLang = "en", targetLang = "fr") {
  const { results } = await translateBatchAIDetailed(texts, sourceLang, targetLang);
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
