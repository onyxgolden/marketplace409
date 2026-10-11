/**
 * battery.mjs — frozen 1,000-ticket battery runner.
 * Modes:
 *   validation: run every ticket through plan validation only (execute:false);
 *     tickets needing execution are marked deferred, not compared.
 *   full: end-to-end, including OS-isolated execution for needs_execution
 *     tickets. This is the mode behind the acceptance gates.
 * Writes machine-readable results.json + summary.json into the output dir.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runTask } from "./evaluator.mjs";
import { buildTrustedConfig } from "./corpus.mjs";
import { lowerBudgets, BudgetTracker } from "./budget.mjs";
import { BUDGETS } from "./constants.mjs";

function normalizeResult(r) {
  return {
    status: r.status,
    reason_codes: [...r.reason_codes].sort(),
    proposal_sha256: r.proposal_sha256,
  };
}

function mergeTrusted(base, overrides) {
  if (!overrides) return base;
  const out = { ...base };
  if (overrides.budgets) out.budgets = lowerBudgets(base.budgets && Object.keys(base.budgets).length ? base.budgets : BUDGETS, overrides.budgets);
  if (overrides.allowed_profile_ids) out.allowed_profile_ids = overrides.allowed_profile_ids;
  return out;
}

export async function runBattery({ corpusDir, mode = "validation", outDir, limit = null, onlyClass = null, onlyNamed = false }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, "manifest.json"), "utf8"));
  const ticketsDoc = JSON.parse(fs.readFileSync(path.join(corpusDir, "tickets.json"), "utf8"));
  fs.mkdirSync(outDir, { recursive: true });

  // Battery-level canary: file outside every sandbox, hashed before/after.
  const batteryCanary = path.join(outDir, "battery-canary.txt");
  fs.writeFileSync(batteryCanary, `pa2-battery-canary ${Date.now()}\n`, "utf8");
  const canaryBefore = createHash("sha256").update(fs.readFileSync(batteryCanary)).digest("hex");

  let tickets = ticketsDoc.tickets;
  if (onlyClass) tickets = tickets.filter((t) => t.class === onlyClass);
  if (onlyNamed) tickets = tickets.filter((t) => t.name);
  if (limit) tickets = tickets.slice(0, limit);

  const corpus = {
    reposRoot: path.join(corpusDir, "repos"),
    manifest,
    oracleDir: path.resolve(path.join(corpusDir, "..", "..", "oracles")),
  };
  // oracleDir resolves from the repo layout: <proto>/oracles. corpusDir is
  // external; find oracles relative to this module instead.
  const { fileURLToPath } = await import("node:url");
  corpus.oracleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "oracles");

  const results = [];
  const started = Date.now();
  let i = 0;
  for (const ticket of tickets) {
    i++;
    const t0 = Date.now();
    const trusted = mergeTrusted(
      buildTrustedConfig(manifest, { output_root: path.join(outDir, "runs") }),
      ticket.trusted_overrides,
    );
    const execute = mode === "full" && ticket.needs_execution;
    let result;
    try {
      result = await runTask({
        taskJson: ticket.task,
        trusted,
        corpus,
        expectations: ticket.expectations,
        execute,
        runId: `${ticket.ticket_id}`,
      });
    } catch (e) {
      result = { status: "RUNNER_ERROR", reason_codes: [], error: String(e && e.message || e) };
    }
    const rec = {
      ticket_id: ticket.ticket_id,
      name: ticket.name,
      class: ticket.class,
      expected_status: execute || !ticket.needs_execution ? ticket.expected_status : "DEFERRED",
      expected_reasons: ticket.expected_reasons,
      actual_status: result.status,
      actual_reasons: result.reason_codes || [],
      isolation_status: result.verification ? result.verification.isolation_status : null,
      duration_ms: Date.now() - t0,
      deferred: !execute && ticket.needs_execution,
      match: null,
    };
    if (!rec.deferred) {
      rec.match =
        rec.actual_status === rec.expected_status &&
        ticket.expected_reasons.every((r) => (result.reason_codes || []).includes(r));
    }
    // Replay determinism: run twice, compare normalized results.
    if (ticket.replay_twice && mode === "full") {
      const again = await runTask({
        taskJson: ticket.task, trusted, corpus,
        expectations: ticket.expectations, execute: true, runId: `${ticket.ticket_id}-r2`,
      });
      const a = normalizeResult(result);
      const b = normalizeResult(again);
      rec.replay_deterministic =
        a.status === b.status &&
        JSON.stringify(a.reason_codes) === JSON.stringify(b.reason_codes) &&
        a.proposal_sha256 === b.proposal_sha256;
      if (!rec.replay_deterministic) rec.match = false;
    }
    results.push(rec);
    if (i % 50 === 0 || i === tickets.length) {
      process.stderr.write(`battery: ${i}/${tickets.length}\r`);
    }
  }
  process.stderr.write("\n");

  const canaryAfter = createHash("sha256").update(fs.readFileSync(batteryCanary)).digest("hex");
  // Leftover disposable dirs must not survive.
  const tmpLeftovers = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("pa2-eval-") || d.startsWith("pa2-run-"));

  const compared = results.filter((r) => !r.deferred);
  const summary = {
    mode,
    corpus_sha256: manifest.corpus_sha256,
    tickets_total: tickets.length,
    compared: compared.length,
    deferred: results.length - compared.length,
    matched: compared.filter((r) => r.match).length,
    mismatched: compared.filter((r) => !r.match).length,
    by_class: {},
    battery_canary_unchanged: canaryBefore === canaryAfter,
    tmp_leftovers: tmpLeftovers,
    wall_ms: Date.now() - started,
  };
  for (const r of compared) {
    const c = (summary.by_class[r.class] = summary.by_class[r.class] || { total: 0, matched: 0 });
    c.total++;
    if (r.match) c.matched++;
  }
  const mismatches = compared.filter((r) => !r.match).map((r) => ({
    ticket_id: r.ticket_id,
    name: r.name,
    class: r.class,
    expected: r.expected_status,
    actual: r.actual_status,
    expected_reasons: r.expected_reasons,
    actual_reasons: r.actual_reasons,
  }));

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ meta: summary, tickets: results }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ...summary, mismatches }, null, 2) + "\n", "utf8");
  return { summary, mismatches, outDir };
}
