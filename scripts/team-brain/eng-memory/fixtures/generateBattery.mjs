// Team Brain eng-memory slice 1 — deterministic battery-case generator.
// Writes fixtures/battery-cases.json (100 frozen synthetic cases) and
// fixtures/battery-cases.sha256. No randomness: every value derives from
// fixed templates and a counter-based hex stream, so regeneration is
// byte-identical. All data is synthetic; canary tokens are fake.
//
// Layout: 30 valid + 20 duplicate/replay/cross-repo/path/actor +
//          30 prohibited-data/source + 20 malformed/conflict/budget/crash.
// Recall gold set (5 queries) is emitted separately in the same file.
//
// Hostile inputs that cannot survive JSON (throwing getters) are recorded
// as {sentinel: {...}} directives; runBattery.mjs materializes them at
// runtime and proves zero accessor invocation.

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function hex(n, seed) {
  return createHash("sha256").update(`${seed}:${n}`, "utf8").digest("hex").slice(0, n === 40 ? 40 : 64);
}

const REPOS = ["onyxgolden/marketplace409", "onyxgolden/forge-ai-drop"];
const PATHS = [
  "scripts/team-brain/README.md",
  "scripts/team-brain/ledger/repository.mjs",
  "scripts/team-brain/ledger/validation.mjs",
  "scripts/team-brain/queue/projection.mjs",
  "scripts/team-brain/handoffs/stateMachine.mjs",
  "scripts/team-brain/report/buildReport.mjs",
  "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
  "scripts/ai-agents/marketing-prototype/src/resolver.js",
  "forge-ai-drop/MASTER-TRACKER.md",
];
const PRINCIPALS = ["principal:muse", "principal:claude"];
const AUTHORITIES = ["auth:jason:eng-memory:1", "auth:jason:eng-memory:2"];
const KINDS = ["FILED", "PROGRESS", "BLOCKED", "COMPLETED", "VERDICT", "SUPERSEDED", "REVOKED"];
const STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETE", "REVOKED", "SUPERSEDED"];

function ts(day, hour) {
  return `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
}

function validEvent(n, overrides = {}) {
  const i = n - 1;
  return {
    eventId: `evt-${String(n).padStart(3, "0")}-synthetic`,
    taskId: `eng-task-${String((i % 10) + 1).padStart(3, "0")}`,
    source: {
      repo: REPOS[i % 2],
      path: PATHS[i % PATHS.length],
      pin: i % 2 === 0 ? { algo: "git-blob-sha1", id: hex(40, `blob${n}`) } : { algo: "sha256", id: hex(64, `sha${n}`) },
    },
    principal: PRINCIPALS[i % 2],
    eventAt: ts(1 + (i % 16), 8 + (i % 10)),
    kind: KINDS[i % KINDS.length],
    status: STATUSES[i % STATUSES.length],
    attribution: { actor: i % 2 === 0 ? "Muse" : "Claude", authorityRef: AUTHORITIES[i % 2] },
    ...overrides,
  };
}

const cases = [];
const gold = [];
const push = (c) => cases.push(c);

// ---- 30 valid engineering events ----
for (let n = 1; n <= 30; n++) {
  push({
    caseId: `V-${String(n).padStart(3, "0")}`,
    category: "valid",
    op: "capture",
    input: validEvent(n),
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}

// ---- 20 duplicate / replay / cross-repo / path / actor ----
// Exact replays of V-001..V-005 (5)
for (let n = 1; n <= 5; n++) {
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: validEvent(n),
    expect: { result: "DUPLICATE_REPLAY", code: "DUPLICATE_REPLAY" },
  });
}
// Replay with a different eventId but identical identity components (3)
for (let n = 6; n <= 8; n++) {
  const base = validEvent(n - 5);
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, eventId: `evt-replay-${n}-synthetic` },
    expect: { result: "DUPLICATE_REPLAY", code: "DUPLICATE_REPLAY" },
  });
}
// Same logical event, changed pin -> separate episode (3)
for (let n = 9; n <= 11; n++) {
  const base = validEvent(n - 8);
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, source: { ...base.source, pin: { algo: "sha256", id: hex(64, `newpin${n}`) } } },
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}
// Same path, different repo -> separate identity (2)
for (let n = 12; n <= 13; n++) {
  const base = validEvent(20 + n);
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, source: { ...base.source, repo: REPOS[(REPOS.indexOf(base.source.repo) + 1) % 2] } },
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}
// Same repo/path/pin, different actor attribution -> separate identity (3)
for (let n = 14; n <= 16; n++) {
  const base = validEvent(n);
  const other = AUTHORITIES[(AUTHORITIES.indexOf(base.attribution.authorityRef) + 1) % 2];
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, attribution: { actor: base.attribution.actor === "Muse" ? "Claude" : "Muse", authorityRef: other } },
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}
// Same taskId, different kind/event time -> separate identity (2)
for (let n = 17; n <= 18; n++) {
  const base = validEvent(n);
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, kind: "PROGRESS", eventAt: ts(15, n - 10) },
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}
// Same identity components, different principal -> separate identity (2)
for (let n = 19; n <= 20; n++) {
  const base = validEvent(n + 5);
  push({
    caseId: `D-${String(n).padStart(3, "0")}`,
    category: "duplicate",
    op: "capture",
    input: { ...base, principal: PRINCIPALS[(PRINCIPALS.indexOf(base.principal) + 1) % 2] },
    expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
  });
}

// ---- 30 prohibited-data / source cases ----
const FORBIDDEN_KEYS = [
  "tenantId",
  "ledgerEntry",
  "paymentMethod",
  "scheduleData",
  "transcriptText",
  "cookieValue",
  "authHeader",
  "bearerToken",
  "apiKey",
  "vaultSecret",
  "ssnValue",
  "bankAccount",
  "imageBytes",
];
FORBIDDEN_KEYS.forEach((key, i) => {
  const base = validEvent(1);
  push({
    caseId: `P-${String(i + 1).padStart(3, "0")}`,
    category: "prohibited",
    op: "capture",
    // Unknown top-level key with a forbidden fragment: admission refuses
    // UNKNOWN_FIELD before value read; the fragment also trips the ban.
    input: { ...base, [key]: "CANARY_SHOULD_NEVER_PERSIST" },
    expect: { result: "REFUSED", code: "UNKNOWN_FIELD" },
  });
});
// Canary values hidden in plausible string fields (7)
const canaryFields = [
  ["taskId", "CANARY_TENANT_9f2e7a"],
  ["taskId", "CANARY_LEDGER_77ab12"],
  ["eventId", "CANARY_TOKEN_zz11qx"],
  ["eventId", "CANARY_SECRET_kp09mz"],
  ["attribution.actor", "CANARY_COOKIE_44de"],
  ["attribution.actor", "CANARY_SSN_0088ab"],
  ["taskId", "CANARY_BEARER_wq77tt"],
];
canaryFields.forEach(([field, canary], i) => {
  const base = validEvent(2);
  const input = JSON.parse(JSON.stringify(base));
  if (field.includes(".")) {
    const [obj, sub] = field.split(".");
    input[obj][sub] = `prefix-${canary}-suffix`;
  } else {
    input[field] = `prefix-${canary}-suffix`;
  }
  push({
    caseId: `P-${String(14 + i).padStart(3, "0")}`,
    category: "prohibited",
    op: "capture",
    input,
    expect: { result: "REFUSED", code: "PROHIBITED_DATA" },
  });
});
// Denied sources: deny first, then capture (4)
for (let i = 0; i < 4; i++) {
  const n = 21 + i;
  const repo = REPOS[i % 2];
  const path = PATHS[i % PATHS.length];
  push({
    caseId: `P-${String(21 + i).padStart(3, "0")}`,
    category: "prohibited",
    setup: [
      {
        op: "denySource",
        input: {
          repo,
          path,
          reason: "synthetic-denial",
          attribution: { actor: "Muse", authorityRef: AUTHORITIES[0] },
          revokedAt: ts(16, 9),
        },
      },
    ],
    op: "capture",
    input: validEvent(n, { source: { repo, path, pin: { algo: "git-blob-sha1", id: hex(40, `denied${n}`) } } }),
    expect: { result: "REFUSED", code: "DENIED_SOURCE" },
  });
}
// Revoked sources: revoke first, then capture (3)
for (let i = 0; i < 3; i++) {
  const n = 25 + i;
  const repo = REPOS[(i + 1) % 2];
  const path = PATHS[(i + 4) % PATHS.length];
  push({
    caseId: `P-${String(25 + i).padStart(3, "0")}`,
    category: "prohibited",
    setup: [
      {
        op: "revokeSource",
        input: {
          repo,
          path,
          reason: "synthetic-revocation",
          attribution: { actor: "Claude", authorityRef: AUTHORITIES[1] },
          revokedAt: ts(16, 10),
        },
      },
    ],
    op: "capture",
    input: validEvent(n, { source: { repo, path, pin: { algo: "sha256", id: hex(64, `revoked${n}`) } } }),
    expect: { result: "REFUSED", code: "SOURCE_REVOKED" },
  });
}
// Throwing sentinels: denied-source bodies are never read (3)
push({
  caseId: "P-028",
  category: "prohibited",
  op: "capture",
  sentinel: { kind: "throwing-getter", at: "body", note: "unknown key with throwing getter" },
  base: validEvent(3),
  expect: { result: "REFUSED", code: "UNKNOWN_FIELD", accessorInvocations: 0 },
});
push({
  caseId: "P-029",
  category: "prohibited",
  op: "capture",
  sentinel: { kind: "throwing-getter", at: "taskId", note: "known key with throwing getter" },
  base: validEvent(4),
  expect: { result: "REFUSED", code: "ACCESSOR_REJECTED", accessorInvocations: 0 },
});
push({
  caseId: "P-030",
  category: "prohibited",
  op: "capture",
  sentinel: { kind: "throwing-getter", at: "source", note: "nested object replaced by throwing getter" },
  base: validEvent(5),
  expect: { result: "REFUSED", code: "ACCESSOR_REJECTED", accessorInvocations: 0 },
});

// ---- 20 malformed / conflict / budget / crash ----
const malformed = [
  ["M-001", { eventAt: "10/16/2026 11:00" }, "MALFORMED_TIMESTAMP"],
  ["M-002", { eventAt: "2026-02-30T10:00:00Z" }, "MALFORMED_TIMESTAMP"],
  ["M-003", { kind: "SUMMARIZED" }, "INVALID_KIND"],
  ["M-004", { status: "ARCHIVED" }, "INVALID_STATUS"],
  ["M-005", { source: { repo: REPOS[0], path: PATHS[0], pin: { algo: "md5", id: "abc" } } }, "INVALID_PIN"],
  ["M-006", { source: { repo: REPOS[0], path: PATHS[0], pin: { algo: "sha256", id: "nothex!!" } } }, "INVALID_PIN"],
  ["M-007", { attribution: null, __omit: ["attribution"] }, "MISSING_ATTRIBUTION"],
  ["M-008", { attribution: { actor: "Muse", authorityRef: "auth:self-issued:fake" } }, "FORGED_AUTHORITY"],
  ["M-009", { source: { repo: "evil/corp", path: PATHS[0], pin: { algo: "sha256", id: hex(64, "evil1") } } }, "UNAPPROVED_REPO"],
  ["M-010", { source: { repo: REPOS[0], path: "secrets/prod.env", pin: { algo: "sha256", id: hex(64, "evil2") } } }, "UNAPPROVED_PATH"],
  ["M-011", { principal: "principal:intruder" }, "UNKNOWN_PRINCIPAL"],
  ["M-012", { extraNested: { deep: { deeper: 1 } } }, "UNKNOWN_FIELD"],
  ["M-013", { source: { repo: REPOS[0], path: PATHS[0], pin: { algo: "sha256", id: hex(64, "x13") }, extra: 1 } }, "UNKNOWN_FIELD"],
  ["M-014", { eventId: "" }, "INVALID_FIELD"],
];
malformed.forEach(([caseId, overrides, code], i) => {
  const { __omit, ...rest } = overrides;
  const input = validEvent(40 + i, rest);
  for (const k of __omit || []) delete input[k];
  push({
    caseId,
    category: "malformed",
    op: "capture",
    input,
    expect: { result: "REFUSED", code },
  });
});
// Null / array inputs (2) — cannot go through the object spread path
push({ caseId: "M-015", category: "malformed", op: "capture", input: null, expect: { result: "REFUSED", code: "ADMISSION_TYPE" } });
push({ caseId: "M-016", category: "malformed", op: "capture", input: [1, 2, 3], expect: { result: "REFUSED", code: "ADMISSION_TYPE" } });
// Conflict pair: same task, two current episodes with disagreeing status (2)
push({
  caseId: "M-017",
  category: "conflict",
  op: "capture",
  input: validEvent(60, { taskId: "eng-task-conflict-001", status: "BLOCKED", kind: "BLOCKED", eventAt: ts(16, 11) }),
  expect: { result: "CAPTURED", code: "EPISODE_CAPTURED" },
});
push({
  caseId: "M-018",
  category: "conflict",
  op: "recall",
  query: { taskId: "eng-task-conflict-001" },
  setup: [
    {
      op: "captureSeed",
      input: validEvent(61, { taskId: "eng-task-conflict-001", status: "IN_PROGRESS", kind: "PROGRESS", eventAt: ts(16, 12) }),
    },
  ],
  expect: { result: "RECALLED", uncertainty: "NONE", conflictCount: 2 },
});
// Budget exhaustion: 70 seeded episodes, broad recall consults >64 (1)
push({
  caseId: "M-019",
  category: "budget",
  op: "recall",
  query: { kind: "FILED" },
  setup: [{ op: "seedEvents", count: 70, taskPrefix: "budget-task" }],
  expect: { result: "REFUSED", code: "BUDGET_EXHAUSTED" },
});
// Watchdog: expired fake clock (1)
push({
  caseId: "M-020",
  category: "crash",
  op: "recall",
  query: { kind: "PROGRESS" },
  clock: "expired",
  expect: { result: "REFUSED", code: "WATCHDOG_EXCEEDED" },
});
// Crash/retry idempotency is covered by D-001..D-008 replays; the battery
// runner additionally asserts store episode counts per case.

// ---- Recall gold set (5) ----
gold.push(
  {
    queryId: "G-001",
    query: { taskId: "eng-task-001" },
    expect: { result: "RECALLED", uncertainty: "NONE", minResults: 1, taskIds: ["eng-task-001"] },
  },
  {
    queryId: "G-002",
    query: { taskId: "eng-task-002", sourceRepo: "onyxgolden/forge-ai-drop" },
    expect: { result: "RECALLED", uncertainty: "NONE", minResults: 1 },
  },
  {
    queryId: "G-003",
    // A valid episode is captured, then its source is revoked: the episode
    // must be suppressed from retrieval (history preserved, never returned).
    setup: [
      {
        op: "captureSeed",
        input: {
          eventId: "evt-gold-003-synthetic",
          taskId: "eng-task-gold-003",
          source: {
            repo: "onyxgolden/marketplace409",
            path: "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
            pin: { algo: "sha256", id: hex(64, "gold003") },
          },
          principal: "principal:muse",
          eventAt: "2026-10-15T09:00:00Z",
          kind: "FILED",
          status: "OPEN",
          attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
        },
      },
      {
        op: "revokeSource",
        input: {
          repo: "onyxgolden/marketplace409",
          path: "scripts/ai-agents/maintenance-manager-prototype/src/index.js",
          reason: "synthetic-gold-revocation",
          attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
          revokedAt: "2026-10-15T10:00:00Z",
        },
      },
    ],
    query: { taskId: "eng-task-gold-003" },
    expect: { result: "RECALLED", uncertainty: "NO_MATCH", maxResults: 0, minSuppressed: 1 },
  },
  {
    queryId: "G-004",
    query: { kind: "VERDICT" },
    expect: { result: "RECALLED", uncertainty: "AMBIGUOUS_CUES", minResults: 1 },
  },
  {
    queryId: "G-005",
    query: { taskId: "eng-task-does-not-exist" },
    expect: { result: "RECALLED", uncertainty: "NO_MATCH", maxResults: 0 },
  },
);

const payload = {
  generatedBy: "scripts/team-brain/eng-memory/fixtures/generateBattery.mjs",
  synthetic: true,
  counts: { valid: 30, duplicate: 20, prohibited: 30, malformed: 16, conflict: 2, budget: 1, crash: 1 },
  cases,
  gold,
};

const json = JSON.stringify(payload, null, 2) + "\n";
const outPath = join(here, "battery-cases.json");
writeFileSync(outPath, json);
const digest = createHash("sha256").update(json, "utf8").digest("hex");
writeFileSync(join(here, "battery-cases.sha256"), digest + "  battery-cases.json\n");
console.log(`wrote ${cases.length} cases + ${gold.length} gold queries; sha256=${digest}`);
