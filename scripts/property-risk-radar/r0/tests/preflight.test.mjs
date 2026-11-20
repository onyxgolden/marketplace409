// Preflight tests — offline evaluation, deterministic reports, the live
// runner (fake fetch only), and the live-mode refusal. No test in this
// file touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOffline, buildReport } from "../src/preflight.mjs";
import { runLivePreflight } from "../src/livePreflight.mjs";
import { computeSchemaDigest } from "../src/validateRegistry.mjs";
import { digestObject } from "../src/schemaDigest.mjs";
import { ADAPTERS } from "../src/preflight.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R0 = path.resolve(__dirname, "..");

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(R0, "src", "preflight.mjs"), ...args],
      { cwd: R0 },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}

test("offline evaluation passes for all 11 sources with zero live calls", () => {
  const evaluation = evaluateOffline(R0);
  assert.equal(evaluation.ok, true);
  assert.deepEqual(evaluation.errors, []);
  assert.equal(evaluation.results.length, 11);
  for (const result of evaluation.results) {
    if (result.category === "camera") {
      assert.equal(result.status, "disabled", result.id);
    } else if (result.status === "accepted") {
      assert.ok(
        typeof result.lastPreflight === "string" && result.lastPreflight.length > 0,
        `${result.id} must carry a lastPreflight record`,
      );
    } else {
      // A blocked data adapter (FEMA: NFHL endpoint unreachable) carries
      // no successful preflight record.
      assert.equal(result.status, "blocked", result.id);
      assert.equal(result.lastPreflight, null, result.id);
    }
    assert.ok(
      result.checks.includes("schema-digest-ok"),
      `${result.id} must verify its schema digest`,
    );
  }
});

test("the acceptance report is byte-identical across repeated runs", () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "r0-report-a-"));
  const dirB = mkdtempSync(path.join(tmpdir(), "r0-report-b-"));
  const first = buildReport(R0, dirA);
  const second = buildReport(R0, dirB);
  assert.equal(
    readFileSync(first.jsonPath, "utf8"),
    readFileSync(second.jsonPath, "utf8"),
    "r0-acceptance.json must be byte-identical",
  );
  assert.equal(
    readFileSync(first.mdPath, "utf8"),
    readFileSync(second.mdPath, "utf8"),
    "r0-acceptance.md must be byte-identical",
  );
});

test("the report states the offline limits honestly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-report-"));
  const { report } = buildReport(R0, dir);
  assert.equal(report.mode, "offline");
  assert.equal(report.liveRun, null);
  assert.match(report.livePreflight, /Last live preflight/);
  assert.match(report.cameraCapability, /BLOCKED/);
  assert.equal(report.counts.accepted, 5);
  assert.equal(report.counts.disabled, 5);
  assert.equal(report.counts.blocked, 1);
  assert.ok(
    report.pendingItems.some((item) => item.includes("Camera capability")),
    "the camera capability must still be listed as pending",
  );
  assert.ok(
    report.pendingItems.some(
      (item) => item.includes("fema-nfhl") && item.includes("blocked"),
    ),
    "the FEMA block must be listed as a live-preflight follow-up",
  );
  assert.ok(
    !report.pendingItems.some((item) => item.includes("wfigs-perimeters")),
    "the WFIGS live fixture is no longer pending",
  );
  assert.ok(existsSync(path.join(dir, "r0-acceptance.json")));
  assert.ok(existsSync(path.join(dir, "r0-acceptance.md")));
});

test("the report with a live record requires the registry to agree with the run", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-report-live-"));
  const stale = {
    recordVersion: "1.0.0",
    invocationTime: "2026-11-20T00:00:00.000Z",
    authorization: "test",
    sources: [
      {
        id: "wfigs-perimeters",
        outcome: "blocked",
        reason: "test block",
        lastPreflight: null,
        resolvedIdentity: null,
        sourceTimestamps: {},
        fixtureDigests: null,
        manifestDigest: null,
        schemaDigest: null,
        steps: [],
        validationErrors: [],
      },
    ],
    accepted: 0,
    blocked: 1,
  };
  assert.throws(
    () => buildReport(R0, dir, stale),
    /promote the reviewed fixtures first/,
  );
});

test("live preflight is refused with exit code 2", async () => {
  const { code, stderr } = await runCli(["preflight", "--live"]);
  assert.equal(code, 2);
  assert.match(stderr, /REFUSED/);
  assert.match(stderr, /separate authorization/);
});

test("live preflight with authorization but no --out is refused", async () => {
  const { code, stderr } = await runCli([
    "preflight",
    "--live",
    "--authorization",
    "test reference",
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--out/);
});

test("live preflight without --authorization is refused even with --out", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-refused-"));
  const { code, stderr } = await runCli(["preflight", "--live", "--out", dir]);
  assert.equal(code, 2);
  assert.match(stderr, /REFUSED/);
  assert.match(stderr, /--authorization/);
});

// Fake fetch for the live runner: real Response objects carrying the
// committed fixtures as bodies. No network is touched.
function fakeFetch(map) {
  return async (url) => {
    const entry = map[url];
    if (!entry) {
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(entry.body, {
      status: entry.status ?? 200,
      headers: { "content-type": entry.contentType ?? "application/json" },
    });
  };
}

function loadFixtureText(id, name) {
  return readFileSync(path.join(R0, "fixtures", id, name), "utf8");
}

test("live runner accepts WFIGS on fake metadata + sample and writes a verifiable manifest", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-wfigs-"));
  const adapter = ADAPTERS["wfigs-perimeters"];
  const map = {
    [adapter.CONTRACT.endpoints.metadataUrlTemplate]: {
      body: loadFixtureText("wfigs-perimeters", "metadata.json"),
    },
    [adapter.CONTRACT.endpoints.sampleUrlTemplate]: {
      body: loadFixtureText("wfigs-perimeters", "sample.json"),
    },
  };
  const { record, ok } = await runLivePreflight({
    outDir: dir,
    authorization: "test authorization (fake fetch)",
    fetchImpl: fakeFetch(map),
    adapterIds: ["wfigs-perimeters"],
    now: new Date("2026-11-20T18:00:00.000Z"),
  });
  assert.equal(ok, true);
  assert.equal(record.accepted, 1);
  const source = record.sources[0];
  assert.equal(source.outcome, "accepted");
  assert.equal(source.lastPreflight, "2026-11-20T18:00:00.000Z");
  assert.equal(source.liveFixtureStatus, "live");
  assert.equal(source.fixtureKind, "live");
  assert.equal(source.steps.length, 2);
  const sample = JSON.parse(
    readFileSync(path.join(dir, "fixtures", "wfigs-perimeters", "sample.json"), "utf8"),
  );
  assert.equal(sample.synthetic, false);
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "fixtures", "wfigs-perimeters", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.fixtureKind, "live");
  assert.equal(
    manifest.digest,
    digestObject({ files: manifest.files }),
    "manifest digest must verify",
  );
  assert.equal(
    source.schemaDigest,
    computeSchemaDigest(adapter.CONTRACT, manifest.digest),
    "schema digest must recompute from the contract + manifest",
  );
  const written = JSON.parse(readFileSync(path.join(dir, "live-record.json"), "utf8"));
  assert.equal(written.invocationTime, "2026-11-20T18:00:00.000Z");
  assert.equal(written.sources[0].outcome, "accepted");
});

test("live runner accepts NHC metadata carrying subLayerIds (not coordinates)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-nhc-"));
  const adapter = ADAPTERS["nhc-tropical"];
  const layers = {
    layers: [
      { id: 0, name: "Graphical Tropical Weather Outlook", subLayerIds: [1, 399] },
      { id: 6, name: "AT1 Forecast Points", subLayerIds: [] },
      { id: 7, name: "AT1 Forecast Track", subLayerIds: [] },
    ],
  };
  const metadata = {
    currentVersion: 11.1,
    serviceDescription: "NHC Tropical Weather (synthetic)",
    layers: layers.layers,
  };
  const plan = adapter.preflightPlan();
  const map = {
    [plan[0].urlTemplate]: { body: JSON.stringify(metadata) },
    [plan[1].urlTemplate]: { body: JSON.stringify(layers) },
    [plan[2].urlTemplate.replace("{layerId}", "6")]: {
      body: JSON.stringify({ synthetic: true, type: "FeatureCollection", features: [] }),
    },
  };
  const { record, ok } = await runLivePreflight({
    outDir: dir,
    authorization: "test authorization (fake fetch)",
    fetchImpl: fakeFetch(map),
    adapterIds: ["nhc-tropical"],
    now: new Date("2026-11-20T18:00:00.000Z"),
  });
  assert.equal(ok, true);
  assert.equal(record.sources[0].outcome, "accepted");
  assert.equal(record.sources[0].resolvedIdentity.layer, "AT1 Forecast Points");
  assert.equal(record.sources[0].resolvedIdentity.layerId, 6);
  assert.equal(record.sources[0].sourceTimestamps.features, 0);
});

test("live runner records FEMA as BLOCKED when the official page links no NFHL resource", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-fema-"));
  const map = {
    "https://www.fema.gov/flood-maps/national-flood-hazard-layer": {
      body: "<html><body>no NFHL link here</body></html>",
      contentType: "text/html",
    },
  };
  const { record, ok } = await runLivePreflight({
    outDir: dir,
    authorization: "test authorization (fake fetch)",
    fetchImpl: fakeFetch(map),
    adapterIds: ["fema-nfhl"],
    now: new Date("2026-11-20T18:00:00.000Z"),
  });
  assert.equal(ok, false);
  assert.equal(record.blocked, 1);
  assert.equal(record.sources[0].outcome, "blocked");
  assert.match(record.sources[0].reason, /does not link any official NFHL resource/);
  assert.equal(
    existsSync(path.join(dir, "fixtures", "fema-nfhl", "sample.json")),
    false,
    "a blocked source writes no fixture",
  );
});

test("live runner follows the FEMA link chain through the Map Service Center link", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-fema-msc-"));
  const adapter = ADAPTERS["fema-nfhl"];
  const map = {
    "https://www.fema.gov/flood-maps/national-flood-hazard-layer": {
      body: '<html><body><a href="https://msc.fema.gov/nfhl">NFHL</a></body></html>',
      contentType: "text/html",
    },
    [adapter.CONTRACT.endpoints.metadataUrlTemplate]: {
      body: loadFixtureText("fema-nfhl", "metadata.json"),
    },
    [adapter.CONTRACT.endpoints.sampleUrlTemplate]: {
      body: loadFixtureText("fema-nfhl", "sample.json"),
    },
  };
  const { record, ok } = await runLivePreflight({
    outDir: dir,
    authorization: "test authorization (fake fetch)",
    fetchImpl: fakeFetch(map),
    adapterIds: ["fema-nfhl"],
    now: new Date("2026-11-20T18:00:00.000Z"),
  });
  assert.equal(ok, true);
  assert.equal(record.sources[0].outcome, "accepted");
  assert.equal(record.sources[0].steps[0].linkTarget, "https://msc.fema.gov/nfhl");
  assert.equal(record.sources[0].resolvedIdentity.layerId, 28);
  assert.equal(record.sources[0].resolvedIdentity.layerCandidate, false);
});

test("live runner records a transport failure as a step error, not a throw", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-transport-"));
  const throwing = async () => {
    throw new Error("other side closed");
  };
  const { record, ok } = await runLivePreflight({
    outDir: dir,
    authorization: "test authorization (fake fetch)",
    fetchImpl: throwing,
    adapterIds: ["usgs-earthquakes"],
    now: new Date("2026-11-20T18:00:00.000Z"),
  });
  assert.equal(ok, false);
  assert.equal(record.sources[0].outcome, "blocked");
  assert.match(record.sources[0].reason, /transport error: other side closed/);
  assert.equal(record.sources[0].steps[0].status, 0);
  assert.match(record.sources[0].steps[0].error, /other side closed/);
});

test("live runner refuses to run without an authorization reference", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r0-live-noauth-"));
  await assert.rejects(
    runLivePreflight({ outDir: dir, authorization: "" }),
    /authorization/,
  );
  await assert.rejects(
    runLivePreflight({ outDir: dir, authorization: "   " }),
    /authorization/,
  );
});

test("report without --out is refused with exit code 2", async () => {
  const { code } = await runCli(["report"]);
  assert.equal(code, 2);
});

test("validate CLI exits 0 on the seed registry", async () => {
  const { code, stdout } = await runCli(["validate"]);
  assert.equal(code, 0);
  assert.match(stdout, /registry validation OK/);
});
