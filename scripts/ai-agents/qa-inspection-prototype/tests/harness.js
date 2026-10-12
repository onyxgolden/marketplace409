/**
 * harness.js — battery verification harness (trusted, host-side).
 *
 * verifyManifest(moduleRoot): re-checks every pinned SHA-256 in
 * corpus/manifest.json and recomputes the corpus digest. Any mismatch stops
 * the run BEFORE any case executes or any scored code runs.
 *
 * runBattery(moduleRoot): verifies the manifest, then dynamically imports
 * the scored modules from that root and executes all 200 frozen cases with a
 * fixed clock and an instrumented context. Returns per-case outputs plus
 * aggregate acceptance metrics.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export class ManifestError extends Error {
  constructor(message, failures) {
    super(message);
    this.name = "ManifestError";
    this.failures = failures;
  }
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
  for (const entry of manifest.files) {
    let bytes;
    try {
      bytes = readFileSync(join(moduleRoot, entry.path));
    } catch {
      failures.push({ path: entry.path, reason: "missing" });
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.sha256) {
      failures.push({ path: entry.path, reason: "hash mismatch", expected: entry.sha256, actual });
    }
  }
  const canonical = JSON.stringify(
    manifest.files.map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (digest !== manifest.corpus_digest) {
    failures.push({ path: "corpus/manifest.json", reason: "corpus_digest mismatch", expected: manifest.corpus_digest, actual: digest });
  }
  if (failures.length > 0) {
    throw new ManifestError(`manifest verification failed (${failures.length} failures)`, failures);
  }
  return { ok: true, corpusDigest: digest, files: manifest.files.length };
}

const FIXED_CLOCK = "2026-10-12T00:00:00Z";

export async function runBattery(moduleRoot, { onCase } = {}) {
  const verified = await verifyManifest(moduleRoot);
  const mod = await import(pathToFileURL(join(moduleRoot, "src", "index.js")).href);
  const battery = JSON.parse(readFileSync(join(moduleRoot, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const toolCalls = [];
    const context = {
      clock: FIXED_CLOCK,
      resolver: new mod.FixtureResolver(c.fixtures),
      recordToolCall: (...args) => toolCalls.push(args),
    };
    const started = Date.now();
    const result = mod.run(c.task, context);
    const elapsedMs = Date.now() - started;
    if (elapsedMs > 5000) {
      throw new Error(`watchdog: case ${c.id} exceeded 5s`);
    }
    // Repeat run: byte-identical under the fixed context.
    const again = mod.run(c.task, {
      clock: FIXED_CLOCK,
      resolver: new mod.FixtureResolver(c.fixtures),
      recordToolCall: () => {},
    });
    const out = {
      id: c.id,
      category: c.category,
      subtype: c.subtype ?? null,
      expected: c.expected,
      result,
      toolCalls: toolCalls.length,
      deterministic: mod.canonicalJson(result) === mod.canonicalJson(again),
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
          ["WRONG_BUILD", "HASH_MISMATCH", "FAKE_RUN", "READ_DENIED", "INCOMPLETE_ASSERTION", "NO_EVIDENCE", "EVIDENCE_MALFORMED"].includes(c)
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
