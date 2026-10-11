/**
 * oracle-lib-integrity.test.mjs — P1 regression: the corpus digest and the
 * evaluator's pre-execution integrity check must bind ALL executable oracle
 * code, including the shared oracles/_lib.mjs that every fixture oracle
 * imports. Mutating only the shared library must fail closed: no profile
 * executes, no READY result is possible.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildCorpus, buildTrustedConfig } from "../src/corpus.mjs";
import { runTask } from "../src/evaluator.mjs";
import { STATUS } from "../src/constants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, "..");
const INTACT_ORACLES = path.join(PROTO, "oracles");

let corpusDir;
let manifest;
let validTicket;

beforeAll(() => {
  corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), "pa2-libtest-corpus-"));
  const r = buildCorpus({ outDir: corpusDir, oracleDir: INTACT_ORACLES });
  manifest = r.manifest;
  const ticketsDoc = JSON.parse(fs.readFileSync(path.join(corpusDir, "tickets.json"), "utf8"));
  validTicket = ticketsDoc.tickets.find((t) => t.class === "valid" && t.needs_execution);
  expect(validTicket).toBeTruthy();
}, 60000);

function mutatedOracleDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa2-libtest-oracles-"));
  for (const f of fs.readdirSync(INTACT_ORACLES)) {
    fs.copyFileSync(path.join(INTACT_ORACLES, f), path.join(dir, f));
  }
  // Mutate ONLY the shared library: a byte change invisible to the
  // per-fixture oracle digests.
  fs.appendFileSync(path.join(dir, "_lib.mjs"), "\n// tampered: shared oracle library changed\n", "utf8");
  return dir;
}

describe("shared oracle library integrity (P1)", () => {
  it("the frozen manifest binds the exact _lib.mjs bytes", () => {
    const intact = fs.readFileSync(path.join(INTACT_ORACLES, "_lib.mjs"), "utf8");
    const digest = createHash("sha256").update(intact, "utf8").digest("hex");
    expect(manifest.oracle_lib.file).toBe("oracles/_lib.mjs");
    expect(manifest.oracle_lib.sha256).toBe(digest);
    // And the corpus digest covers the manifest that carries it.
    expect(manifest.corpus_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mutating only _lib.mjs fails closed: no profile executes, never READY", async () => {
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa2-libtest-out-"));
    const trusted = buildTrustedConfig(manifest, { output_root: outRoot });
    const corpus = {
      reposRoot: path.join(corpusDir, "repos"),
      manifest,
      oracleDir: mutatedOracleDir(),
    };
    const result = await runTask({
      taskJson: validTicket.task,
      trusted,
      corpus,
      expectations: validTicket.expectations,
      execute: true,
    });
    // Fail closed.
    expect(result.status).toBe(STATUS.FAILED_VERIFICATION);
    expect(result.status).not.toBe(STATUS.READY_FOR_REVIEW);
    // No profile executed: the integrity check threw before the isolation
    // gate and before any profile run.
    expect(result.verification.isolation_status).toBe("NOT_RUN");
    expect(result.verification.syntax.status).toBe("NOT_RUN");
    expect(result.verification.baseline_tests.status).toBe("NOT_RUN");
    expect(result.verification.candidate_tests.status).toBe("NOT_RUN");
    // The audit trail records the eval error (oracle-lib-digest-mismatch).
    const auditPath = result.audit_ref && result.audit_ref.path;
    expect(auditPath).toBeTruthy();
    const auditLog = fs.readFileSync(auditPath, "utf8");
    expect(auditLog).toMatch(/EVAL_ERROR/);
    expect(auditLog).toMatch(/oracle-lib-digest-mismatch/);
  }, 120000);
});
