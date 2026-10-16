/**
 * schemas.js — closed-schema validation for synthetic export envelopes.
 * Original code. Pure Node 24 ESM. Uses ownRead everywhere so validation
 * itself never invokes accessors.
 *
 * Timestamps use an exact grammar with real calendar round-trip: impossible
 * dates (2026-02-30), date-only strings and missing timezones are refused
 * at admission rather than silently normalized by Date.parse.
 */

import { ownRead, ownKeys, SchemaError } from "./budget.js";
import { HEX64 } from "./canonical.js";

export { SchemaError };

export const ENVELOPE_KIND = "forge/defensive-audit-export";
export const ENVELOPE_VERSION = 1;

export const LANES = ["bridge", "cloudflare", "fleet-ssh"];

export const LANE_SCHEMAS = {
  bridge: "forge/audit-bridge-config/v1",
  cloudflare: "forge/audit-cloudflare-config/v1",
  "fleet-ssh": "forge/audit-fleet-ssh-config/v1",
};

/** Top-level envelope keys; anything else is rejected (closed schema). */
const ENVELOPE_KEYS = new Set([
  "envelope",
  "version",
  "lane",
  "machine_id",
  "collected_at",
  "schema",
  "coverage",
  "source_digest",
  "config",
]);

/**
 * Closed per-lane config shapes. Every admitted config field is explicitly
 * accounted for: unknown keys are refused, never silently ignored. "array"
 * marks a section validated element-wise by its check.
 */
const CONFIG_SHAPES = {
  bridge: {
    signer: new Set(["fingerprint", "allowlist_digest"]),
    commands: "array",
    stop: new Set(["present", "evidence_ref", "machine_id"]),
    audit: new Set(["coverage"]),
  },
  cloudflare: {
    access: new Set(["policy", "rules"]),
    origin: new Set(["host_validation", "expected_host", "machine_id"]),
    bypass: new Set(["enabled"]),
  },
  "fleet-ssh": {
    auth: new Set(["password_auth", "pubkey_auth"]),
    authorized_keys: "array",
    firewall: new Set(["remote_address"]),
    service: new Set(["host_keys_present", "binary"]),
  },
};

/** authorized_keys entries are objects with exactly this key. */
const AUTHORIZED_KEY_KEYS = new Set(["fingerprint"]);

/**
 * Exact timestamp grammar: YYYY-MM-DDTHH:mm:ss[.fractional](Z|±HH:mm).
 * Timezone is mandatory; date-only and non-ISO strings are rejected.
 * Returns the finite millisecond instant. Throws SchemaError when the
 * string is not a real calendar instant (round-trip verified, so
 * 2026-02-30 and out-of-range fields fail instead of normalizing).
 */
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export function parseTimestampStrict(s) {
  if (typeof s !== "string") {
    throw new SchemaError("collected_at", "collected_at must be a string");
  }
  const m = TS_RE.exec(s);
  if (!m) {
    throw new SchemaError(
      "collected_at",
      "collected_at must match YYYY-MM-DDTHH:mm:ss[.frac](Z|±HH:mm) with an explicit timezone"
    );
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6]);
  const tz = m[8];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) {
    throw new SchemaError("collected_at", "collected_at calendar fields out of range");
  }
  const fracMs = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  let ms = Date.UTC(y, mo - 1, d, hh, mi, ss, fracMs);
  let offsetMs = 0;
  if (tz !== "Z") {
    const sign = tz[0] === "+" ? 1 : -1;
    const th = Number(tz.slice(1, 3));
    const tm = Number(tz.slice(4, 6));
    if (th > 23 || tm > 59) {
      throw new SchemaError("collected_at", "collected_at timezone offset out of range");
    }
    offsetMs = sign * (th * 3600 + tm * 60) * 1000;
    ms -= offsetMs;
  }
  if (!Number.isFinite(ms)) {
    throw new SchemaError("collected_at", "collected_at is not a finite instant");
  }
  // Real calendar round-trip: re-derive the wall-clock fields from the
  // instant in the declared zone and require an exact match. Nonexistent
  // dates such as 2026-02-30 normalize and therefore fail here.
  const back = new Date(ms + offsetMs);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() + 1 !== mo ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== hh ||
    back.getUTCMinutes() !== mi ||
    back.getUTCSeconds() !== ss
  ) {
    throw new SchemaError("collected_at", "collected_at is not a real calendar instant");
  }
  return ms;
}

function checkClosedKeys(obj, allowed, where) {
  for (const k of ownKeys(obj)) {
    if (!allowed.has(k)) {
      throw new SchemaError("unknown_config_key", `unexpected ${where} key ${JSON.stringify(k)}`);
    }
  }
}

/**
 * Validate the export envelope shape. Returns a normalized envelope view
 * with own-data snapshots (plain values re-read through descriptors).
 * Throws SchemaError on any shape violation.
 */
export function validateEnvelope(input) {
  const env = ownRead({ root: input }, "root").value;
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new SchemaError("not_object", "envelope must be a JSON object");
  }
  checkClosedKeys(env, ENVELOPE_KEYS, "envelope");
  const get = (k) => ownRead(env, k);

  const envelope = get("envelope");
  if (!envelope.present || envelope.value !== ENVELOPE_KIND) {
    throw new SchemaError("envelope_kind", `expected ${ENVELOPE_KIND}`);
  }
  const version = get("version");
  if (!version.present || version.value !== ENVELOPE_VERSION) {
    throw new SchemaError("version", `expected version ${ENVELOPE_VERSION}`);
  }
  const lane = get("lane");
  if (!lane.present || !LANES.includes(lane.value)) {
    throw new SchemaError("lane", `lane must be one of ${LANES.join(",")}`);
  }
  const machineId = get("machine_id");
  if (!machineId.present || typeof machineId.value !== "string" || machineId.value.length === 0) {
    throw new SchemaError("machine_id", "machine_id must be a non-empty string");
  }
  const collectedAt = get("collected_at");
  if (!collectedAt.present) {
    throw new SchemaError("collected_at", "collected_at is required");
  }
  const collectedAtMs = parseTimestampStrict(collectedAt.value);
  const schema = get("schema");
  if (!schema.present || schema.value !== LANE_SCHEMAS[lane.value]) {
    throw new SchemaError("schema", `expected ${LANE_SCHEMAS[lane.value]}`);
  }
  const coverage = get("coverage");
  if (!coverage.present || !Array.isArray(coverage.value)) {
    throw new SchemaError("coverage", "coverage must be an array of strings");
  }
  for (const c of coverage.value) {
    if (typeof c !== "string") throw new SchemaError("coverage", "coverage entries must be strings");
  }
  const digest = get("source_digest");
  if (!digest.present || typeof digest.value !== "string" || !HEX64.test(digest.value)) {
    throw new SchemaError("source_digest", "source_digest must be 64 lowercase hex");
  }
  const config = get("config");
  if (!config.present || config.value === null || typeof config.value !== "object" || Array.isArray(config.value)) {
    throw new SchemaError("config", "config must be a JSON object");
  }

  // Closed lane config shape: every admitted field is explicitly accounted.
  const shape = CONFIG_SHAPES[lane.value];
  checkClosedKeys(config.value, new Set(Object.keys(shape)), `config.${lane.value}`);
  for (const [section, sub] of Object.entries(shape)) {
    const sec = ownRead(config.value, section);
    if (!sec.present || sec.value === null || typeof sec.value !== "object") continue;
    if (sub === "array") {
      if (section === "authorized_keys" && Array.isArray(sec.value)) {
        for (const entry of sec.value) {
          if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
            checkClosedKeys(entry, AUTHORIZED_KEY_KEYS, "config.authorized_keys[]");
          }
        }
      }
      continue;
    }
    if (!Array.isArray(sec.value)) {
      checkClosedKeys(sec.value, sub, `config.${section}`);
    }
  }

  return {
    lane: lane.value,
    machineId: machineId.value,
    collectedAt: collectedAt.value,
    collectedAtMs,
    schema: schema.value,
    coverage: [...coverage.value],
    sourceDigest: digest.value,
    config: config.value,
  };
}
