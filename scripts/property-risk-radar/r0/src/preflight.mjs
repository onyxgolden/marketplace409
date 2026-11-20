// Preflight CLI for the Property Risk Radar R0 contract pack.
// Node 24 built-ins only.
//
// OFFLINE BUILD: this CLI evaluates the registry and the synthetic
// contract fixtures only. It never calls a live endpoint. A live preflight
// requires separate authorization (Jason) and is refused here —
// `preflight --live` exits 2 with an explanation instead of running.
//
// Commands:
//   node src/preflight.mjs validate            validate the registry
//   node src/preflight.mjs preflight           offline fixture evaluation (no writes)
//   node src/preflight.mjs preflight --live    REFUSED (exit 2)
//   node src/preflight.mjs report --out <dir>  write the deterministic acceptance report
//
// The acceptance report is deterministic: it records the registry
// reviewedAt as its timestamp (never wall-clock time), sorts keys
// canonically, and writes identical bytes on repeated runs.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRegistry,
  validateRegistryObject,
  computeSchemaDigest,
  R0_DIR,
  DEFAULT_REGISTRY_PATH,
} from "./validateRegistry.mjs";
import {
  canonicalStringify,
  digestObject,
  sha256Hex,
} from "./schemaDigest.mjs";
import * as nwsAlerts from "./adapters/nws-alerts.mjs";
import * as usgsEarthquakes from "./adapters/usgs-earthquakes.mjs";
import * as wfigsPerimeters from "./adapters/wfigs-perimeters.mjs";
import * as nhcTropical from "./adapters/nhc-tropical.mjs";
import * as femaNfhl from "./adapters/fema-nfhl.mjs";
import * as censusGeocoder from "./adapters/census-geocoder.mjs";
import * as houstonTranstar from "./cameras/houston-transtar.mjs";
import * as txdot from "./cameras/txdot.mjs";
import * as windy from "./cameras/windy.mjs";
import * as program511 from "./cameras/program-511.mjs";
import * as earthcam from "./cameras/earthcam.mjs";

const __filename = fileURLToPath(import.meta.url);

export const ADAPTERS = {
  "nws-alerts": nwsAlerts,
  "usgs-earthquakes": usgsEarthquakes,
  "wfigs-perimeters": wfigsPerimeters,
  "nhc-tropical": nhcTropical,
  "fema-nfhl": femaNfhl,
  "census-geocoder": censusGeocoder,
};

export const CAMERAS = {
  "houston-transtar": houstonTranstar,
  txdot,
  windy,
  "program-511": program511,
  earthcam,
};

export const PENDING_ITEMS = [
  "Live preflight for all six data adapters (requires Jason's separate authorization; no live endpoint was called in this build)",
  "Current live fixture: wfigs-perimeters (synthetic contract fixture only)",
  "Current live fixture: fema-nfhl (synthetic contract fixture only; layer 28 is an unverified candidate)",
  "Camera capability: no authorized no-account/no-contact in-product display source has written display rights",
];

export const CAMERA_CAPABILITY_STATEMENT =
  "BLOCKED — no authorized no-account/no-contact in-product display source has written display rights. " +
  "Houston TranStar and EarthCam are link-only; TxDOT, Windy, and 511 are disabled. " +
  "R0 does not contact providers.";

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function verifyManifest(r0Dir, source) {
  const errors = [];
  const checks = [];
  const manifestPath = path.join(r0Dir, source.fixtureManifest);
  let manifest;
  try {
    manifest = loadJson(manifestPath);
  } catch (error) {
    return { errors: [`manifest unreadable: ${error.message}`], checks };
  }
  if (manifest.adapterId !== source.id) {
    errors.push(`manifest adapterId ${manifest.adapterId} does not match source ${source.id}`);
  }
  if (manifest.fixtureKind !== source.fixtureKind) {
    errors.push(`manifest fixtureKind ${manifest.fixtureKind} does not match registry ${source.fixtureKind}`);
  }
  if (manifest.liveFixtureStatus !== source.liveFixtureStatus) {
    errors.push(`manifest liveFixtureStatus does not match registry`);
  }
  const manifestDir = path.dirname(manifestPath);
  for (const file of manifest.files || []) {
    const filePath = path.join(manifestDir, file.name);
    if (!existsSync(filePath)) {
      errors.push(`manifest file missing: ${file.name}`);
      continue;
    }
    const text = readFileSync(filePath, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const hash = sha256Hex(text);
    if (bytes !== file.bytes) {
      errors.push(`manifest ${file.name}: byte count ${bytes} != recorded ${file.bytes}`);
    }
    if (hash !== file.sha256) {
      errors.push(`manifest ${file.name}: sha256 mismatch`);
    }
  }
  if (errors.length === 0) {
    checks.push("manifest-digests-ok");
  }
  const manifestDigest = digestObject({ files: manifest.files || [] });
  if (manifest.digest !== manifestDigest) {
    errors.push("manifest digest does not match its file list");
  } else if (errors.length === 0) {
    checks.push("manifest-digest-ok");
  }
  return { errors, checks, manifestDigest };
}

function evaluateDataSource(r0Dir, source) {
  const errors = [];
  const checks = ["registry-valid"];
  const adapter = ADAPTERS[source.id];
  if (!adapter) {
    return { errors: [`no adapter module for source ${source.id}`], checks };
  }
  let metadata;
  let sample;
  try {
    metadata = loadJson(path.join(r0Dir, "fixtures", source.id, "metadata.json"));
    sample = loadJson(path.join(r0Dir, "fixtures", source.id, "sample.json"));
  } catch (error) {
    return { errors: [`fixture unreadable: ${error.message}`], checks };
  }
  const metadataErrors = adapter.validateMetadata(metadata);
  if (metadataErrors.length > 0) {
    errors.push(...metadataErrors);
  } else {
    checks.push("metadata-shape-ok");
  }
  const sampleErrors = adapter.validateSample(sample);
  if (sampleErrors.length > 0) {
    errors.push(...sampleErrors);
  } else {
    checks.push("sample-shape-ok");
  }
  const manifest = verifyManifest(r0Dir, source);
  errors.push(...manifest.errors);
  checks.push(...manifest.checks);
  if (manifest.errors.length === 0 && manifest.manifestDigest) {
    const expected = computeSchemaDigest(source, manifest.manifestDigest);
    if (expected !== source.schemaDigest) {
      errors.push("schema digest does not match the contract + fixture manifest");
    } else {
      checks.push("schema-digest-ok");
    }
  }
  return { errors, checks };
}

function evaluateCameraSource(source) {
  const errors = [];
  const checks = ["registry-valid"];
  const camera = CAMERAS[source.id];
  if (!camera) {
    return { errors: [`no camera module for source ${source.id}`], checks };
  }
  const disposition = camera.evaluate();
  if (disposition.status !== source.status) {
    errors.push(
      `evaluator status ${disposition.status} does not match registry ${source.status}`,
    );
  } else {
    checks.push("evaluator-disposition-ok");
  }
  if (canonicalStringify(disposition.rights) !== canonicalStringify(source.rights)) {
    errors.push("evaluator rights do not match registry rights");
  } else {
    checks.push("rights-ok");
  }
  if ((source.referenceMode || null) !== (disposition.referenceMode || null)) {
    errors.push("evaluator reference mode does not match registry");
  }
  const expected = computeSchemaDigest(source, null);
  if (expected !== source.schemaDigest) {
    errors.push("schema digest does not match the contract + rights disposition");
  } else {
    checks.push("schema-digest-ok");
  }
  return { errors, checks };
}

export function evaluateOffline(r0Dir = R0_DIR, registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = loadRegistry(registryPath);
  const validation = validateRegistryObject(registry, r0Dir);
  const results = [];
  const errors = [...validation.errors];
  for (const source of registry.sources) {
    const outcome =
      source.category === "camera"
        ? evaluateCameraSource(source)
        : evaluateDataSource(r0Dir, source);
    errors.push(...outcome.errors.map((error) => `${source.id}: ${error}`));
    results.push({
      id: source.id,
      category: source.category,
      status: source.status,
      statusReason: source.statusReason,
      schemaDigest: source.schemaDigest,
      fixtureKind: source.fixtureKind,
      liveFixtureStatus: source.liveFixtureStatus,
      checks: outcome.checks,
      errors: outcome.errors,
    });
  }
  const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id));
  return {
    registry,
    registryDigest: digestObject(registry),
    results: sorted,
    ok: errors.length === 0,
    errors,
  };
}

export function buildReport(r0Dir = R0_DIR, outDir) {
  if (!outDir) {
    throw new Error("report requires a caller-supplied --out directory");
  }
  const evaluation = evaluateOffline(r0Dir);
  const { registry } = evaluation;
  const counts = {
    sources: evaluation.results.length,
    dataAdapters: evaluation.results.filter((r) => r.category !== "camera").length,
    cameras: evaluation.results.filter((r) => r.category === "camera").length,
    accepted: evaluation.results.filter((r) => r.status === "accepted").length,
    disabled: evaluation.results.filter((r) => r.status === "disabled").length,
    blocked: evaluation.results.filter((r) => r.status === "blocked").length,
  };
  const report = {
    reportVersion: "1.0.0",
    registryVersion: registry.registryVersion,
    reviewedAt: registry.reviewedAt,
    generatedAt: registry.reviewedAt,
    mode: "offline",
    livePreflight:
      "NOT RUN — live preflight requires separate authorization (Jason). No live endpoint was called in this build.",
    cameraCapability: CAMERA_CAPABILITY_STATEMENT,
    pendingItems: PENDING_ITEMS,
    counts,
    registryDigest: evaluation.registryDigest,
    sources: evaluation.results,
    ok: evaluation.ok,
    errors: evaluation.errors,
  };
  const jsonText = `${canonicalStringify(report)}\n`;
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "r0-acceptance.json");
  const mdPath = path.join(outDir, "r0-acceptance.md");
  writeFileSync(jsonPath, jsonText, "utf8");
  writeFileSync(mdPath, renderReportMarkdown(report), "utf8");
  return { jsonPath, mdPath, report };
}

function renderReportMarkdown(report) {
  const lines = [];
  lines.push("# Property Risk Radar R0 — acceptance report");
  lines.push("");
  lines.push(`- Report version: ${report.reportVersion}`);
  lines.push(`- Registry version: ${report.registryVersion} (reviewed ${report.reviewedAt})`);
  lines.push(`- Mode: offline (generated ${report.generatedAt}; no wall-clock time is recorded)`);
  lines.push(`- Registry digest: \`${report.registryDigest}\``);
  lines.push(`- Result: ${report.ok ? "PASS (offline subset)" : "FAIL"}`);
  lines.push("");
  lines.push("## Live preflight");
  lines.push("");
  lines.push(report.livePreflight);
  lines.push("");
  lines.push("## Camera capability");
  lines.push("");
  lines.push(report.cameraCapability);
  lines.push("");
  lines.push("## Pending items (not passed, not claimed)");
  lines.push("");
  for (const item of report.pendingItems) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push(`- Sources: ${report.counts.sources} (${report.counts.dataAdapters} data adapters/geocoder, ${report.counts.cameras} cameras)`);
  lines.push(`- Accepted: ${report.counts.accepted}; disabled: ${report.counts.disabled}; blocked: ${report.counts.blocked}`);
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  lines.push("| Source | Category | Status | Fixture | Live fixture | Checks |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const source of report.sources) {
    lines.push(
      `| ${source.id} | ${source.category} | ${source.status} | ${source.fixtureKind} | ${source.liveFixtureStatus} | ${source.checks.join(", ") || "—"} |`,
    );
  }
  lines.push("");
  if (report.errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- HTTP 200 is never rights evidence. One rights mode never implies another.");
  lines.push("- An empty result (zero alerts, zero quakes, zero matches, unmapped point) is a valid observation, distinct from unavailable, unauthorized, drifted, or uncovered.");
  lines.push("- Fixtures are synthetic contracts invented for R0. They prove shape, not live availability or current live schema.");
  lines.push("");
  return lines.join("\n");
}

function printUsage() {
  console.error("Usage:");
  console.error("  node src/preflight.mjs validate");
  console.error("  node src/preflight.mjs preflight [--offline]");
  console.error("  node src/preflight.mjs preflight --live   (refused: needs separate authorization)");
  console.error("  node src/preflight.mjs report --out <dir>");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "validate" || command === undefined) {
    const registry = loadRegistry(DEFAULT_REGISTRY_PATH);
    const { ok, errors } = validateRegistryObject(registry, R0_DIR);
    if (ok) {
      console.log(
        `registry validation OK: ${registry.sources.length} sources, registryVersion ${registry.registryVersion}`,
      );
      return;
    }
    console.error(`registry validation FAILED: ${errors.length} error(s)`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  if (command === "preflight") {
    if (rest.includes("--live")) {
      console.error(
        "LIVE PREFLIGHT REFUSED: a live preflight requires Jason's separate authorization. " +
          "This R0 offline build never calls a live endpoint. Run `preflight --offline` instead.",
      );
      process.exit(2);
    }
    const evaluation = evaluateOffline(R0_DIR, DEFAULT_REGISTRY_PATH);
    for (const result of evaluation.results) {
      console.log(
        `${result.id}: ${result.status} [${result.checks.join(", ")}]${result.errors.length > 0 ? ` ERRORS: ${result.errors.join("; ")}` : ""}`,
      );
    }
    if (!evaluation.ok) {
      console.error(`offline preflight FAILED: ${evaluation.errors.length} error(s)`);
      process.exit(1);
    }
    console.log(
      `offline preflight OK: ${evaluation.results.length} sources evaluated, 0 live calls made`,
    );
    return;
  }
  if (command === "report") {
    const outIndex = rest.indexOf("--out");
    const outDir = outIndex >= 0 ? rest[outIndex + 1] : undefined;
    if (!outDir) {
      console.error("report requires --out <dir>: live output goes only to a caller-supplied directory.");
      printUsage();
      process.exit(2);
    }
    const { jsonPath, mdPath, report } = buildReport(
      R0_DIR,
      path.resolve(outDir),
    );
    console.log(`acceptance report written: ${jsonPath}`);
    console.log(`acceptance report written: ${mdPath}`);
    console.log(
      `result: ${report.ok ? "PASS (offline subset)" : "FAIL"} — ${report.counts.sources} sources, ${report.counts.accepted} accepted, ${report.counts.disabled} disabled, ${report.counts.blocked} blocked`,
    );
    if (!report.ok) {
      process.exit(1);
    }
    return;
  }
  printUsage();
  process.exit(2);
}

if (process.argv[1] === __filename) {
  main();
}
