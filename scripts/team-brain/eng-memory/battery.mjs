// Team Brain eng-memory slice 1 — battery core (import-safe).
// Implements the 100 frozen synthetic cases + 5 recall gold queries against
// a fresh synthetic host and fake store, plus the leakage scan. Imported by
// runBattery.mjs (CLI, 3-run determinism) and by the vitest suite.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createFakeStore } from "./store.mjs";
import { captureEvent, denySource, revokeSource } from "./capture.mjs";
import { recall } from "./recall.mjs";
import { assertHostConfig } from "./schemas.mjs";
import { assertCleanArtifact } from "./leakage.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const CANARIES = [
  "CANARY_TENANT_9f2e7a",
  "CANARY_LEDGER_77ab12",
  "CANARY_TOKEN_zz11qx",
  "CANARY_SECRET_kp09mz",
  "CANARY_COOKIE_44de",
  "CANARY_SSN_0088ab",
  "CANARY_BEARER_wq77tt",
  "CANARY_SHOULD_NEVER_PERSIST",
];

// All (repo,path) tuples exercised by the 30 frozen valid captures, plus
// the seed paths used by the battery itself. Source authorization requires
// exact registered tuples — never a repo/path Cartesian product.
const SOURCE_PAIRS = [
  ["onyxgolden/forge-ai-drop", "forge-ai-drop/MASTER-TRACKER.md"],
  ["onyxgolden/forge-ai-drop", "scripts/ai-agents/maintenance-manager-prototype/src/index.js"],
  ["onyxgolden/forge-ai-drop", "scripts/ai-agents/marketing-prototype/src/resolver.js"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/README.md"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/handoffs/stateMachine.mjs"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/ledger/repository.mjs"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/ledger/validation.mjs"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/queue/projection.mjs"],
  ["onyxgolden/forge-ai-drop", "scripts/team-brain/report/buildReport.mjs"],
  ["onyxgolden/marketplace409", "forge-ai-drop/MASTER-TRACKER.md"],
  ["onyxgolden/marketplace409", "scripts/ai-agents/maintenance-manager-prototype/src/index.js"],
  ["onyxgolden/marketplace409", "scripts/ai-agents/marketing-prototype/src/resolver.js"],
  ["onyxgolden/marketplace409", "scripts/team-brain/README.md"],
  ["onyxgolden/marketplace409", "scripts/team-brain/handoffs/stateMachine.mjs"],
  ["onyxgolden/marketplace409", "scripts/team-brain/ledger/repository.mjs"],
  ["onyxgolden/marketplace409", "scripts/team-brain/ledger/validation.mjs"],
  ["onyxgolden/marketplace409", "scripts/team-brain/queue/projection.mjs"],
  ["onyxgolden/marketplace409", "scripts/team-brain/report/buildReport.mjs"],
];

export function syntheticHost() {
  const registeredTasks = new Set();
  for (let i = 1; i <= 70; i += 1) registeredTasks.add(`eng-task-${String(i).padStart(3, "0")}`);
  registeredTasks.add("eng-task-conflict-001");
  registeredTasks.add("eng-task-gold-003");
  // M-019 budget seeds.
  for (let i = 1; i <= 70; i += 1) registeredTasks.add(`budget-task-${String(i).padStart(3, "0")}`);
  const host = {
    approvedRepos: new Set(["onyxgolden/marketplace409", "onyxgolden/forge-ai-drop"]),
    approvedPaths: new Set([
      "scripts/team-brain/README.md",
      "scripts/team-brain/ledger/repository.mjs",
      "scripts/team-brain/ledger/validation.mjs",
      "scripts/team-brain/queue/projection.mjs",
      "scripts/team-brain/handoffs/stateMachine.mjs",
      "scripts/team-brain/report/buildReport.mjs",
      "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
      "scripts/ai-agents/marketing-prototype/src/resolver.js",
      "forge-ai-drop/MASTER-TRACKER.md",
    ]),
    registeredPrincipals: new Set(["principal:muse", "principal:claude"]),
    registeredAuthorities: new Set(["auth:jason:eng-memory:1", "auth:jason:eng-memory:2"]),
    registeredTasks,
    sourceRegistrations: SOURCE_PAIRS.map(([repo, path]) => ({ repo, path })),
    authorityRegistrations: [
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: "principal:muse",
        actor: "Muse",
        actions: ["*"],
        tasks: "any",
        sources: "any",
      },
      {
        authorityRef: "auth:jason:eng-memory:2",
        principal: "principal:claude",
        actor: "Claude",
        actions: ["*"],
        tasks: "any",
        sources: "any",
      },
      // Frozen D-014/D-015/D-016/D-019/D-020 permute principal/actor across
      // the two authorities (distinct duplicate-test identities). The host
      // registers those exact triples; any other combination is refused.
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: "principal:claude",
        actor: "Muse",
        actions: ["*"],
        tasks: "any",
        sources: "any",
      },
      {
        authorityRef: "auth:jason:eng-memory:2",
        principal: "principal:muse",
        actor: "Claude",
        actions: ["*"],
        tasks: "any",
        sources: "any",
      },
    ],
    deniedSources: new Set(),
    revokedSources: new Set(),
    prohibitedValues: CANARIES.slice(),
  };
  assertHostConfig(host);
  return host;
}

export function loadBattery() {
  const jsonPath = join(here, "fixtures", "battery-cases.json");
  const shaPath = join(here, "fixtures", "battery-cases.sha256");
  const raw = readFileSync(jsonPath, "utf8");
  const recorded = readFileSync(shaPath, "utf8").split(/\s+/)[0];
  const actual = createHash("sha256").update(raw, "utf8").digest("hex");
  if (actual !== recorded) {
    throw new Error(`battery-cases.json digest mismatch: expected ${recorded}, got ${actual}`);
  }
  return JSON.parse(raw);
}

/** The authenticated caller bound to an authorityRef in the synthetic host. */
export function callerForAuthority(host, authorityRef) {
  const reg = host.authorityRegistrations.find((r) => r.authorityRef === authorityRef);
  if (!reg) throw new Error(`battery: unknown authorityRef ${authorityRef}`);
  return reg.principal;
}

// Deterministic bulk seed materialization for the budget case.
function seedEvents(store, host, count, taskPrefix) {
  for (let i = 1; i <= count; i++) {
    const r = captureEvent(
      store,
      host,
      {
        eventId: `evt-seed-${i}-synthetic`,
        taskId: `${taskPrefix}-${String(i).padStart(3, "0")}`,
        source: {
          repo: "onyxgolden/marketplace409",
          // PATHS[7]: approved, and never denied/revoked by any battery case.
          path: "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
          pin: { algo: "git-blob-sha1", id: createHash("sha256").update(`seed${i}`, "utf8").digest("hex").slice(0, 40) },
        },
        principal: "principal:muse",
        eventAt: `2026-10-${String(1 + (i % 15)).padStart(2, "0")}T08:00:00Z`,
        kind: "FILED",
        status: "OPEN",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      },
      { caller: "principal:muse" },
    );
    if (r.result !== "CAPTURED") throw new Error(`seedEvents: unexpected ${r.result}/${r.code} at ${i}`);
  }
}

// Materialize a throwing-getter sentinel input. The getter increments the
// counter and throws; admission must refuse without ever invoking it.
function materializeSentinel(base, sentinel, counters) {
  const key = sentinel.at;
  const id = `${sentinel.at}`;
  counters[id] = 0;
  const input = { ...base };
  if (key === "body" || key === "taskId" || key === "source") {
    delete input[key];
    Object.defineProperty(input, key, {
      enumerable: true,
      configurable: true,
      get() {
        counters[id] += 1;
        throw new Error("sentinel: body must never be read");
      },
    });
  }
  return input;
}

function runSetup(store, host, setup) {
  for (const step of setup || []) {
    if (step.op === "denySource") {
      denySource(store, host, step.input, { caller: callerForAuthority(host, step.input.attribution.authorityRef) });
    } else if (step.op === "revokeSource") {
      revokeSource(store, host, step.input, { caller: callerForAuthority(host, step.input.attribution.authorityRef) });
    } else if (step.op === "captureSeed") {
      captureEvent(store, host, step.input, { caller: step.input.principal });
    } else if (step.op === "seedEvents") {
      seedEvents(store, host, step.count, step.taskPrefix);
    } else throw new Error(`unknown setup op: ${step.op}`);
  }
}

function expiredClock() {
  const base = 1_700_000_000_000;
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? base : base + 6000;
  };
}

function checkExpect(kind, id, actual, expect) {
  const failures = [];
  if (expect.result !== undefined && actual.result !== expect.result) {
    failures.push(`result: expected ${expect.result}, got ${actual.result}`);
  }
  if (expect.code !== undefined && actual.code !== expect.code) {
    failures.push(`code: expected ${expect.code}, got ${actual.code}`);
  }
  if (expect.uncertainty !== undefined && actual.uncertainty !== expect.uncertainty) {
    failures.push(`uncertainty: expected ${expect.uncertainty}, got ${actual.uncertainty}`);
  }
  if (expect.minResults !== undefined && !(actual.results && actual.results.length >= expect.minResults)) {
    failures.push(`minResults ${expect.minResults}: got ${actual.results ? actual.results.length : "n/a"}`);
  }
  if (expect.maxResults !== undefined && !(actual.results && actual.results.length <= expect.maxResults)) {
    failures.push(`maxResults ${expect.maxResults}: got ${actual.results ? actual.results.length : "n/a"}`);
  }
  if (expect.conflictCount !== undefined) {
    const n = (actual.results || []).filter((r) => r.conflict).length;
    if (n !== expect.conflictCount) failures.push(`conflictCount: expected ${expect.conflictCount}, got ${n}`);
  }
  if (expect.minSuppressed !== undefined && !(actual.suppressed >= expect.minSuppressed)) {
    failures.push(`minSuppressed ${expect.minSuppressed}: got ${actual.suppressed}`);
  }
  if (expect.taskIds !== undefined) {
    const got = new Set((actual.results || []).map((r) => r.taskId));
    for (const t of expect.taskIds) {
      if (!got.has(t)) failures.push(`taskIds: missing ${t}`);
    }
  }
  return failures;
}

export function runOnce(battery) {
  const host = syntheticHost();
  const store = createFakeStore();
  const counters = {};
  const caseResults = [];
  // Full ACTUAL capture/recall results (not projections) for the leakage
  // scan: the "all outputs" assertion must cover real result payloads.
  const fullOutputs = [];
  let passed = 0;

  for (const c of battery.cases) {
    runSetup(store, host, c.setup);
    let actual;
    let input = c.input;
    if (c.sentinel) input = materializeSentinel(c.base, c.sentinel, counters);
    try {
      if (c.op === "capture") {
        const caller = input && typeof input === "object" ? input.principal : undefined;
        actual = captureEvent(store, host, input, { caller });
      } else if (c.op === "recall") {
        actual = recall(store, host, c.query, c.clock === "expired" ? { clock: expiredClock() } : {});
      } else throw new Error(`unknown op: ${c.op}`);
    } catch (err) {
      actual = { result: "THREW", code: err && err.code ? err.code : "UNEXPECTED_THROW" };
    }
    fullOutputs.push({ caseId: c.caseId, op: c.op, actual });
    const failures = checkExpect("case", c.caseId, actual, c.expect);
    if (c.sentinel && c.expect.accessorInvocations !== undefined) {
      const n = counters[c.sentinel.at] || 0;
      if (n !== c.expect.accessorInvocations) {
        failures.push(`accessorInvocations: expected ${c.expect.accessorInvocations}, got ${n}`);
      }
    }
    // The battery records only safe metadata: never input values.
    caseResults.push({
      caseId: c.caseId,
      category: c.category,
      op: c.op,
      expected: c.expect,
      actual: { result: actual.result, code: actual.code, uncertainty: actual.uncertainty },
      pass: failures.length === 0,
      failures,
    });
    if (failures.length === 0) passed += 1;
  }

  // Gold phase: fresh store seeded deterministically with the 30 valid
  // events only, so the budget-case seeds cannot pollute recall. This
  // matches the acceptance contract: the gold set runs against admitted
  // events, not against the adversarial budget fixtures.
  const goldHost = syntheticHost();
  const goldStore = createFakeStore();
  for (const c of battery.cases) {
    if (c.category === "valid" && c.op === "capture") {
      const r = captureEvent(goldStore, goldHost, c.input, { caller: c.input.principal });
      if (r.result !== "CAPTURED") throw new Error(`gold seed failed: ${c.caseId} -> ${r.result}/${r.code}`);
    }
  }
  const goldResults = [];
  let goldPassed = 0;
  for (const g of battery.gold) {
    runSetup(goldStore, goldHost, g.setup);
    let actual;
    try {
      actual = recall(goldStore, goldHost, g.query);
    } catch (err) {
      actual = { result: "THREW", code: err && err.code ? err.code : "UNEXPECTED_THROW" };
    }
    fullOutputs.push({ queryId: g.queryId, op: "recall", actual });
    const failures = checkExpect("gold", g.queryId, actual, g.expect);
    // Gold-set contract: every exact task-ID query finds its admitted event
    // within the 20-result cap.
    if (g.expect.taskIds || g.query.taskId) {
      if (actual.results && actual.results.length > 20) failures.push("gold: exceeded 20-result cap");
    }
    goldResults.push({ queryId: g.queryId, expected: g.expect, pass: failures.length === 0, failures });
    if (failures.length === 0) goldPassed += 1;
  }

  // Leakage scan over every output surface: both store dumps, the FULL
  // actual capture/recall results, and the case/gold result summaries.
  const outputs = {
    store: store.dumpForScan(),
    goldStore: goldStore.dumpForScan(),
    fullOutputs,
    caseResults,
    goldResults,
  };
  const leakage = (() => {
    try {
      assertCleanArtifact(outputs, CANARIES, "battery-outputs");
      return { clean: true, findings: 0 };
    } catch (err) {
      return { clean: false, findings: err.details ? err.details.count : -1 };
    }
  })();

  return {
    suite: "eng-memory-battery",
    synthetic: true,
    cases: { total: caseResults.length, passed, results: caseResults },
    gold: { total: goldResults.length, passed: goldPassed, results: goldResults },
    leakage,
    store: { episodes: store.episodeCount(), retentionReviews: store.listRetentionReviews().length },
  };
}
