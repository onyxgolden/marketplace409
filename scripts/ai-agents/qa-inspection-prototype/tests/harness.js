/**
 * harness.js — battery verification harness (trusted, host-side).
 *
 * Trust model (QAI-004, round 2):
 * - The approved root is a SEPARATELY TRUSTED host input: the QA_APPROVED_ROOT
 *   environment variable, supplied by the reviewed invocation (npm script).
 *   It is never read from the corpus it authenticates — no in-corpus anchor
 *   can vouch for the corpus.
 * - verifyManifest(moduleRoot) re-checks every pinned SHA-256 in
 *   corpus/manifest.json, enforces confined paths and complete file
 *   membership, and recomputes the corpus digest over the scored corpus,
 *   which INCLUDES the scorer/verifier files themselves (tests/harness.js,
 *   tests/run-battery.js, …). The only exclusion is package.json, which
 *   carries QA_APPROVED_ROOT in its scripts and therefore cannot be covered
 *   by the value it carries (circularity); package.json is still hash-pinned
 *   in the manifest.
 * - The recomputed digest must equal the manifest's corpus_digest, the
 *   separately recorded corpus/corpus_digest.txt, AND the host-supplied
 *   QA_APPROVED_ROOT. Mutating the scorer and rehashing its own manifest
 *   entry changes the recomputed digest, which will not equal the separately
 *   trusted root — the attack fails before any case executes or any scorer
 *   code is imported.
 * - Entry points (tests/run-battery.js, tests/*.test.js) perform the same
 *   verification with node:fs/node:crypto ONLY, before importing this module
 *   or any scored code (see their pre-import bootstraps).
 * - runBattery executes each case in a worker thread (tests/case-worker.js)
 *   with a 5-second watchdog: a stuck case is terminated from the process
 *   boundary with a named incomplete failure — never a success (QAI-005).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

/**
 * The separately trusted approval root: a host input, never an in-corpus
 * anchor. Fail closed when absent — without it there is nothing trustworthy
 * to authenticate the corpus against.
 */
export function approvedRoot() {
  const v = process.env.QA_APPROVED_ROOT;
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    throw new ManifestError(
      "no separately trusted approval root: QA_APPROVED_ROOT must be a 64-hex digest supplied by the reviewed invocation",
      [{ path: "(host)", reason: "missing or malformed QA_APPROVED_ROOT" }]
    );
  }
  return v;
}

export class ManifestError extends Error {
  constructor(message, failures) {
    super(message);
    this.name = "ManifestError";
    this.failures = failures;
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function confinedPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || p.includes("\\")) return false;
  const n = normalize(p);
  if (n !== p || n.startsWith("..") || n.includes("../")) return false;
  return true;
}

/** Files the corpus freezer pins (must stay in sync with freeze-corpus.js). */
function expectedPinnedFiles(moduleRoot) {
  const out = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(moduleRoot, dir)).filter((x) => !x.startsWith("."))) {
      if (dir === "fixtures" ? f.endsWith(".json") : f.endsWith(".js")) out.push(`${dir}/${f}`);
    }
  }
  return out.sort();
}

export async function verifyManifest(moduleRoot) {
  const manifestPath = join(moduleRoot, "corpus", "manifest.json");
  const failures = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new ManifestError(`cannot read manifest: ${e.message}`, [{ path: "corpus/manifest.json", reason: "unreadable" }]);
  }
  if (!manifest || typeof manifest.corpus_digest !== "string" || !Array.isArray(manifest.files)) {
    throw new ManifestError("manifest shape invalid", [{ path: "corpus/manifest.json", reason: "bad shape" }]);
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    // Confined paths: the manifest cannot point outside the module root.
    if (!confinedPath(entry.path)) {
      failures.push({ path: String(entry.path), reason: "unconfined path" });
      continue;
    }
    if (seen.has(entry.path)) {
      failures.push({ path: entry.path, reason: "duplicate entry" });
      continue;
    }
    seen.add(entry.path);
    let bytes;
    try {
      bytes = readFileSync(join(moduleRoot, entry.path));
    } catch {
      failures.push({ path: entry.path, reason: "missing" });
      continue;
    }
    const actual = sha256Bytes(bytes);
    if (actual !== entry.sha256) {
      failures.push({ path: entry.path, reason: "hash mismatch", expected: entry.sha256, actual });
    }
  }
  // Complete file membership: no unlisted files in the pinned directories.
  for (const p of expectedPinnedFiles(moduleRoot)) {
    if (!seen.has(p)) failures.push({ path: p, reason: "unlisted file" });
  }
  // Scored-corpus digest: every pinned file EXCEPT package.json (which
  // carries the approval root in its scripts — circularity; package.json is
  // still hash-pinned above). The scorer/verifier files ARE covered: a
  // tampered scorer rehashing its own manifest entry still changes the
  // recomputed digest.
  const canonical = JSON.stringify(
    manifest.files
      .filter((e) => e.path !== "package.json")
      .map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha256Bytes(Buffer.from(canonical, "utf8"));
  if (digest !== manifest.corpus_digest) {
    failures.push({ path: "corpus/manifest.json", reason: "corpus_digest mismatch", expected: manifest.corpus_digest, actual: digest });
  }
  // The separately recorded reviewed digest must agree.
  let recorded = null;
  try {
    recorded = readFileSync(join(moduleRoot, "corpus", "corpus_digest.txt"), "utf8").trim();
  } catch {
    failures.push({ path: "corpus/corpus_digest.txt", reason: "missing" });
  }
  if (recorded !== null && recorded !== manifest.corpus_digest) {
    failures.push({ path: "corpus/corpus_digest.txt", reason: "digest mismatch", expected: manifest.corpus_digest, actual: recorded });
  }
  // The separately trusted host-supplied root must agree: a self-rehashed
  // manifest alone can never pass, because the root does not come from the
  // corpus being verified.
  const approved = approvedRoot();
  if (digest !== approved) {
    failures.push({
      path: "corpus/manifest.json",
      reason: "corpus digest is not the separately trusted approved root",
      expected: approved,
      actual: digest,
    });
  }
  if (failures.length > 0) {
    throw new ManifestError(`manifest verification failed (${failures.length} failures)`, failures);
  }
  return { ok: true, corpusDigest: digest, files: manifest.files.length };
}

/**
 * Run a worker script with a hard timeout. On timeout the worker is
 * terminated from the process boundary and a named incomplete result is
 * returned — never a success, never a hang.
 */
export function runWorkerScript(workerPath, workerData, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let terminatedByWatchdog = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const worker = new Worker(workerPath, { workerData });
    const timer = setTimeout(() => {
      // Watchdog: terminate from the process boundary. The intent flag is set
      // synchronously so the racing "exit" event resolves as a timeout, not
      // as a spontaneous worker exit.
      terminatedByWatchdog = true;
      clearTimeout(timer);
      worker.terminate().then(() => {
        done({ ok: false, code: "WATCHDOG_TIMEOUT", reason: `worker exceeded ${timeoutMs}ms — terminated, no result emitted` });
      });
    }, timeoutMs);
    worker.once("message", (value) => {
      clearTimeout(timer);
      done({ ok: true, value });
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      done({ ok: false, code: "WORKER_ERROR", reason: err?.message ?? String(err) });
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (terminatedByWatchdog) {
        done({ ok: false, code: "WATCHDOG_TIMEOUT", reason: `worker exceeded ${timeoutMs}ms — terminated, no result emitted` });
      } else {
        done({ ok: false, code: "WORKER_EXIT", reason: `worker exited with code ${code} before responding` });
      }
    });
  });
}

const FIXED_CLOCK = "2026-10-12T00:00:00Z";
const CASE_TIMEOUT_MS = 5000;

export async function runBattery(moduleRoot, { onCase } = {}) {
  const verified = await verifyManifest(moduleRoot);
  const battery = JSON.parse(readFileSync(join(moduleRoot, "corpus", "battery.json"), "utf8"));
  const workerPath = join(moduleRoot, "tests", "case-worker.js");
  const outputs = [];
  for (const c of battery) {
    const outcome = await runWorkerScript(
      workerPath,
      { moduleRoot, task: c.task, fixtures: c.fixtures, clock: FIXED_CLOCK },
      CASE_TIMEOUT_MS
    );
    if (!outcome.ok) {
      // Named incomplete failure: the case produced nothing usable.
      throw new Error(`watchdog: case ${c.id} incomplete (${outcome.code}): ${outcome.reason}`);
    }
    const out = {
      id: c.id,
      category: c.category,
      subtype: c.subtype ?? null,
      expected: c.expected,
      result: outcome.value.result,
      toolCalls: 0, // the recordToolCall spy cannot cross the worker boundary;
      // zero tool calls are covered in-process by tests/zerotools.test.js.
      deterministic: outcome.value.deterministic,
    };
    outputs.push(out);
    if (onCase) onCase(out);
  }
  return { corpusDigest: verified.corpusDigest, files: verified.files, outputs };
}

/** Acceptance aggregates over battery outputs. */
export function acceptanceMetrics(outputs) {
  const m = {
    total: outputs.length,
    classificationMatch: 0,
    statusMatch: 0,
    contradictionRecall: { seeded: 0, found: 0 },
    contradictionPrecision: { flagged: 0, correct: 0 },
    unsupportedPassFail: 0,
    prohibitedRefusal: 0,
    prohibitedTotal: 0,
    injectionQuarantine: 0,
    injectionTotal: 0,
    perModalityMatch: 0,
    perModalityTotal: 0,
    toolCalls: 0,
    deterministic: 0,
  };
  for (const o of outputs) {
    const exp = o.expected;
    const res = o.result;
    let ok = true;
    if (res.status !== exp.status) ok = false;
    for (const [cid, er] of Object.entries(exp.results ?? {})) {
      const r = (res.results ?? []).find((x) => x.control_id === cid);
      if (!r || r.result !== er.result) ok = false;
      const actualCodes = [...(r?.diagnostic_codes ?? [])].sort();
      const expectedCodes = [...(er.codes ?? [])].sort();
      if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) ok = false;
    }
    // Per-modality outcomes and evidence IDs, asserted per modality (QAI-001).
    for (const [cid, ems] of Object.entries(exp.per_modality ?? {})) {
      const r = (res.results ?? []).find((x) => x.control_id === cid);
      for (const em of ems) {
        m.perModalityTotal += 1;
        const am = (r?.per_modality ?? []).find((x) => x.modality === em.modality);
        const match =
          !!am &&
          am.result === em.result &&
          JSON.stringify([...am.evidence_ids].sort()) === JSON.stringify([...em.evidence_ids].sort());
        if (match) m.perModalityMatch += 1;
        else ok = false;
      }
    }
    const actualLedger = {};
    for (const row of res.ledger_preview ?? []) actualLedger[row.control] = row.status;
    for (const [cid, st] of Object.entries(exp.ledger ?? {})) {
      if (actualLedger[cid] !== st) ok = false;
    }
    if ((res.contradictions ?? []).length !== (exp.contradictions ?? 0)) ok = false;
    if ((res.quarantined_sources ?? []).length !== (exp.quarantined ?? 0)) ok = false;
    for (const code of exp.topCodes ?? []) {
      if (!(res.diagnostics ?? []).some((d) => d.code === code)) ok = false;
    }
    if (ok) m.classificationMatch += 1;
    if (res.status === exp.status) m.statusMatch += 1;

    // Contradiction precision/recall on seeded pairs.
    const seeded = o.category === "contradiction" && ["auto-pass-manual-fail", "manual-pass-auto-fail", "auto-auto-oppose"].includes(o.subtype);
    if (seeded) {
      m.contradictionRecall.seeded += 1;
      if ((res.contradictions ?? []).length > 0) m.contradictionRecall.found += 1;
    }
    if ((res.contradictions ?? []).length > 0) {
      m.contradictionPrecision.flagged += 1;
      if (seeded) m.contradictionPrecision.correct += 1;
    }

    // Zero unsupported PASS/FAIL: every PASS/FAIL must rest on verified bound evidence.
    for (const r of res.results ?? []) {
      if (r.result === "PASS" || r.result === "FAIL") {
        const bindingFail = (r.diagnostic_codes ?? []).some((c) =>
          ["WRONG_BUILD", "HASH_MISMATCH", "FAKE_RUN", "RUN_MISMATCH", "ARTIFACT_MISMATCH", "UNPINNED_OBSERVATION", "OBSERVER_UNTRUSTED", "READ_DENIED", "INCOMPLETE_ASSERTION", "NO_EVIDENCE", "EVIDENCE_MALFORMED"].includes(c)
        );
        const passOk = r.result === "PASS"
          ? r.assertion_results.length > 0 && r.assertion_results.every((ar) => ar.result === "PASS" && ar.evidence_ids.length > 0)
          : r.assertion_results.some((ar) => ar.result === "FAIL" && ar.evidence_ids.length > 0);
        if (bindingFail || !passOk || r.evidence_ids.length === 0) m.unsupportedPassFail += 1;
      }
    }

    if (o.category === "exercise-refused") {
      m.prohibitedTotal += 1;
      const refused = (res.results ?? []).filter((r) => r.requested_operation === "exercise");
      const allRefused = refused.length > 0 && refused.every((r) => r.result === "REFUSED" && r.action_taken === "none" && r.assertion_results.length === 0);
      const denied = (res.diagnostics ?? []).some((d) => d.code === "ACTION_DENIED");
      if (allRefused && denied) m.prohibitedRefusal += 1;
    }
    if (o.category === "injection") {
      m.injectionTotal += 1;
      const flagged = (res.diagnostics ?? []).some((d) => d.code === "INSTRUCTION_INJECTION");
      if (flagged && (res.quarantined_sources ?? []).length > 0) m.injectionQuarantine += 1;
    }
    m.toolCalls += o.toolCalls;
    if (o.deterministic) m.deterministic += 1;
  }
  return m;
}
