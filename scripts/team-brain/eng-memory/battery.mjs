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
  // Task registry is deliberately small: per-entry consultation charging
  // during host validation bounds the walk, so the synthetic host keeps
  // only the tasks the frozen fixtures actually reference. M-019's 70
  // budget seeds cycle 6 tasks (the drain cap counts episodes, not tasks).
  const registeredTasks = new Set();
  for (let i = 1; i <= 10; i += 1) registeredTasks.add(`eng-task-${String(i).padStart(3, "0")}`);
  registeredTasks.add("eng-task-conflict-001");
  registeredTasks.add("eng-task-gold-003");
  for (let i = 1; i <= 6; i += 1) registeredTasks.add(`budget-task-${String(i).padStart(3, "0")}`);
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
    // Complete registered source identities (repo/path/pin). The pin is
    // part of the vouched identity: every pin appearing in the frozen
    // fixtures, plus the fixed M-019 seed pin and the unit-test probe pin,
    // is registered here. A syntactically valid but unregistered pin is
    // caller-invented integrity metadata and fails closed.
    registeredSourceIds: new Set([
      "evil/corp\u0000scripts/team-brain/README.md\u0000sha256\u000032b364cafc26fe55cb79621dd3730ee364d9b90f2bfabaaaaf08380ded87d5bb",
      "onyxgolden/forge-ai-drop\u0000forge-ai-drop/MASTER-TRACKER.md\u0000sha256\u00005c0adfd09508d0ba7f3859e4def28b0b3a579784d228206dd248ff97801841f0",
      "onyxgolden/forge-ai-drop\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000sha256\u000008aaff5f539d8c250a57a7edc8ef9bba40b4b6b9a46228eae8d40ce052a255ae",
      "onyxgolden/forge-ai-drop\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000sha256\u0000df0284bac7c4c776834caecafa8754883282e16850bfb6ad3d7d5f0dbae1d1e8",
      "onyxgolden/forge-ai-drop\u0000scripts/ai-agents/marketing-prototype/src/resolver.js\u0000sha256\u0000133b0cb69dcfcb2877ca0c40db9cfe7d21250c546a3837cbb05e8d15d4841723",
      "onyxgolden/forge-ai-drop\u0000scripts/ai-agents/marketing-prototype/src/resolver.js\u0000sha256\u00004d6b949090b4681a03b1c4c6d19c37eab42109969b4ff69bf4852055a6a52810",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/README.md\u0000sha256\u0000358db4ef45db6992b2a1b3a6ac5d29294f69ec4cb9ac83206313e66ddb400867",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/README.md\u0000sha256\u00005d1b3d1056c85b775cf03e752e3580a70133ba1d4698681eba635ba556d52291",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/README.md\u0000sha256\u0000bf496471101948e2aeac5fc38f34dc2acbe5a055b75cff35cc80561b477bb40a",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000sha256\u0000262eedacb8f3ad78808e0c3a6269d667236a7007f4fcd38f53ff884c648be19b",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000sha256\u00009aad353b4f2ce984e54486fffbf12ebe088ba8029097ebf5ecda86ab74b7579e",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000sha256\u0000eca9b2c20381cb26c43df8196ed0af0d4688bffeac8dc684b90d09ae014fab8c",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/repository.mjs\u0000git-blob-sha1\u0000d42e50b8202056ae6f07a3ccca4ac4f264295f88",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/repository.mjs\u0000sha256\u0000c7e29c9013b540f1385324326ea2f965f527f6e86d51d8fc416e9cf587a45314",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/repository.mjs\u0000sha256\u0000f541411af108f169eec4eb426a1616af1f0ec6cd70c1e6c1c492301a7958c257",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/repository.mjs\u0000sha256\u0000f54f440cdfda6b5a7b3a365a3f3e614e29fac3dde4760ec4564319930aed5e09",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/validation.mjs\u0000sha256\u0000349353a61dd20270a1df27e13674285455ba369704cfc3688b694afa8a890af2",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/ledger/validation.mjs\u0000sha256\u0000aa4036cde0cc4f12576d4414777c1073efaabb2278df8e4232c46c8236cfcca0",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/queue/projection.mjs\u0000git-blob-sha1\u00007fe2bb1b27973d5d4f9fc5a0ca12e8a01cc13d0b",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/queue/projection.mjs\u0000sha256\u00002c83501f803accd9210b16c0f8f7f6a7f69485a7048d9201a59f82d8ff09fc76",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/queue/projection.mjs\u0000sha256\u000041e874028bc6c215c531a3ba428cb6ab051ccce59c070338e31015a1d90206d9",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/queue/projection.mjs\u0000sha256\u0000cc6b2b1a6a6dc9328b4aefae00ec51aa581ff4dc2a54237ff179a77ce272baf3",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/report/buildReport.mjs\u0000git-blob-sha1\u0000c036f66fc98201860ca55616d1b756084b25db4f",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/report/buildReport.mjs\u0000sha256\u00004e0eae5be6aa8c9803fde6f6e3e43573fbfbb884a8593aeea2a29f2f56ebad49",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/report/buildReport.mjs\u0000sha256\u00006607420f1e4014acec9954d0280bfb4f8d37dcff8dc4c73474ea8b617633aa60",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/report/buildReport.mjs\u0000sha256\u0000a8a9b8b400e188a6b57b3e66cbd4cd61aef372dad16fac002835f2f4adbbf125",
      "onyxgolden/forge-ai-drop\u0000scripts/team-brain/report/buildReport.mjs\u0000sha256\u0000e499523f0add9f882d14c6e534a6368754bb97b4df59d9ce1180c183e74f899d",
      "onyxgolden/marketplace409\u0000forge-ai-drop/MASTER-TRACKER.md\u0000git-blob-sha1\u0000453ec2cebc9a185f78c697f7779e955949163945",
      "onyxgolden/marketplace409\u0000forge-ai-drop/MASTER-TRACKER.md\u0000git-blob-sha1\u0000be7e95b44f9f7a9c4bdb899ae17bd4014588111b",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000git-blob-sha1\u000054a008f8ae3651b7f3ac12eb959a2c08bd423a62",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000git-blob-sha1\u0000653ea073a97375058ced9775569e1c8dc7abc9de",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000git-blob-sha1\u0000993d934f6842441b8f6f9f7c02f4aa0ef6d8fa5f",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000git-blob-sha1\u0000b37a99d0356cc805e190a0224bdae1bd1a1408b8",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000sha256\u000097d8880297bd53368339de8addf76a54cd560bca67ad8287504021cb49c2b141",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/marketing-prototype/src/resolver.js\u0000git-blob-sha1\u00002c20ccabad6d5c36623d3247d806fd3c8f896c3f",
      "onyxgolden/marketplace409\u0000scripts/ai-agents/marketing-prototype/src/resolver.js\u0000git-blob-sha1\u0000de382b00ccbac13187693cb9fe425c4903825afa",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u000014e629ae630deebaa7f0a7e20beb50f6e38eead7",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u0000851d3ed7ddb64af7d436ce8c84d82ac8bc8207b5",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u0000853e708f429e3440b4c7ddc42a8e6e5dff48552d",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000sha256\u0000b2f97f586908ab27882f84ccde5e4d37d48119fe01c24a3b9f2f094c4e89dbcd",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000sha256\u0000e714adf0f8e00bcb17ddaea86c06fac652ef2a34dd481d6db3130389edfd5f83",
      "onyxgolden/marketplace409\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000git-blob-sha1\u0000209770734dde444ca843794b5498c4db60661d17",
      "onyxgolden/marketplace409\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000git-blob-sha1\u0000e7303f91fbf11defdc9a662e8ffc4d7a19b34004",
      "onyxgolden/marketplace409\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000git-blob-sha1\u0000eb57db93e1b6af0ca6eebd29ee450f89d1326f5d",
      "onyxgolden/marketplace409\u0000scripts/team-brain/handoffs/stateMachine.mjs\u0000sha256\u000070c1626bd3d0c4f2819b364f9feb467b5440dc88abec88a09dff628d11e95f43",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/repository.mjs\u0000git-blob-sha1\u0000009370666240e005d8df5ba996c73e9b28fa286c",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/repository.mjs\u0000git-blob-sha1\u000072ed01852c0071dbb2773ea5961b1d5c80c17d57",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/repository.mjs\u0000git-blob-sha1\u0000db16dfa4c08c69834a64136d3fa7440c4d13bf3a",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/validation.mjs\u0000git-blob-sha1\u00004d4d43e14f7c9d2ff6b8b6879fc2da8241a63af8",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/validation.mjs\u0000git-blob-sha1\u0000575c3d775b14f7b9fee20b3f9360d44b4640c7d4",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/validation.mjs\u0000git-blob-sha1\u0000d1852413d01bb59eadbf18a0295684eb102201c3",
      "onyxgolden/marketplace409\u0000scripts/team-brain/ledger/validation.mjs\u0000sha256\u0000f3324ea6057edb6183bc1565742ec5768d8d61026cda8c57f7a9c5bed79d5fce",
      "onyxgolden/marketplace409\u0000scripts/team-brain/queue/projection.mjs\u0000git-blob-sha1\u0000741a4c7ae7025fff9578a4e437b92fcd82d2ee1c",
      "onyxgolden/marketplace409\u0000scripts/team-brain/report/buildReport.mjs\u0000git-blob-sha1\u00001bb27c62a54037b59eda6c44e43246f0b4900133",
      "onyxgolden/marketplace409\u0000scripts/team-brain/report/buildReport.mjs\u0000git-blob-sha1\u00003cbf40a46f4893ae2d5992cce5a41fc1ab3d642c",
      "onyxgolden/marketplace409\u0000scripts/team-brain/report/buildReport.mjs\u0000sha256\u0000c23ab16e8fcfb48b036a53c53e3f68a523dfa4229949a166813b53a3f40c8b8f",
      "onyxgolden/marketplace409\u0000secrets/prod.env\u0000sha256\u0000bf6858b4baa48b8d44d286907d1ee3687ff9977fb063de1bb5045920c9fdf4b7",
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u0000" + "a".repeat(40),
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u0000" + "b".repeat(40),
      "onyxgolden/marketplace409\u0000scripts/team-brain/README.md\u0000git-blob-sha1\u0000" + "f".repeat(40),
      "onyxgolden/marketplace409\u0000scripts/ai-agents/maintenance-manager-prototype/src/index.js\u0000git-blob-sha1\u0000" + "f".repeat(40),
    ]),
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

// Deterministic bulk seed materialization for the budget case. Seeds
// cycle a small task set (the drain cap counts episodes, not tasks) and
// share one registered pin identity: distinct taskIds/event times keep the
// 70 episodes' identities distinct.
const SEED_PIN_ID = "f".repeat(40);
function seedEvents(store, host, count, taskPrefix) {
  for (let i = 1; i <= count; i++) {
    const r = captureEvent(
      store,
      host,
      {
        eventId: `evt-seed-${i}-synthetic`,
        taskId: `${taskPrefix}-${String(((i - 1) % 6) + 1).padStart(3, "0")}`,
        source: {
          repo: "onyxgolden/marketplace409",
          // PATHS[7]: approved, and never denied/revoked by any battery case.
          path: "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
          pin: { algo: "git-blob-sha1", id: SEED_PIN_ID },
        },
        principal: "principal:muse",
        // Distinct event times across all 70 seeds (15-minute slots):
        // identity includes eventAt, so every seed stays a distinct episode.
        eventAt: `2026-10-01T${String(Math.floor((i - 1) / 4)).padStart(2, "0")}:${String(((i - 1) % 4) * 15).padStart(2, "0")}:00Z`,
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
