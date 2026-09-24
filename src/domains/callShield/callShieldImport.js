/**
 * callShieldImport.js — pure domain helpers for Android call-log imports.
 *
 * Imports land in the android_call_imports staging table first (never
 * directly as timeline events). These functions normalize raw CallLog
 * records, build the stable dedupe hash the staging table enforces, and
 * flag possible duplicates against already-logged calls. They never merge
 * or attach anything: the user confirms every case association.
 *
 * Dependency-free and sync so the same code runs in the web app, the
 * Capacitor shell, and node tests.
 */

const DEDUPE_TIME_WINDOW_SEC = 30;
const DEDUPE_DURATION_TOLERANCE_SEC = 5;

/** Strip a raw phone string to digits only. Empty/unknown -> "". */
export function normalizePhoneNumber(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\D/g, "");
}

/**
 * Stable dedupe identity for one imported call record.
 * sha256(normalizedPhone + "|" + startedAtISO + "|" + durationSeconds + "|" + callType)
 * Android exposes no universal cloud-safe call id, so this composite is the
 * idempotency key (unique per owner in the staging table).
 */
export function buildImportDedupeHash({ normalizedPhone, startedAtISO, durationSeconds, callType }) {
  if (!normalizedPhone || typeof normalizedPhone !== "string") {
    throw new Error("buildImportDedupeHash requires a normalized phone number");
  }
  if (!startedAtISO || Number.isNaN(Date.parse(startedAtISO))) {
    throw new Error("buildImportDedupeHash requires a valid startedAtISO timestamp");
  }
  const duration = Number(durationSeconds);
  if (!Number.isInteger(duration) || duration < 0) {
    throw new Error("buildImportDedupeHash requires a non-negative integer durationSeconds");
  }
  if (!callType || typeof callType !== "string") {
    throw new Error("buildImportDedupeHash requires a callType");
  }
  const canonical = `${normalizedPhone}|${new Date(startedAtISO).toISOString()}|${duration}|${callType}`;
  return sha256Hex(canonical);
}

/**
 * Find already-logged calls that might duplicate a staged import.
 * Match rule: same normalized phone, started within ±30s, duration within
 * ±5s. Returns the matching calls; the UI offers them as "possible
 * duplicate" — this function never merges or deletes.
 *
 * existingCalls: [{ phoneNumber, startedAt (ISO), durationSeconds }]
 */
export function findPossibleDuplicateCalls(stagedImport, existingCalls, options = {}) {
  const timeWindowSec = options.timeWindowSec ?? DEDUPE_TIME_WINDOW_SEC;
  const durationToleranceSec = options.durationToleranceSec ?? DEDUPE_DURATION_TOLERANCE_SEC;
  if (!stagedImport || !Array.isArray(existingCalls)) return [];

  const importPhone = normalizePhoneNumber(stagedImport.phoneNumber ?? stagedImport.normalizedPhone);
  const importTime = Date.parse(stagedImport.startedAt ?? stagedImport.started_at);
  const importDuration = Number(stagedImport.durationSeconds ?? stagedImport.duration_seconds);
  if (!importPhone || Number.isNaN(importTime) || Number.isNaN(importDuration)) return [];

  return existingCalls.filter((call) => {
    if (normalizePhoneNumber(call.phoneNumber ?? call.phone_number ?? call.numberShown) !== importPhone) return false;
    const callTime = Date.parse(call.startedAt ?? call.started_at ?? call.occurredAt);
    if (Number.isNaN(callTime)) return false;
    if (Math.abs(callTime - importTime) / 1000 > timeWindowSec) return false;
    // Manually logged calls carry no duration: match those on phone + time
    // alone. When both sides have a duration, it must agree within tolerance.
    const callDuration = Number(call.durationSeconds ?? call.duration_seconds);
    if (Number.isNaN(importDuration) || Number.isNaN(callDuration)) return true;
    return Math.abs(callDuration - importDuration) <= durationToleranceSec;
  });
}

// --- Minimal SHA-256 (FIPS 180-4), sync and dependency-free. ---

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(ascii) {
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) {
    const code = ascii.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit length, big-endian (high 32 bits assumed 0 for realistic inputs)
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[chunk + i * 4] << 24) | (bytes[chunk + i * 4 + 1] << 16) |
             (bytes[chunk + i * 4 + 2] << 8) | bytes[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}
