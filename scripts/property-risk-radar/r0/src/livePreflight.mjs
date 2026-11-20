// Live preflight runner for the Property Risk Radar R0 contract pack.
// Node 24 built-ins only.
//
// Runs ONLY under Jason's separate authorization, passed as an explicit
// --authorization reference on the CLI. The runner refuses to run without
// one. Every call is metadata-first, bounded by the fail-closed HTTP
// harness (one concurrent request/host, 10 s timeout, two allowlisted HTTPS
// redirects, 5 MiB cap, at most one 429/5xx retry honoring Retry-After),
// and writes ONLY to a caller-supplied output directory. Nothing is
// committed without a human review of that directory.
//
// Per adapter the runner executes the adapter's own declared
// preflightPlan() step by step: fetch metadata first, resolve the
// official service/item/layer identity, then fetch the bounded sample,
// validate both against the adapter contract (including the declared
// response paths), and write reviewed, sanitized live fixtures + a
// manifest. A provider failure, 403, moved identity, or unavailable
// current schema is recorded as BLOCKED — never replaced with an
// unofficial source.
//
// The runner writes: fixtures/<id>/{metadata,sample,manifest}.json and
// live-record.json. It does NOT touch the repo: promotion is a separate,
// reviewed step (see docs/product/property-risk-radar-r0-runbook.md).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBoundedFetch,
  findSecretLike,
  NWS_USER_AGENT,
} from "./http.mjs";
import {
  canonicalStringify,
  digestObject,
  sha256Hex,
  checkDeclaredResponsePaths,
} from "./schemaDigest.mjs";
import { computeSchemaDigest } from "./validateRegistry.mjs";
import * as nwsAlerts from "./adapters/nws-alerts.mjs";
import * as usgsEarthquakes from "./adapters/usgs-earthquakes.mjs";
import * as wfigsPerimeters from "./adapters/wfigs-perimeters.mjs";
import * as nhcTropical from "./adapters/nhc-tropical.mjs";
import * as femaNfhl from "./adapters/fema-nfhl.mjs";
import * as censusGeocoder from "./adapters/census-geocoder.mjs";

const __filename = fileURLToPath(import.meta.url);
const R0_DIR = path.resolve(path.dirname(__filename), "..");

export const LIVE_ADAPTERS = {
  "nws-alerts": nwsAlerts,
  "usgs-earthquakes": usgsEarthquakes,
  "wfigs-perimeters": wfigsPerimeters,
  "nhc-tropical": nhcTropical,
  "fema-nfhl": femaNfhl,
  "census-geocoder": censusGeocoder,
};

export const LIVE_ADAPTER_ORDER = [
  "nws-alerts",
  "usgs-earthquakes",
  "wfigs-perimeters",
  "nhc-tropical",
  "fema-nfhl",
  "census-geocoder",
];

// Official link-chain targets for the FEMA NFHL identity resolution.
// The fema.gov page links the official NFHL resources (the Map Service
// Center and the hazards.fema.gov WMS portal); it does NOT link the REST
// service path verbatim (verified 2026-11-20). Any of these proves the
// page points at the official NFHL service family; the REST endpoint
// itself is then verified by its own metadata, which must self-identify
// as NFHL. The matched target is recorded in the step record.
export const FEMA_LINK_CHAIN_TARGETS = [
  "hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/",
  "https://msc.fema.gov/nfhl",
  "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS",
];

const MAX_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 1;

function limits() {
  return {
    timeoutMs: MAX_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxBytes: MAX_BYTES,
    maxRetries: MAX_RETRIES,
    maxConcurrentPerHost: 1,
  };
}

// Serialize one fixture file deterministically. Returns the file's
// byte length and sha256 so the manifest (and the live record) can pin
// exactly what was written.
function writeFixtureFile(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(filePath, text, "utf8");
  return { bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(text) };
}

// A fixture must carry no secret-like content and no coordinate outside
// WGS84 range. Mirrors the committed fixture tests; a failure here is a
// BLOCKED outcome, never a silent pass. Only arrays on a `.coordinates`
// path are coordinates: ArcGIS metadata carries two-number arrays that
// are NOT positions (e.g. NHC layers[].subLayerIds), and flagging those
// is a false positive.
function sanitizeCheck(value, label) {
  const errors = [];
  const secret = findSecretLike(value);
  if (secret) errors.push(`${label}: secret-like content: ${secret}`);
  const bad = [];
  (function walk(v, trail) {
    if (Array.isArray(v)) {
      if (
        trail.includes(".coordinates") &&
        v.length === 2 &&
        typeof v[0] === "number" &&
        typeof v[1] === "number"
      ) {
        if (v[0] < -180 || v[0] > 180 || v[1] < -90 || v[1] > 90) {
          bad.push(`${trail}=[${v[0]}, ${v[1]}]`);
        }
      }
      v.forEach((item, i) => walk(item, `${trail}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) walk(child, `${trail}.${k}`);
    }
  })(value, label);
  if (bad.length > 0) {
    errors.push(`${label}: coordinates outside WGS84 range: ${bad.join("; ")}`);
  }
  return errors;
}

function parseJson(bodyText, label) {
  try {
    return { value: JSON.parse(bodyText), errors: [] };
  } catch (err) {
    return { value: null, errors: [`${label}: response is not valid JSON: ${err.message}`] };
  }
}

// One bounded GET of a declared plan step. The step record pins exactly
// what the provider sent (URL, status, bytes, sha256, content type,
// redirects, retries, elapsed) without keeping the body in the record.
// A transport failure is recorded as a step with status 0 and the error
// message — never thrown past the runner, so the block reason names the
// step that failed.
async function fetchStep(fetchFn, planStep, url) {
  const started = Date.now();
  try {
    const result = await fetchFn(url);
    const elapsedMs = Date.now() - started;
    // The harness returns no `ok` flag: success is a 2xx status.
    const ok = result.status >= 200 && result.status < 300;
    return {
      step: planStep.step,
      purpose: planStep.purpose,
      url: result.url,
      status: result.status,
      bytes: result.bodyBytes,
      sha256: sha256Hex(result.bodyText),
      contentType: result.headers["content-type"] || null,
      redirects: result.redirects,
      retries: result.retries,
      elapsedMs,
      bodyText: result.bodyText,
      ok,
      error: null,
    };
  } catch (err) {
    return {
      step: planStep.step,
      purpose: planStep.purpose,
      url,
      status: 0,
      bytes: 0,
      sha256: sha256Hex(""),
      contentType: null,
      redirects: 0,
      retries: 0,
      elapsedMs: Date.now() - started,
      bodyText: "",
      ok: false,
      error: err.message,
    };
  }
}

function describeStepFailure(step) {
  if (step.error) return `transport error: ${step.error}`;
  return `HTTP ${step.status}`;
}

// Run the contract's declared response paths against a live sample, so
// live drift in field names is detected at preflight, not at runtime.
function declaredPathErrors(sample, adapterModule, label) {
  return checkDeclaredResponsePaths(sample, adapterModule.CONTRACT, label);
}

function newSourceRecord(id) {
  return {
    id,
    outcome: "blocked",
    reason: "Not run.",
    lastPreflight: null,
    liveFixtureStatus: "pending-live-preflight",
    fixtureKind: "synthetic-contract",
    resolvedIdentity: null,
    steps: [],
    validationErrors: [],
    sourceTimestamps: {},
    fixtureDigests: null,
    manifestDigest: null,
    schemaDigest: null,
    limits: limits(),
  };
}

function boundedFetchFor(contract, fetchImpl) {
  return createBoundedFetch({
    fetchImpl,
    allowHosts: contract.network.hosts,
    allowPathPrefixes: contract.network.pathPrefixes,
    userAgent: NWS_USER_AGENT,
  });
}

// Sanitize, then write the live fixtures + manifest for an accepted
// source. The manifest pins the exact bytes written; the registry digest
// is computed from the contract + that manifest digest.
function finishAccepted(record, { metadataFixture, sampleFixture, resolvedIdentity, fullDocDigest, fullDocBytes }) {
  const id = record.id;
  const sanitizeErrors = [
    ...sanitizeCheck(metadataFixture, `${id} metadata fixture`),
    ...sanitizeCheck(sampleFixture, `${id} sample fixture`),
  ];
  if (sanitizeErrors.length > 0) {
    record.validationErrors.push(...sanitizeErrors);
    record.reason = "Live fixture failed the sanitize check; not written.";
    return;
  }
  const dir = path.join(record._outDir, "fixtures", id);
  mkdirSync(dir, { recursive: true });
  const metadataInfo = writeFixtureFile(path.join(dir, "metadata.json"), metadataFixture);
  const sampleInfo = writeFixtureFile(path.join(dir, "sample.json"), sampleFixture);
  const manifest = {
    adapterId: id,
    fixtureKind: "live",
    liveFixtureStatus: "live",
    generatedFrom: `Live preflight ${record._invocationTime} under authorization "${record._authorization}". Raw response digests are in the live record; fixture files are the sanitized live responses.`,
    files: [
      { name: "metadata.json", sha256: metadataInfo.sha256, bytes: metadataInfo.bytes },
      { name: "sample.json", sha256: sampleInfo.sha256, bytes: sampleInfo.bytes },
    ],
  };
  manifest.digest = digestObject({ files: manifest.files });
  const manifestInfo = writeFixtureFile(path.join(dir, "manifest.json"), manifest);
  const mod = LIVE_ADAPTERS[id];
  const schemaDigest = computeSchemaDigest(mod.CONTRACT, manifest.digest);
  record.outcome = "accepted";
  record.reason = `Live preflight ${record._invocationTime} passed; current live fixture recorded.`;
  record.lastPreflight = record._invocationTime;
  record.liveFixtureStatus = "live";
  record.fixtureKind = "live";
  record.resolvedIdentity = resolvedIdentity;
  record.fixtureDigests = {
    "metadata.json": metadataInfo,
    "sample.json": sampleInfo,
    "manifest.json": manifestInfo,
  };
  record.manifestDigest = manifest.digest;
  record.schemaDigest = schemaDigest;
  if (fullDocDigest) {
    record.fullDocumentDigest = fullDocDigest;
    record.fullDocumentBytes = fullDocBytes;
  }
}

function stepRecord(step) {
  const { bodyText, ok, ...record } = step;
  void bodyText;
  void ok;
  return record;
}

async function runNwsAlerts(record, fetchImpl) {
  const mod = nwsAlerts;
  const plan = mod.preflightPlan();
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const metadataStep = await fetchStep(fetchFn, plan[0], plan[0].urlTemplate);
  record.steps.push(stepRecord(metadataStep));
  if (!metadataStep.ok) {
    record.reason = `Live metadata fetch failed (${describeStepFailure(metadataStep)}).`;
    return record;
  }
  const parsed = parseJson(metadataStep.bodyText, "nws-alerts metadata");
  if (parsed.errors.length > 0) {
    record.validationErrors.push(...parsed.errors);
    record.reason = "Live metadata is not valid JSON.";
    return record;
  }
  const metadataErrors = mod.validateMetadata(parsed.value);
  if (metadataErrors.length > 0) {
    record.validationErrors.push(...metadataErrors);
    record.reason = "Live metadata failed contract validation.";
    return record;
  }
  const doc = parsed.value;
  const metadataFixture = {
    synthetic: false,
    openapi: doc.openapi,
    info: doc.info,
    paths: { "/alerts/active": doc.paths?.["/alerts/active"] ?? null },
  };
  const sampleStep = await fetchStep(fetchFn, plan[1], plan[1].urlTemplate);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "nws-alerts sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "nws-alerts sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const sampleFixture = { ...sampleParsed.value, synthetic: false };
  const features = sampleParsed.value.features ?? [];
  const effective = features
    .map((f) => f.properties?.effective)
    .filter(Boolean)
    .sort();
  const expires = features
    .map((f) => f.properties?.expires)
    .filter(Boolean)
    .sort();
  record.sourceTimestamps = {
    alerts: features.length,
    earliestEffective: effective[0] ?? null,
    latestExpires: expires[expires.length - 1] ?? null,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: { service: "NWS API", item: null, layer: null, layerId: null },
    fullDocDigest: metadataStep.sha256,
    fullDocBytes: metadataStep.bytes,
  });
  return record;
}

async function runUsgsEarthquakes(record, fetchImpl) {
  const mod = usgsEarthquakes;
  const plan = mod.preflightPlan();
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const sampleStep = await fetchStep(fetchFn, plan[0], plan[0].urlTemplate);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "usgs-earthquakes sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "usgs-earthquakes sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const feed = sampleParsed.value;
  const metadataFixture = { ...(feed.metadata ?? {}), synthetic: false };
  const sampleFixture = { ...feed, synthetic: false };
  record.sourceTimestamps = {
    generated: feed.metadata?.generated ?? null,
    count: feed.metadata?.count ?? null,
    features: Array.isArray(feed.features) ? feed.features.length : null,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: { service: "USGS Earthquake Hazards Program", item: null, layer: null, layerId: null },
  });
  return record;
}

async function runWfigsPerimeters(record, fetchImpl) {
  const mod = wfigsPerimeters;
  const plan = mod.preflightPlan();
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const metadataStep = await fetchStep(fetchFn, plan[0], plan[0].urlTemplate);
  record.steps.push(stepRecord(metadataStep));
  if (!metadataStep.ok) {
    record.reason = `Live metadata fetch failed (${describeStepFailure(metadataStep)}).`;
    return record;
  }
  const parsed = parseJson(metadataStep.bodyText, "wfigs-perimeters metadata");
  if (parsed.errors.length > 0) {
    record.validationErrors.push(...parsed.errors);
    record.reason = "Live metadata is not valid JSON.";
    return record;
  }
  const metadataErrors = mod.validateMetadata(parsed.value);
  if (metadataErrors.length > 0) {
    record.validationErrors.push(...metadataErrors);
    record.reason = "Live metadata failed contract validation.";
    return record;
  }
  const metadataFixture = { ...parsed.value, synthetic: false };
  const sampleStep = await fetchStep(fetchFn, plan[1], plan[1].urlTemplate);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "wfigs-perimeters sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "wfigs-perimeters sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const sampleFixture = { ...sampleParsed.value, synthetic: false };
  const first = sampleParsed.value.features?.[0];
  record.sourceTimestamps = {
    features: sampleParsed.value.features?.length ?? null,
    dateCurrent: first?.properties?.poly_DateCurrent ?? null,
    exceededTransferLimit: sampleParsed.value.properties?.exceededTransferLimit ?? null,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: { service: "WFIGS", item: "WFIGS_Interagency_Perimeters_Current", layer: parsed.value.name ?? "Perimeters", layerId: 0 },
  });
  return record;
}

async function runNhcTropical(record, fetchImpl) {
  const mod = nhcTropical;
  const plan = mod.preflightPlan();
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const metadataStep = await fetchStep(fetchFn, plan[0], plan[0].urlTemplate);
  record.steps.push(stepRecord(metadataStep));
  if (!metadataStep.ok) {
    record.reason = `Live metadata fetch failed (${describeStepFailure(metadataStep)}).`;
    return record;
  }
  const parsed = parseJson(metadataStep.bodyText, "nhc-tropical metadata");
  if (parsed.errors.length > 0) {
    record.validationErrors.push(...parsed.errors);
    record.reason = "Live metadata is not valid JSON.";
    return record;
  }
  const metadataErrors = mod.validateMetadata(parsed.value);
  if (metadataErrors.length > 0) {
    record.validationErrors.push(...metadataErrors);
    record.reason = "Live metadata failed contract validation.";
    return record;
  }
  const metadataFixture = { ...parsed.value, synthetic: false };
  const layersStep = await fetchStep(fetchFn, plan[1], plan[1].urlTemplate);
  record.steps.push(stepRecord(layersStep));
  if (!layersStep.ok) {
    record.reason = `Live layers fetch failed (${describeStepFailure(layersStep)}).`;
    return record;
  }
  const layersParsed = parseJson(layersStep.bodyText, "nhc-tropical layers");
  if (layersParsed.errors.length > 0) {
    record.validationErrors.push(...layersParsed.errors);
    record.reason = "Live layers response is not valid JSON.";
    return record;
  }
  const layers = layersParsed.value.layers ?? layersParsed.value.Layers ?? [];
  if (!Array.isArray(layers) || layers.length === 0) {
    record.reason = "Live layers list is empty; forecast layer identity unresolved.";
    return record;
  }
  const byName = layers.map((l) => ({ id: l.id, name: l.name }));
  const pin = (kind) =>
    byName
      .filter((l) => typeof l.name === "string" && l.name.toLowerCase().includes(`forecast ${kind}`))
      .sort((a, b) => a.id - b.id)[0] ?? null;
  const pinned = pin("points") ?? pin("track") ?? pin("cone");
  if (!pinned) {
    record.resolvedIdentity = { service: "NHC", item: "NHC_tropical_weather", layer: null, layerId: null, layers: byName };
    record.reason = "No forecast points/track/cone layer found in the live layers list; identity unresolved.";
    return record;
  }
  // Record the pinned identity now, so a block at the sample step still
  // names the layer that was pinned.
  record.resolvedIdentity = {
    service: "NHC",
    item: "NHC_tropical_weather",
    layer: pinned.name,
    layerId: pinned.id,
    layers: byName,
  };
  const sampleUrl = plan[2].urlTemplate.replace("{layerId}", String(pinned.id));
  const sampleStep = await fetchStep(fetchFn, plan[2], sampleUrl);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "nhc-tropical sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "nhc-tropical sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const sampleFixture = { ...sampleParsed.value, synthetic: false };
  const first = sampleParsed.value.features?.[0];
  record.sourceTimestamps = {
    features: sampleParsed.value.features?.length ?? null,
    advisory: first?.properties?.ADVISORY ?? null,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: {
      service: "NHC",
      item: "NHC_tropical_weather",
      layer: pinned.name,
      layerId: pinned.id,
      layers: byName,
    },
  });
  return record;
}

async function runFemaNfhl(record, fetchImpl) {
  const mod = femaNfhl;
  const plan = mod.preflightPlan();
  // Step 1: official link chain. A dedicated bounded fetch whose allowlist
  // covers exactly the FEMA page and the NFHL REST path — the adapter's
  // own allowlist does not include www.fema.gov.
  const linkFetch = createBoundedFetch({
    fetchImpl,
    allowHosts: ["www.fema.gov", "hazards.fema.gov"],
    allowPathPrefixes: ["/flood-maps/", "/gis/nfhl/"],
    userAgent: NWS_USER_AGENT,
  });
  const linkStep = await fetchStep(linkFetch, plan[0], plan[0].urlTemplate);
  const linkTarget = linkStep.ok
    ? FEMA_LINK_CHAIN_TARGETS.find((target) => linkStep.bodyText.includes(target)) ?? null
    : null;
  record.steps.push({ ...stepRecord(linkStep), linkFound: linkTarget !== null, linkTarget });
  if (!linkStep.ok) {
    record.reason = `Official FEMA link-chain page failed (${describeStepFailure(linkStep)}); NFHL identity unverified.`;
    return record;
  }
  if (!linkTarget) {
    record.reason = "Official FEMA page does not link any official NFHL resource; identity unverified.";
    return record;
  }
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const metadataStep = await fetchStep(fetchFn, plan[1], plan[1].urlTemplate);
  record.steps.push(stepRecord(metadataStep));
  if (!metadataStep.ok) {
    record.reason = `Live metadata fetch failed (${describeStepFailure(metadataStep)}).`;
    return record;
  }
  const parsed = parseJson(metadataStep.bodyText, "fema-nfhl metadata");
  if (parsed.errors.length > 0) {
    record.validationErrors.push(...parsed.errors);
    record.reason = "Live metadata is not valid JSON.";
    return record;
  }
  const metadataErrors = mod.validateMetadata(parsed.value);
  if (metadataErrors.length > 0) {
    record.validationErrors.push(...metadataErrors);
    record.reason = "Live metadata failed contract validation.";
    return record;
  }
  const metadataFixture = { ...parsed.value, synthetic: false };
  const layers = parsed.value.layers ?? [];
  const layer28 = layers.find((l) => l.id === 28);
  if (!layer28 || !/flood hazard zones/i.test(layer28.name ?? "")) {
    record.resolvedIdentity = {
      service: "FEMA NFHL",
      item: "NFHL",
      layer: layer28?.name ?? null,
      layerId: 28,
      layerCandidate: true,
      layers: layers.map((l) => ({ id: l.id, name: l.name })),
    };
    record.reason = "Layer 28 is not a Flood Hazard Zones layer in the live metadata; identity unresolved.";
    return record;
  }
  const sampleStep = await fetchStep(fetchFn, plan[2], plan[2].urlTemplate);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "fema-nfhl sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "fema-nfhl sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const sampleFixture = { ...sampleParsed.value, synthetic: false };
  const first = sampleParsed.value.features?.[0];
  record.sourceTimestamps = {
    features: sampleParsed.value.features?.length ?? null,
    effDate: first?.properties?.EFF_DATE ?? null,
    mapped: (sampleParsed.value.features?.length ?? 0) > 0,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: {
      service: "FEMA NFHL",
      item: "NFHL",
      layer: layer28.name,
      layerId: 28,
      layerCandidate: false,
    },
  });
  return record;
}

async function runCensusGeocoder(record, fetchImpl) {
  const mod = censusGeocoder;
  const plan = mod.preflightPlan();
  const fetchFn = boundedFetchFor(mod.CONTRACT, fetchImpl);
  const sampleStep = await fetchStep(fetchFn, plan[0], plan[0].urlTemplate);
  record.steps.push(stepRecord(sampleStep));
  if (!sampleStep.ok) {
    record.reason = `Live sample fetch failed (${describeStepFailure(sampleStep)}).`;
    return record;
  }
  const sampleParsed = parseJson(sampleStep.bodyText, "census-geocoder sample");
  if (sampleParsed.errors.length > 0) {
    record.validationErrors.push(...sampleParsed.errors);
    record.reason = "Live sample is not valid JSON.";
    return record;
  }
  const sampleErrors = [
    ...mod.validateSample(sampleParsed.value),
    ...declaredPathErrors(sampleParsed.value, mod, "census-geocoder sample"),
  ];
  if (sampleErrors.length > 0) {
    record.validationErrors.push(...sampleErrors);
    record.reason = "Live sample failed contract validation.";
    return record;
  }
  const result = sampleParsed.value.result;
  // The live benchmark is an object ({ benchmarkName }) or a string.
  const benchmarkName =
    typeof result?.input?.benchmark === "string"
      ? result.input.benchmark
      : result?.input?.benchmark?.benchmarkName ?? null;
  const metadataFixture = {
    synthetic: false,
    service: "Census Geocoder",
    benchmark: benchmarkName,
    interpolated: true,
  };
  const sampleFixture = { ...sampleParsed.value, synthetic: false };
  record.sourceTimestamps = {
    benchmark: benchmarkName,
    matches: result?.addressMatches?.length ?? null,
  };
  finishAccepted(record, {
    metadataFixture,
    sampleFixture,
    resolvedIdentity: { service: "Census Geocoder", item: null, layer: null, layerId: null },
  });
  return record;
}

const RUNNERS = {
  "nws-alerts": runNwsAlerts,
  "usgs-earthquakes": runUsgsEarthquakes,
  "wfigs-perimeters": runWfigsPerimeters,
  "nhc-tropical": runNhcTropical,
  "fema-nfhl": runFemaNfhl,
  "census-geocoder": runCensusGeocoder,
};

// Run the live preflight for every data adapter, sequentially, writing
// fixtures + manifests + live-record.json into outDir. Throws without an
// authorization reference. Returns { record, ok } where ok is true only
// when every adapter was accepted. A blocked adapter is a recorded
// outcome, not an exception.
export async function runLivePreflight({ outDir, authorization, fetchImpl, adapterIds = LIVE_ADAPTER_ORDER, now = new Date() }) {
  if (typeof authorization !== "string" || authorization.trim() === "") {
    throw new Error(
      "Live preflight requires an explicit authorization reference. It is refused without one.",
    );
  }
  const invocationTime = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  mkdirSync(outDir, { recursive: true });
  const record = {
    recordVersion: "1.0.0",
    invocationTime,
    authorization,
    r0Dir: R0_DIR,
    sources: [],
  };
  for (const id of adapterIds) {
    const sourceRecord = newSourceRecord(id);
    sourceRecord._outDir = outDir;
    sourceRecord._invocationTime = invocationTime;
    sourceRecord._authorization = authorization;
    try {
      await RUNNERS[id](sourceRecord, fetchImpl);
    } catch (err) {
      sourceRecord.reason = `Live preflight error: ${err.message}`;
      sourceRecord.validationErrors.push(`live preflight error: ${err.message}`);
    }
    delete sourceRecord._outDir;
    delete sourceRecord._invocationTime;
    delete sourceRecord._authorization;
    record.sources.push(sourceRecord);
  }
  record.accepted = record.sources.filter((s) => s.outcome === "accepted").length;
  record.blocked = record.sources.filter((s) => s.outcome === "blocked").length;
  record.ok = record.blocked === 0;
  writeFileSync(
    path.join(outDir, "live-record.json"),
    `${canonicalStringify(record)}\n`,
    "utf8",
  );
  return { record, ok: record.ok };
}
