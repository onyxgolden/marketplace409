/**
 * Project Manager battery runner (P2b-3).
 *
 * Runs every case in battery-manager/cases.js through the full inert runner
 * three times against ONE shared publisher with a fixed clock and
 * fixed source. For each case:
 * - the three runs' outcomes must agree;
 * - the published item (when COMPLETED) must be byte-identical
 *   across runs (canonical JSON over the published item);
 * - the oracle must accept the case's expectation.
 *
 * Post-steps (decision/trust/deadline proofs that are not runner
 * runs) run after the three runner runs; the runner invariant still
 * holds for the case.
 *
 * Usage: node battery-manager/run-battery.js [--only <id>...] [--json]
 * Exit 0 only when every selected case passes; prints a per-case
 * line and a final "N/N cases passed" summary. Case counts are
 * reported separately from test assertions.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";
import { Budget } from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { PLANNING_BUDGET_LIMITS } from "../src/planningBudget.js";
import { validateDecision } from "../../../../src/application/ai-lab/planning/decisionValidator.js";
import { createInvocationDeadline, runExecution } from "../../rental-ops-wiring/src/deadline.js";
import { CASES } from "./cases.js";
import { assertExpectation } from "./oracle.js";
import { createMemoryPublisher, runJob } from "../src/runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = join(HERE, "..");

const FIXED_CLOCK = { nowIso: () => "2026-10-26T12:00:00.000Z" };

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function hangingPublisher() {
  return {
    async publish() { return new Promise(() => {}); },
  };
}

async function runPostStep(name, { item, runs }) {
  switch (name) {
    case "span-cap-unit": {
      const budget = new Budget(PLANNING_BUDGET_LIMITS);
      for (let i = 0; i < 512; i++) budget.chargeEvidenceSpan();
      try {
        budget.chargeEvidenceSpan();
        return { refused: false };
      } catch (err) {
        return { refused: true, kind: err.kind, limit: err.limit, code: err.code };
      }
    }
    case "output-cap-unit": {
      const budget = new Budget(PLANNING_BUDGET_LIMITS);
      try {
        budget.chargeOutput(257, 1024);
        return { refused: false };
      } catch (err) {
        return { refused: true, kind: err.kind, limit: err.limit, code: err.code };
      }
    }
    case "republish-conflict": {
      // Same item identity, different report bytes/digest: the store
      // must refuse, never overwrite.
      const tampered = JSON.parse(canonicalJson(item));
      tampered.report = { ...tampered.report, status: "TAMPERED" };
      tampered.report_digest = "tampered-digest";
      const pub = createMemoryPublisher();
      await pub.publish(item);
      try {
        await pub.publish(tampered);
        return { refused: false };
      } catch (err) {
        return { refused: true, code: err.code };
      }
    }
    case "decide-stale": {
      try {
        validateDecision(item, {
          item_id: item.item_id, report_digest: "stale-digest", row_id: item.row_ids[0],
          actor: "operator", decision: "acknowledge", at: "2026-10-26T12:00:00.000Z", decision_id: "d-1",
        });
        return { refused: false };
      } catch (err) {
        return { refused: true, code: err.code };
      }
    }
    case "decide-unknown-row": {
      try {
        validateDecision(item, {
          item_id: item.item_id, report_digest: item.report_digest, row_id: "pm-unknown",
          actor: "operator", decision: "acknowledge", at: "2026-10-26T12:00:00.000Z", decision_id: "d-1",
        });
        return { refused: false };
      } catch (err) {
        return { refused: true, code: err.code };
      }
    }
    case "decide-bad-enum": {
      try {
        validateDecision(item, {
          item_id: item.item_id, report_digest: item.report_digest, row_id: item.row_ids[0],
          actor: "operator", decision: "approve-schedule", at: "2026-10-26T12:00:00.000Z", decision_id: "d-1",
        });
        return { refused: false };
      } catch (err) {
        return { refused: true, code: err.code };
      }
    }
    case "trust-wrong-root": {
      try {
        const { verifyClosure } = await import("../runner/trust-entry.mjs");
        verifyClosure("0".repeat(64));
        return { refused: false };
      } catch {
        return { refused: true };
      }
    }
    case "trust-unlisted-entry": {
      const root = sha256(readFileSync(join(WIRING, "runner", "manifest.json"), "utf8"));
      const res = spawnSync(process.execPath, [
        join(WIRING, "runner", "trust-entry.mjs"), root,
        "tests/evil-not-in-manifest.test.js",
      ], { encoding: "utf8" });
      return { exit: res.status };
    }
    case "deadline-spent": {
      const deadline = createInvocationDeadline(0);
      try {
        await runExecution({
          adapterSpec: { kind: "synthetic", datasets: {}, faults: {} },
          request: {}, policies: undefined, budgetUsed: {}, clockIso: "2026-10-26T12:00:00.000Z",
          deadline, workerUrl: new URL("../src/executeWorker.js", import.meta.url),
        });
        return { refused: false };
      } catch (err) {
        return { refused: true, code: err.code };
      } finally {
        deadline.dispose();
      }
    }
    default:
      throw new Error(`unknown post-step ${name}`);
  }
}

export async function main(argv = []) {
  const only = new Set();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") only.add(argv[++i]);
    else if (argv[i] === "--json") json = true;
  }
  const selected = CASES.filter((c) => only.size === 0 || only.has(c.id));
  const publisher = createMemoryPublisher();
  const priorReports = {};
  const results = [];
  let failures = 0;
  for (const c of selected) {
    const built = c.build();
    const clock = built.clock ?? FIXED_CLOCK;
    const pub = built.hangingPublisher ? hangingPublisher() : publisher;
    const publisherBefore = publisher.items.size;
    const runs = [];
    const items = [];
    let caseError = null;
    try {
      for (let run = 0; run < 3; run++) {
        const result = await runJob({
          hostConfig: built.host, request: built.request,
          callerAdapter: built.callerAdapter, callerAsk: built.callerAsk, adapterSpec: built.spec,
          publisher: pub, clock,
        });
        runs.push(result);
        if (result.outcome === "COMPLETED") {
          const stored = publisher.items.get(result.item_id);
          items.push(stored ?? result.item);
        }
      }
      // Byte-identical published items across the three runs.
      if (items.length === 3) {
        const bytes = items.map((it) => canonicalJson(it));
        if (bytes[0] !== bytes[1] || bytes[1] !== bytes[2]) {
          throw new Error(`published item bytes differ across runs for case ${c.id}`);
        }
      }
      // Outcomes must agree across runs.
      if (runs.length === 3 && (runs[0].outcome !== runs[1].outcome || runs[1].outcome !== runs[2].outcome)) {
        throw new Error(`outcomes differ across runs for case ${c.id}: ${runs.map((r) => r.outcome).join(",")}`);
      }
      let postResult = null;
      if (c.post) {
        postResult = await runPostStep(c.post, { item: items[0] ?? null, runs });
      }
      assertExpectation({
        caseId: c.id, expect: c.expect, runs, items,
        publisherBefore, publisherAfter: publisher.items.size,
        postResult, priorReports,
      });
      if (items[0]) priorReports[c.id] = canonicalJson(items[0].report);
    } catch (err) {
      caseError = err;
      failures += 1;
    }
    results.push({ id: c.id, group: c.group, title: c.title, passed: !caseError, error: caseError?.message ?? null });
    if (!json) {
      console.log(`${caseError ? "FAIL" : "PASS"} ${c.id} ${c.title}${caseError ? ` — ${caseError.message}` : ""}`);
    }
  }
  const passed = results.filter((r) => r.passed).length;
  if (json) {
    console.log(JSON.stringify({ passed, failed: failures, total: results.length, results }, null, 2));
  } else {
    console.log(`\n${passed}/${results.length} battery cases passed`);
  }
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
