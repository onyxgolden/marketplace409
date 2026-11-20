// Preflight CLI for the Property Risk Radar R0 contract pack.
// Node 24 built-ins only.
//
// OFFLINE by default: this CLI evaluates the registry and the fixtures
// only, and never calls a live endpoint. A live preflight runs only under
// Jason's separate authorization, passed as an explicit --authorization
// reference: `preflight --live --out <dir> --authorization "<reference>"`.
// Without the reference the live run is refused (exit 2). Live output
// goes only to the caller-supplied directory and is reviewed before any
// fixture is committed; promotion is a separate, reviewed step (see
// docs/product/property-risk-radar-r0-runbook.md).
//
// Commands:
//   node src/preflight.mjs validate            validate the registry
//   node src/preflight.mjs preflight           offline fixture evaluation (no writes)
//   node src/preflight.mjs preflight --live --out <dir> --authorization "<ref>"
//   node src/preflight.mjs report --out <dir> [--live-record <path>]
//
// The acceptance report is deterministic: it records the registry
// reviewedAt as its timestamp in offline mode (never wall-clock time),
// or the live record's invocation time in live mode; it sorts keys
// canonically and writes identical bytes on repeated runs from the same
// inputs.

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

// Pending items derive from the registry state: a data adapter still on
// a synthetic fixture, or blocked at the last live preflight, stays
// pending. The camera capability is pending until a display-rights source
// exists. Before any live run, the pending list is PENDING_ITEMS.
export function pendingItemsFor(evaluation, liveRecord = null) {
  const liveById = new Map((liveRecord?.sources ?? []).map((s) => [s.id, s]));
  const anyLive =
    liveRecord !== null ||
    evaluation.results.some((r) => r.lastPreflight);
  if (!anyLive) return [...PENDING_ITEMS];
  const items = [];
  for (const result of evaluation.results) {
    if (result.category === "camera") continue;
    const live = liveById.get(result.id);
    if (live?.outcome === "blocked" || result.status === "blocked") {
      items.push(
        `Live preflight follow-up: ${result.id} blocked — ${live?.reason ?? result.statusReason}`,
      );
      continue;
    }
    if (result.fixtureKind === "synthetic-contract") {
      const note =
        result.id === "fema-nfhl"
          ? "Current live fixture: fema-nfhl (synthetic contract fixture only; layer 28 is an unverified candidate)"
          : `Current live fixture: ${result.id} (synthetic contract fixture only)`;
      items.push(note);
    }
  }
  items.push(
    "Camera capability: no authorized no-account/no-contact in-product display source has written display rights",
  );
  return items;
}

function livePreflightTextFor(evaluation, liveRecord) {
  if (liveRecord) {
    return (
      `RUN ${liveRecord.invocationTime} under authorization "${liveRecord.authorization}". ` +
      `${liveRecord.accepted} of ${liveRecord.sources.length} data adapters accepted, ` +
      `${liveRecord.blocked} blocked. No account, signup, key, contact, or spend. ` +
      "Raw response digests, source timestamps, and per-step outcomes are in live-record.json."
    );
  }
  const times = evaluation.results
    .map((r) => r.lastPreflight)
    .filter(Boolean)
    .sort();
  if (times.length > 0) {
    return (
      `NOT RUN in this generation. Last live preflight ${times[times.length - 1]} ` +
      "(see the live acceptance report for the run record). No live endpoint was called by this generation."
    );
  }
  return "NOT RUN — live preflight requires separate authorization (Jason). No live endpoint was called in this build.";
}

function reportNotesFor(evaluation, liveRecord) {
  const notes = [
    "- HTTP 200 is never rights evidence. One rights mode never implies another.",
    "- An empty result (zero alerts, zero quakes, zero matches, unmapped point) is a valid observation, distinct from unavailable, unauthorized, drifted, or uncovered.",
  ];
  const liveCount = evaluation.results.filter(
    (r) => r.fixtureKind === "live",
  ).length;
  const syntheticCount = evaluation.results.filter(
    (r) => r.category !== "camera" && r.fixtureKind === "synthetic-contract",
  ).length;
  if (liveCount > 0) {
    const times = evaluation.results
      .map((r) => r.lastPreflight)
      .filter(Boolean)
      .sort();
    notes.push(
      `- Live fixtures (${liveCount}) are sanitized live responses recorded at ${times[times.length - 1] ?? liveRecord?.invocationTime ?? "the last live preflight"} and reviewed before commit; they prove current live shape for those sources.`,
    );
  }
  if (syntheticCount > 0) {
    notes.push(
      "- Synthetic fixtures are contracts invented for R0. They prove shape, not live availability or current live schema.",
    );
  }
  return notes;
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
      lastPreflight: source.lastPreflight,
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

export function buildReport(r0Dir = R0_DIR, outDir, liveRecord = null) {
  if (!outDir) {
    throw new Error("report requires a caller-supplied --out directory");
  }
  const evaluation = evaluateOffline(r0Dir);
  const { registry } = evaluation;
  // A live report is only honest after promotion: the registry must agree
  // with the run's outcomes. Build it before promotion and it is refused.
  if (liveRecord) {
    for (const source of liveRecord.sources) {
      const reg = evaluation.results.find((r) => r.id === source.id);
      if (!reg) {
        throw new Error(`live record covers unknown source ${source.id}`);
      }
      if (reg.status !== source.outcome) {
        throw new Error(
          `live record says ${source.id} ${source.outcome} but the registry lists it as ${reg.status}; promote the reviewed fixtures first (see the runbook).`,
        );
      }
    }
  }
  const counts = {
    sources: evaluation.results.length,
    dataAdapters: evaluation.results.filter((r) => r.category !== "camera").length,
    cameras: evaluation.results.filter((r) => r.category === "camera").length,
    accepted: evaluation.results.filter((r) => r.status === "accepted").length,
    disabled: evaluation.results.filter((r) => r.status === "disabled").length,
    blocked: evaluation.results.filter((r) => r.status === "blocked").length,
  };
  const liveRun = liveRecord
    ? {
        invocationTime: liveRecord.invocationTime,
        authorization: liveRecord.authorization,
        accepted: liveRecord.accepted,
        blocked: liveRecord.blocked,
        sources: liveRecord.sources.map((s) => ({
          id: s.id,
          outcome: s.outcome,
          reason: s.reason,
          lastPreflight: s.lastPreflight,
          resolvedIdentity: s.resolvedIdentity,
          sourceTimestamps: s.sourceTimestamps,
          fixtureDigests: s.fixtureDigests,
          manifestDigest: s.manifestDigest,
          schemaDigest: s.schemaDigest,
          steps: s.steps,
          validationErrors: s.validationErrors,
        })),
      }
    : null;
  const report = {
    reportVersion: "1.0.0",
    registryVersion: registry.registryVersion,
    reviewedAt: registry.reviewedAt,
    generatedAt: liveRecord ? liveRecord.invocationTime : registry.reviewedAt,
    mode: liveRecord ? "live" : "offline",
    livePreflight: livePreflightTextFor(evaluation, liveRecord),
    liveRun,
    cameraCapability: CAMERA_CAPABILITY_STATEMENT,
    pendingItems: pendingItemsFor(evaluation, liveRecord),
    counts,
    registryDigest: evaluation.registryDigest,
    sources: evaluation.results,
    ok: evaluation.ok,
    errors: evaluation.errors,
    notes: reportNotesFor(evaluation, liveRecord),
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
  lines.push(
    report.mode === "live"
      ? `- Mode: live (generated ${report.generatedAt}; the live run's invocation time)`
      : `- Mode: offline (generated ${report.generatedAt}; no wall-clock time is recorded)`,
  );
  lines.push(`- Registry digest: \`${report.registryDigest}\``);
  lines.push(`- Result: ${report.ok ? `PASS (${report.mode} subset)` : "FAIL"}`);
  lines.push("");
  lines.push("## Live preflight");
  lines.push("");
  lines.push(report.livePreflight);
  if (report.liveRun) {
    lines.push("");
    for (const source of report.liveRun.sources) {
      lines.push(`- ${source.id}: ${source.outcome} — ${source.reason}`);
      if (source.resolvedIdentity) {
        const identity = source.resolvedIdentity;
        const parts = [
          identity.service,
          identity.item,
          identity.layer,
          identity.layerId !== null && identity.layerId !== undefined
            ? `layer ${identity.layerId}`
            : null,
        ].filter(Boolean);
        lines.push(`  - Identity: ${parts.join(" / ")}`);
      }
      if (source.sourceTimestamps && Object.keys(source.sourceTimestamps).length > 0) {
        lines.push(
          `  - Source timestamps: ${Object.entries(source.sourceTimestamps)
            .map(([k, v]) => `${k}=${v ?? "—"}`)
            .join(", ")}`,
        );
      }
      if (source.fixtureDigests) {
        for (const [name, info] of Object.entries(source.fixtureDigests)) {
          lines.push(`  - Fixture ${name}: sha256 \`${info.sha256}\` (${info.bytes} bytes)`);
        }
      }
      for (const step of source.steps) {
        lines.push(
          `  - Step ${step.step} (${step.purpose}): HTTP ${step.status}, ${step.bytes} bytes, sha256 \`${step.sha256}\`, ${step.elapsedMs} ms, ${step.redirects} redirect(s), ${step.retries} retr(ies)`,
        );
      }
    }
  }
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
  for (const note of report.notes) {
    lines.push(note);
  }
  lines.push("");
  return lines.join("\n");
}

function printUsage() {
  console.error("Usage:");
  console.error("  node src/preflight.mjs validate");
  console.error("  node src/preflight.mjs preflight [--offline]");
  console.error("  node src/preflight.mjs preflight --live --out <dir> --authorization \"<reference>\"");
  console.error("  node src/preflight.mjs report --out <dir> [--live-record <path>]");
}

async function main() {
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
      const outIndex = rest.indexOf("--out");
      const authIndex = rest.indexOf("--authorization");
      const outDir = outIndex >= 0 ? rest[outIndex + 1] : undefined;
      const authorization = authIndex >= 0 ? rest[authIndex + 1] : undefined;
      if (!authorization) {
        console.error(
          "LIVE PREFLIGHT REFUSED: a live preflight requires Jason's separate authorization. " +
            "Pass it as --authorization \"<reference>\" (who authorized it, when, and for what). " +
            "Without the reference the run is refused.",
        );
        process.exit(2);
      }
      if (!outDir) {
        console.error(
          "LIVE PREFLIGHT REFUSED: live output goes only to a caller-supplied --out <dir>.",
        );
        process.exit(2);
      }
      const { runLivePreflight } = await import("./livePreflight.mjs");
      const { record, ok } = await runLivePreflight({
        outDir: path.resolve(outDir),
        authorization,
      });
      for (const source of record.sources) {
        console.log(`${source.id}: ${source.outcome} — ${source.reason}`);
      }
      console.log(
        `live preflight ${ok ? "OK" : "BLOCKED"}: ${record.accepted} accepted, ${record.blocked} blocked; invocation ${record.invocationTime}`,
      );
      console.log(
        `live record written: ${path.join(path.resolve(outDir), "live-record.json")}`,
      );
      console.log(
        "Next: review the output directory, then promote the reviewed fixtures (see the runbook).",
      );
      process.exit(ok ? 0 : 1);
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
    const recordIndex = rest.indexOf("--live-record");
    const recordPath = recordIndex >= 0 ? rest[recordIndex + 1] : undefined;
    let liveRecord = null;
    if (recordPath) {
      try {
        liveRecord = loadJson(path.resolve(recordPath));
      } catch (error) {
        console.error(`live record unreadable: ${error.message}`);
        process.exit(2);
      }
    }
    let built;
    try {
      built = buildReport(R0_DIR, path.resolve(outDir), liveRecord);
    } catch (error) {
      console.error(`report FAILED: ${error.message}`);
      process.exit(1);
    }
    const { jsonPath, mdPath, report } = built;
    console.log(`acceptance report written: ${jsonPath}`);
    console.log(`acceptance report written: ${mdPath}`);
    console.log(
      `result: ${report.ok ? `PASS (${report.mode} subset)` : "FAIL"} — ${report.counts.sources} sources, ${report.counts.accepted} accepted, ${report.counts.disabled} disabled, ${report.counts.blocked} blocked`,
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
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
