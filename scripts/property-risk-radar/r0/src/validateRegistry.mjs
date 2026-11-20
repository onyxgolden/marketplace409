// Registry validator for the Property Risk Radar R0 contract pack.
// Node 24 built-ins only. Enforces the fail-closed rules from the R0 scope:
//
// - defaultNetworkPolicy must be "deny".
// - Every source needs hosts/paths, quota state, terms, caps, kill switch.
// - An "accepted" source needs a schema digest, a fixture manifest, a
//   last-preflight record, and a receipt for every allowed rights mode.
// - A disabled/blocked source may not enable any display mode
//   (image/iframe/hotlink/proxy/cache/archive); metadata listing may be
//   allowed only as a LINK_ONLY reference.
// - A camera display mode enabled with unknown rights fails validation.
// - No source may use credentials in R0 (credentialMode must be "none").
//
// Usage: node src/validateRegistry.mjs [registryPath]
// Exit 0 = valid, 1 = invalid. Also exports validateRegistryObject() and
// computeSchemaDigest() for the preflight CLI and tests.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestObject } from "./schemaDigest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const R0_DIR = path.resolve(__dirname, "..");
export const DEFAULT_REGISTRY_PATH = path.join(
  R0_DIR,
  "registry",
  "source-registry.v1.json",
);

export const RIGHTS_MODES = [
  "metadataListing",
  "imageDisplay",
  "iframeEmbed",
  "hotlinking",
  "proxying",
  "caching",
  "archive",
];
export const DISPLAY_MODES = [
  "imageDisplay",
  "iframeEmbed",
  "hotlinking",
  "proxying",
  "archive",
];
const VALID_MODES = ["allowed", "forbidden", "unknown", "not_applicable"];

// The schema digest binds a source to its contract and its fixture
// manifest. For data adapters it covers the response contract plus the
// manifest digest; for cameras (no fixture manifest) it covers the
// contract plus the recorded rights disposition.
export function computeSchemaDigest(source, manifestDigest) {
  return digestObject({
    adapterId: source.id,
    adapterVersion: source.adapterVersion,
    category: source.category,
    format: source.response.format,
    crs: source.response.crs,
    requiredFields: source.response.requiredFields,
    geometryTypes: source.response.geometryTypes,
    hosts: source.network.hosts,
    pathPrefixes: source.network.pathPrefixes,
    manifestDigest: manifestDigest || null,
  });
}

function isHttpsUrl(value) {
  return typeof value === "string" && value.startsWith("https://");
}

function isDateString(value) {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function checkRights(source, errors) {
  const label = `sources[${source.id}].rights`;
  if (!source.rights || typeof source.rights !== "object") {
    errors.push(`${label}: missing required field`);
    return;
  }
  for (const mode of RIGHTS_MODES) {
    const entry = source.rights[mode];
    if (!entry || typeof entry !== "object") {
      errors.push(`${label}.${mode}: missing required field`);
      continue;
    }
    if (!VALID_MODES.includes(entry.mode)) {
      errors.push(`${label}.${mode}.mode: unknown mode ${JSON.stringify(entry.mode)}`);
      continue;
    }
    if (entry.mode === "allowed") {
      if (!entry.receipt || typeof entry.receipt !== "string") {
        errors.push(`${label}.${mode}: allowed without a receipt`);
      }
      if (!isDateString(entry.receiptDate)) {
        errors.push(`${label}.${mode}: allowed without a receipt date`);
      }
    }
  }
  // A disabled/blocked source enables nothing displayable. Metadata
  // listing may stay allowed only as a LINK_ONLY reference.
  if (source.status === "disabled" || source.status === "blocked") {
    for (const mode of DISPLAY_MODES) {
      const entry = source.rights[mode];
      if (entry && entry.mode === "allowed") {
        errors.push(
          `${label}.${mode}: ${source.status} source must not allow a display mode`,
        );
      }
    }
    if (
      source.category === "camera" &&
      (source.rights.imageDisplay?.mode === "unknown" ||
        source.rights.iframeEmbed?.mode === "unknown")
    ) {
      errors.push(
        `${label}: camera display mode with unknown rights on a ${source.status} source`,
      );
    }
  }
}

function checkSource(source, index, errors, seenIds, r0Dir) {
  const label = `sources[${index}]`;
  if (!source || typeof source !== "object") {
    errors.push(`${label}: expected an object`);
    return;
  }
  if (typeof source.id !== "string" || source.id.length === 0) {
    errors.push(`${label}.id: missing required field`);
    return;
  }
  const idLabel = `sources[${source.id}]`;
  if (seenIds.has(source.id)) {
    errors.push(`${idLabel}.id: duplicate source id`);
  }
  seenIds.add(source.id);

  for (const field of ["owner", "product", "statusReason"]) {
    if (typeof source[field] !== "string" || source[field].length === 0) {
      errors.push(`${idLabel}.${field}: missing required field`);
    }
  }
  if (!["hazard-data", "geocoder", "camera"].includes(source.category)) {
    errors.push(`${idLabel}.category: unknown category ${JSON.stringify(source.category)}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(source.adapterVersion || "")) {
    errors.push(`${idLabel}.adapterVersion: expected a semver string`);
  }
  if (source.killSwitch !== true) {
    errors.push(`${idLabel}.killSwitch: must be true (every source has an operator disable switch)`);
  }
  if (!["accepted", "disabled", "blocked"].includes(source.status)) {
    errors.push(`${idLabel}.status: unknown status ${JSON.stringify(source.status)}`);
  }

  const network = source.network || {};
  if (!Array.isArray(network.hosts) || network.hosts.length === 0) {
    errors.push(`${idLabel}.network.hosts: at least one exact HTTPS host is required`);
  } else {
    for (const host of network.hosts) {
      if (typeof host !== "string" || host.includes("://") || host.includes("*")) {
        errors.push(`${idLabel}.network.hosts: ${JSON.stringify(host)} is not a bare hostname`);
      }
    }
  }
  if (
    !Array.isArray(network.pathPrefixes) ||
    network.pathPrefixes.length === 0 ||
    network.pathPrefixes.some(
      (prefix) => typeof prefix !== "string" || !prefix.startsWith("/"),
    )
  ) {
    errors.push(`${idLabel}.network.pathPrefixes: at least one "/"-prefixed path is required`);
  }
  if (network.method !== "GET") {
    errors.push(`${idLabel}.network.method: only GET is permitted in R0`);
  }
  if (
    typeof network.maxRedirects !== "number" ||
    network.maxRedirects < 0 ||
    network.maxRedirects > 2
  ) {
    errors.push(`${idLabel}.network.maxRedirects: must be 0-2`);
  }
  if (network.credentialMode !== "none") {
    errors.push(`${idLabel}.network.credentialMode: must be "none" in R0`);
  }

  const endpoints = source.endpoints || {};
  if (!isHttpsUrl(endpoints.metadataUrlTemplate)) {
    errors.push(`${idLabel}.endpoints.metadataUrlTemplate: must be an HTTPS URL template`);
  }
  if (!isHttpsUrl(endpoints.sampleUrlTemplate)) {
    errors.push(`${idLabel}.endpoints.sampleUrlTemplate: must be an HTTPS URL template`);
  }

  const terms = source.terms || {};
  if (!isHttpsUrl(terms.landingUrl)) {
    errors.push(`${idLabel}.terms.landingUrl: must be an HTTPS URL`);
  }
  if (!isHttpsUrl(terms.termsUrl)) {
    errors.push(`${idLabel}.terms.termsUrl: must be an HTTPS URL`);
  }
  if (!isDateString(terms.termsDate)) {
    errors.push(`${idLabel}.terms.termsDate: expected YYYY-MM-DD`);
  }
  if (typeof terms.attribution !== "string" || terms.attribution.length === 0) {
    errors.push(`${idLabel}.terms.attribution: missing required field`);
  }
  if (
    !terms.coverage ||
    typeof terms.coverage.geographic !== "string" ||
    typeof terms.coverage.temporal !== "string"
  ) {
    errors.push(`${idLabel}.terms.coverage: geographic and temporal coverage are required`);
  }
  if (
    terms.quota === undefined ||
    terms.quota === null ||
    (typeof terms.quota === "string" && terms.quota.length === 0)
  ) {
    errors.push(`${idLabel}.terms.quota: published quota or literal UNKNOWN is required`);
  }

  const policy = source.policy || {};
  if (typeof policy.spacingMs !== "number" || policy.spacingMs < 0) {
    errors.push(`${idLabel}.policy.spacingMs: missing required field`);
  }
  if (policy.concurrency !== 1) {
    errors.push(`${idLabel}.policy.concurrency: exactly 1 concurrent request per host in R0`);
  }
  if (
    typeof policy.timeoutMs !== "number" ||
    policy.timeoutMs < 1 ||
    policy.timeoutMs > 10000
  ) {
    errors.push(`${idLabel}.policy.timeoutMs: must be 1-10000ms`);
  }
  const caps = policy.caps || {};
  for (const cap of ["redirects", "pages", "records", "bytes", "vertices"]) {
    if (typeof caps[cap] !== "number" || caps[cap] < 0) {
      errors.push(`${idLabel}.policy.caps.${cap}: missing required field`);
    }
  }
  if (typeof caps.redirects === "number" && caps.redirects > 2) {
    errors.push(`${idLabel}.policy.caps.redirects: must be 0-2`);
  }
  if (typeof caps.bytes === "number" && caps.bytes > 5242880) {
    errors.push(`${idLabel}.policy.caps.bytes: must not exceed the 5 MiB cap`);
  }

  if (
    source.observationTimeField !== null &&
    typeof source.observationTimeField !== "string"
  ) {
    errors.push(`${idLabel}.observationTimeField: must be a field name or null`);
  }
  if (
    typeof source.retrievalTimeField !== "string" ||
    source.retrievalTimeField.length === 0
  ) {
    errors.push(`${idLabel}.retrievalTimeField: missing required field`);
  }
  if (
    source.observationTimeField &&
    source.observationTimeField === source.retrievalTimeField
  ) {
    errors.push(
      `${idLabel}: observation-time field and retrieval-time field must be distinct`,
    );
  }

  if (
    source.schemaDigest !== null &&
    !/^[0-9a-f]{64}$/.test(source.schemaDigest || "")
  ) {
    errors.push(`${idLabel}.schemaDigest: expected a sha256 hex digest or null`);
  }
  if (source.category === "camera" && source.fixtureManifest !== null) {
    errors.push(`${idLabel}.fixtureManifest: cameras have no media fixture; must be null`);
  }
  if (
    source.category !== "camera" &&
    typeof source.fixtureManifest !== "string"
  ) {
    errors.push(`${idLabel}.fixtureManifest: a fixture manifest path is required`);
  }
  if (
    typeof source.fixtureManifest === "string" &&
    r0Dir &&
    !existsSync(path.join(r0Dir, source.fixtureManifest))
  ) {
    errors.push(`${idLabel}.fixtureManifest: file does not exist: ${source.fixtureManifest}`);
  }
  if (!["pending-live-preflight", "live", "not-applicable"].includes(source.liveFixtureStatus)) {
    errors.push(`${idLabel}.liveFixtureStatus: unknown value`);
  }
  if (!["synthetic-contract", "contract-only"].includes(source.fixtureKind)) {
    errors.push(`${idLabel}.fixtureKind: unknown value`);
  }

  checkRights(source, errors);

  // Accepted sources carry the full evidence burden. Nothing in the R0
  // offline build is accepted: no live preflight has run.
  if (source.status === "accepted") {
    if (!source.schemaDigest) {
      errors.push(`${idLabel}: accepted source needs a schema digest`);
    }
    if (!source.fixtureManifest) {
      errors.push(`${idLabel}: accepted source needs a fixture manifest`);
    }
    if (!source.lastPreflight) {
      errors.push(`${idLabel}: accepted source needs a last-preflight record`);
    }
  }
}

export function validateRegistryObject(registry, r0Dir = R0_DIR) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return { ok: false, errors: ["registry: expected an object"] };
  }
  if (!/^\d+\.\d+\.\d+$/.test(registry.registryVersion || "")) {
    errors.push("registryVersion: expected a semver string");
  }
  if (!isDateString(registry.reviewedAt)) {
    errors.push("reviewedAt: expected YYYY-MM-DD");
  }
  if (registry.defaultNetworkPolicy !== "deny") {
    errors.push('defaultNetworkPolicy: must be "deny"');
  }
  if (!Array.isArray(registry.sources) || registry.sources.length === 0) {
    errors.push("sources: at least one source is required");
    return { ok: false, errors };
  }
  const seenIds = new Set();
  registry.sources.forEach((source, index) => {
    checkSource(source, index, errors, seenIds, r0Dir);
  });
  return { ok: errors.length === 0, errors };
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const text = readFileSync(registryPath, "utf8");
  return JSON.parse(text);
}

function main() {
  const registryPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_REGISTRY_PATH;
  const r0Dir = path.resolve(path.dirname(registryPath), "..");
  let registry;
  try {
    registry = loadRegistry(registryPath);
  } catch (error) {
    console.error(`registry validation FAILED: cannot load ${registryPath}: ${error.message}`);
    process.exit(1);
  }
  const { ok, errors } = validateRegistryObject(registry, r0Dir);
  if (ok) {
    console.log(
      `registry validation OK: ${registry.sources.length} sources, registryVersion ${registry.registryVersion}, reviewedAt ${registry.reviewedAt}`,
    );
    return;
  }
  console.error(`registry validation FAILED: ${errors.length} error(s)`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

if (process.argv[1] === __filename) {
  main();
}
