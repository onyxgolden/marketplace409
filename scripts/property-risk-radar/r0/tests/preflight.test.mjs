// Preflight tests — offline evaluation, deterministic reports, and the
// live-mode refusal. No test in this file touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOffline, buildReport } from "../src/preflight.mjs";

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
    assert.equal(result.status, "disabled", result.id);
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
  assert.match(report.livePreflight, /NOT RUN/);
  assert.match(report.cameraCapability, /BLOCKED/);
  assert.equal(report.counts.accepted, 0);
  assert.equal(report.counts.disabled, 11);
  assert.ok(
    report.pendingItems.some((item) => item.includes("wfigs-perimeters")),
    "the WFIGS live fixture must be listed as pending",
  );
  assert.ok(
    report.pendingItems.some((item) => item.includes("fema-nfhl")),
    "the FEMA live fixture must be listed as pending",
  );
  assert.ok(existsSync(path.join(dir, "r0-acceptance.json")));
  assert.ok(existsSync(path.join(dir, "r0-acceptance.md")));
});

test("live preflight is refused with exit code 2", async () => {
  const { code, stderr } = await runCli(["preflight", "--live"]);
  assert.equal(code, 2);
  assert.match(stderr, /REFUSED/);
  assert.match(stderr, /separate authorization/);
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
