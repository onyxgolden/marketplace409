/**
 * schemas.js — closed-schema validation for synthetic export envelopes.
 * Original code. Pure Node 24 ESM. Uses ownRead everywhere so validation
 * itself never invokes accessors.
 */

import { ownRead, ownKeys } from "./budget.js";
import { HEX64 } from "./canonical.js";

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

export class SchemaError extends Error {
  constructor(code, detail) {
    super(`SCHEMA:${code}:${detail}`);
    this.name = "SchemaError";
    this.code = code;
  }
}

function isIso8601(s) {
  if (typeof s !== "string") return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
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
  for (const k of ownKeys(env)) {
    if (!ENVELOPE_KEYS.has(k)) {
      throw new SchemaError("unknown_key", `unexpected envelope key ${JSON.stringify(k)}`);
    }
  }
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
  if (!collectedAt.present || !isIso8601(collectedAt.value)) {
    throw new SchemaError("collected_at", "collected_at must be ISO-8601");
  }
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

  return {
    lane: lane.value,
    machineId: machineId.value,
    collectedAt: collectedAt.value,
    collectedAtMs: Date.parse(collectedAt.value),
    coverage: [...coverage.value],
    sourceDigest: digest.value,
    config: config.value,
  };
}
