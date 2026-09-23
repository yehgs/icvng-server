// utils/encryption.js
//
// AES-256-GCM encryption for secrets that must not sit in Mongo as plain
// text — introduced for models/paymentGateway.model.js's CinetPay
// apiKey/siteId, which are live merchant credentials (a step up in
// sensitivity from anything else currently stored, including
// models/password-vault.model.js, which stores its fields in plain text
// today — that's a separate, pre-existing gap this file does not touch,
// but new secret-shaped fields should not repeat it).
//
// Requires PAYMENT_SECRETS_KEY in the environment: a 32-byte key, given as
// either a 64-char hex string or a base64 string. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Losing/rotating this key means every row encrypted with it becomes
// undecryptable — treat it like any other production credential (a
// secrets manager, not a `.env` committed to git).

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM
const AUTH_TAG_LENGTH = 16;

let _key = null;

function getKey() {
  if (_key) return _key;

  const raw = process.env.PAYMENT_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "PAYMENT_SECRETS_KEY is not set — required to store/read encrypted payment gateway credentials",
    );
  }

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      "PAYMENT_SECRETS_KEY must decode to exactly 32 bytes (64 hex chars, or base64 of 32 bytes)",
    );
  }

  _key = key;
  return _key;
}

/**
 * Encrypt a plaintext string. Returns a single self-contained string:
 *   "<iv-hex>:<authTag-hex>:<ciphertext-hex>"
 * Safe to store directly in a Mongo field.
 *
 * @param {string} plaintext
 * @returns {string}
 */
export function encryptSecret(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === "") {
    return "";
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/**
 * Decrypt a string produced by encryptSecret(). Returns "" for an empty/
 * unset value instead of throwing, so reading a country with no gateway
 * configured yet doesn't need a try/catch at every call site.
 *
 * @param {string} payload
 * @returns {string}
 */
export function decryptSecret(payload) {
  if (!payload) return "";
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted payload — expected iv:authTag:ciphertext");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, "hex"),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

/** True once PAYMENT_SECRETS_KEY is present and well-formed — lets a health
 * check or startup log flag a misconfigured deploy before the first save
 * fails instead of after. */
export function isEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
