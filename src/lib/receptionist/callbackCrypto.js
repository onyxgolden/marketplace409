import crypto from "node:crypto";

// Authenticated encryption for the receptionist callback number
// (P1-6: the column named `callback_e164_encrypted` must actually hold
// ciphertext, not plaintext).
//
// AES-256-GCM, one 32-byte key per key id. Keys come from server env only:
//   RECEPTIONIST_CALLBACK_ENCRYPTION_KEYS — JSON: {"1": "<base64 32-byte key>", ...}
//   RECEPTIONIST_CALLBACK_ENCRYPTION_CURRENT_KEY_ID — key id for new encryptions (default "1")
// Stored format: `v1.<keyId>.<base64(iv[12] || tag[16] || ciphertext)>`.
// Decryption resolves the key id from the stored value, so rotating the
// current key never orphans rows encrypted under an older key. GCM
// authentication fails closed on any tampering. Plaintext is never logged
// by this module. Fail closed: no key configured means encryption throws
// instead of silently storing plaintext.

const FORMAT_VERSION = "v1";

function parseKeys(env = process.env) {
  let parsed = {};
  try {
    parsed = JSON.parse(env.RECEPTIONIST_CALLBACK_ENCRYPTION_KEYS || "{}");
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const keys = {};
  for (const [id, b64] of Object.entries(parsed)) {
    if (typeof b64 !== "string") continue;
    try {
      const key = Buffer.from(b64, "base64");
      if (key.length === 32) keys[id] = key;
    } catch {
      // Ignore malformed entries; a missing usable key fails closed below.
    }
  }
  return keys;
}

function currentKeyId(env = process.env) {
  const id = env.RECEPTIONIST_CALLBACK_ENCRYPTION_CURRENT_KEY_ID || "1";
  return typeof id === "string" && id !== "" ? id : "1";
}

export function encryptCallbackE164(plaintext, env = process.env) {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new Error("A callback number is required to encrypt it.");
  }
  const keys = parseKeys(env);
  const keyId = currentKeyId(env);
  const key = keys[keyId];
  if (!key) {
    throw new Error("No callback encryption key is configured for the current key id.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `${FORMAT_VERSION}.${keyId}.${packed}`;
}

export function decryptCallbackE164(value, env = process.env) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Stored callback value has an unexpected shape.");
  }
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Stored callback value is not a v1 encrypted value.");
  }
  const [, keyId, packed] = parts;
  const keys = parseKeys(env);
  const key = keys[keyId];
  if (!key) {
    throw new Error("No callback encryption key is configured for the stored key id.");
  }
  const raw = Buffer.from(packed, "base64");
  if (raw.length < 12 + 16) {
    throw new Error("Stored callback value is too short to be valid ciphertext.");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Masked form for logs and for any UI that must not show the full number:
// "+1-***-***-5678". Mirrors the worker-side mask_e164 helper.
export function maskCallbackE164(e164) {
  if (typeof e164 !== "string" || e164 === "") return null;
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  const last4 = digits.slice(-4);
  const country = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)}-` : "";
  return `${country}***-***-${last4}`;
}
