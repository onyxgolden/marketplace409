// Team Brain eng-memory slice 1 — vitest suite.
// In-memory only: no PGlite, no network, no wall clock, no model calls.
// The 100-case frozen battery runs through battery.mjs (import-safe core);
// this suite adds module-level, adversarial (mutation), determinism, and
// handoff-conformance-mapping tests.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { admitObject, keySpecs } from "../admission.mjs";
import { ENG_CODES } from "../errors.mjs";
import { EVENT_KEY_SPECS, assertHostConfig, assertPin, sourceIdentityString } from "../schemas.mjs";
import { createFakeStore } from "../store.mjs";
import { captureEvent, denySource, revokeSource, episodeIdentity, episodeIdFor, MAX_ADMITTED_BYTES } from "../capture.mjs";
import { recall, recallAsync, matchAndProject, MAX_CONSULTED_CANDIDATES, RECALL_RESULT_CAP } from "../recall.mjs";
import { scanArtifact, assertCleanArtifact } from "../leakage.mjs";
import { loadBattery, runOnce, syntheticHost, CANARIES } from "../battery.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function validInput(overrides = {}) {
  return {
    eventId: "evt-test-001-synthetic",
    taskId: "eng-task-001",
    source: {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      pin: { algo: "git-blob-sha1", id: "a".repeat(40) },
    },
    principal: "principal:muse",
    eventAt: "2026-10-16T10:00:00Z",
    kind: "FILED",
    status: "OPEN",
    attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
    ...overrides,
  };
}

// Module-scope seeded store (also defined locally in the recall block;
// this copy serves the EMEM-001 verdict-probe tests).
function seededStoreModule(n, host) {
  const store = createFakeStore();
  for (let i = 1; i <= n; i++) {
    const totalMinutes = i - 1;
    const r = captureEvent(
      store,
      host,
      validInput({
        eventId: `evt-seed-${i}-synthetic`,
        taskId: `eng-task-${String(((i - 1) % 10) + 1).padStart(3, "0")}`,
        eventAt: `2026-10-01T${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00Z`,
        source: {
          repo: "onyxgolden/marketplace409",
          path: "scripts/team-brain/README.md",
          pin: { algo: "git-blob-sha1", id: "f".repeat(40) },
        },
      }),
      { caller: "principal:muse" },
    );
    if (r.result !== "CAPTURED") throw new Error(`seed failed: ${r.code}`);
  }
  return store;
}

function throwingGetter(obj, key) {
  let invocations = 0;
  const next = { ...obj };
  delete next[key];
  Object.defineProperty(next, key, {
    enumerable: true,
    configurable: true,
    get() {
      invocations += 1;
      throw new Error("sentinel fired");
    },
  });
  return { input: next, invocations: () => invocations };
}

describe("admission: descriptor boundary", () => {
  it("admits a valid event to a detached plain snapshot", () => {
    const input = validInput();
    const snap = admitObject(input, EVENT_KEY_SPECS);
    expect(snap.taskId).toBe("eng-task-001");
    expect(snap.source.pin.algo).toBe("git-blob-sha1");
    // Detached: mutating the input afterwards cannot affect the snapshot.
    input.taskId = "mutated";
    input.source.pin.id = "mutated";
    expect(snap.taskId).toBe("eng-task-001");
  });

  it("refuses unknown top-level fields before reading their values", () => {
    const { input, invocations } = throwingGetter(validInput(), "taskId");
    input.extraEvil = undefined;
    // unknown key, but make the KNOWN key the sentinel: use unknown throwing key
    const hostile = { ...validInput() };
    let n = 0;
    Object.defineProperty(hostile, "unknownField", {
      enumerable: true,
      configurable: true,
      get() {
        n += 1;
        throw new Error("must not fire");
      },
    });
    expect(() => admitObject(hostile, EVENT_KEY_SPECS)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.UNKNOWN_FIELD }),
    );
    expect(n).toBe(0);
    void input;
    void invocations;
  });

  it("refuses unknown nested fields before traversal", () => {
    const input = validInput({ source: { repo: "r", path: "p", pin: { algo: "sha256", id: "b".repeat(64) }, extra: 1 } });
    expect(() => admitObject(input, EVENT_KEY_SPECS)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.UNKNOWN_FIELD }),
    );
  });

  it("invokes zero accessors: throwing getter on a known key is refused uninvoked", () => {
    const { input, invocations } = throwingGetter(validInput(), "taskId");
    expect(() => admitObject(input, EVENT_KEY_SPECS)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.ACCESSOR_REJECTED }),
    );
    expect(invocations()).toBe(0);
  });

  it("ignores inherited properties and prototype getters entirely", () => {
    const proto = {};
    let protoHits = 0;
    Object.defineProperty(proto, "inheritedEvil", {
      enumerable: true,
      configurable: true,
      get() {
        protoHits += 1;
        return 1;
      },
    });
    const input = Object.create(proto);
    Object.assign(input, validInput());
    const snap = admitObject(input, EVENT_KEY_SPECS);
    expect(snap.inheritedEvil).toBeUndefined();
    expect(Object.keys(snap)).not.toContain("inheritedEvil");
    expect(protoHits).toBe(0);
  });

  it("refuses __proto__ own keys", () => {
    const input = validInput();
    Object.defineProperty(input, "__proto__", { enumerable: true, configurable: true, value: { x: 1 } });
    expect(() => admitObject(input, EVENT_KEY_SPECS)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.PROTOTYPE_KEY }),
    );
  });

  it("enforces the depth bound", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(() => admitObject(deep, keySpecs({ a: { b: { c: { d: { e: { f: null } } } } } }))).toThrowError(
      expect.objectContaining({ code: ENG_CODES.ADMISSION_BOUND_EXCEEDED }),
    );
  });

  it("rejects non-object inputs without traversal", () => {
    for (const bad of [null, 42, "x", [1]]) {
      expect(() => admitObject(bad, EVENT_KEY_SPECS)).toThrowError(
        expect.objectContaining({ code: ENG_CODES.ADMISSION_TYPE }),
      );
    }
  });
});

describe("schemas and host authentication", () => {
  it("rejects glob/wildcard approved paths (broadened-allowlist mutation)", () => {
    const host = syntheticHost();
    host.approvedPaths = new Set(["scripts/**"]);
    expect(() => assertHostConfig(host)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.INVALID_HOST_CONFIG }),
    );
  });

  it("rejects empty host sets", () => {
    const host = syntheticHost();
    host.registeredPrincipals = new Set();
    expect(() => assertHostConfig(host)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.INVALID_HOST_CONFIG }),
    );
  });

  it("rejects repo-relative traversal paths in host config", () => {
    const host = syntheticHost();
    host.approvedPaths = new Set(["../escape.env"]);
    expect(() => assertHostConfig(host)).toThrowError(
      expect.objectContaining({ code: ENG_CODES.INVALID_HOST_CONFIG }),
    );
  });

  it("validates pin algorithm and identity format", () => {
    expect(() => assertPin({ algo: "md5", id: "abc" })).toThrowError(
      expect.objectContaining({ code: ENG_CODES.INVALID_PIN }),
    );
    expect(() => assertPin({ algo: "sha256", id: "zz" })).toThrowError(
      expect.objectContaining({ code: ENG_CODES.INVALID_PIN }),
    );
    expect(assertPin({ algo: "sha256", id: "c".repeat(64) }).algo).toBe("sha256");
  });
});

describe("capture", () => {
  it("captures a valid event with a deterministic source-bound episode ID", () => {
    const host = syntheticHost();
    const s1 = createFakeStore();
    const s2 = createFakeStore();
    const r1 = captureEvent(s1, host, validInput(), { caller: "principal:muse" });
    const r2 = captureEvent(s2, syntheticHost(), validInput(), { caller: "principal:muse" });
    expect(r1.result).toBe("CAPTURED");
    expect(r1.episodeId).toBe(r2.episodeId);
    expect(r1.episodeId.startsWith("em-")).toBe(true);
  });

  it("exact replay is idempotent: one logical event (handoff AC-19 analogue)", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(store, host, validInput(), { caller: "principal:muse" });
    // Simulate crash: drop the result, retry the identical input.
    const retry = captureEvent(store, host, validInput(), { caller: "principal:muse" });
    expect(first.result).toBe("CAPTURED");
    expect(retry.result).toBe("DUPLICATE_REPLAY");
    expect(retry.episodeId).toBe(first.episodeId);
    expect(store.episodeCount()).toBe(1);
  });

  it("refuses the whole task when admitted bytes exceed 256KiB", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput({ taskId: "x".repeat(300 * 1024) }), { caller: "principal:muse" });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.ADMISSION_BUDGET_EXCEEDED });
    expect(store.episodeCount()).toBe(0);
    expect(MAX_ADMITTED_BYTES).toBe(262144);
  });

  it("refuses unapproved repo/path and unknown principal", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput({ source: { ...validInput().source, repo: "evil/corp" } }), { caller: "principal:muse" }).code).toBe(
      ENG_CODES.UNAPPROVED_REPO,
    );
    expect(
      captureEvent(store, host, validInput({ source: { ...validInput().source, path: "secrets/x.env" } }), { caller: "principal:muse" }).code,
    ).toBe(ENG_CODES.UNAPPROVED_PATH);
    expect(captureEvent(store, host, validInput({ principal: "principal:intruder" }), { caller: "principal:intruder" }).code).toBe(
      ENG_CODES.UNKNOWN_PRINCIPAL,
    );
  });

  it("refuses forged authority: self-issued authorityRef never clears the gate", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ attribution: { actor: "Muse", authorityRef: "auth:self-issued:fake" } }),
      { caller: "principal:muse" },
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.FORGED_AUTHORITY });
  });

  it("requires attribution: omitted attribution is refused", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const input = validInput();
    delete input.attribution;
    expect(captureEvent(store, host, input, { caller: "principal:muse" }).code).toBe(ENG_CODES.MISSING_ATTRIBUTION);
  });

  it("denied sources refuse before any body read; revocation records a retention review", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const denial = denySource(
      store,
      host,
      {
        repo: "onyxgolden/marketplace409",
        path: "scripts/team-brain/README.md",
        reason: "synthetic",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
        revokedAt: "2026-10-16T10:00:00Z",
      },
      { caller: "principal:muse" },
    );
    expect(denial.result).toBe("DENIED");
    // Throwing sentinel on the denied source: still refused without invocation.
    const { input, invocations } = throwingGetter(validInput(), "source");
    const r = captureEvent(store, host, input, { caller: "principal:muse" });
    expect(r.code).toBe(ENG_CODES.ACCESSOR_REJECTED);
    expect(invocations()).toBe(0);

    const host2 = syntheticHost();
    const store2 = createFakeStore();
    const rev = revokeSource(
      store2,
      host2,
      {
        repo: "onyxgolden/marketplace409",
        path: "scripts/team-brain/README.md",
        reason: "synthetic",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
        revokedAt: "2026-10-16T10:00:00Z",
      },
      { caller: "principal:muse" },
    );
    expect(rev.result).toBe("REVOKED");
    const r2 = captureEvent(store2, host2, validInput(), { caller: "principal:muse" });
    expect(r2.code).toBe(ENG_CODES.SOURCE_REVOKED);
    const reviews = store2.listRetentionReviews();
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    expect(reviews[0]).toMatchObject({ status: "PENDING", reason: "synthetic" });
    // History preserved: revocation is suppression, not deletion.
    expect(store2.episodeCount()).toBe(0);
  });

  it("unauthorized self-approved denial never clears the gate", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = denySource(
      store,
      host,
      {
        repo: "onyxgolden/marketplace409",
        path: "scripts/team-brain/README.md",
        reason: "forged",
        attribution: { actor: "Intruder", authorityRef: "auth:self-issued:fake" },
        revokedAt: "2026-10-16T10:00:00Z",
      },
      { caller: "principal:intruder" },
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.FORGED_AUTHORITY });
    // Source not denied: capture still succeeds.
    expect(captureEvent(store, host, validInput(), { caller: "principal:muse" }).result).toBe("CAPTURED");
  });

  it("refusal diagnostics carry codes and safe IDs only, never rejected values", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const canary = "CANARY_TENANT_9f2e7a";
    const r = captureEvent(store, host, validInput({ taskId: `prefix-${canary}-suffix` }), { caller: "principal:muse" });
    expect(r.code).toBe(ENG_CODES.PROHIBITED_DATA);
    expect(JSON.stringify(r)).not.toContain(canary);
  });
});

describe("recall", () => {
  function seededStore(n, host) {
    const store = createFakeStore();
    for (let i = 1; i <= n; i++) {
      // Tasks cycle the 10 registered eng-task-* ids; the pin is the
      // registered seed identity; event times are distinct per seed so
      // every seed is a distinct episode identity.
      const totalMinutes = i - 1;
      const r = captureEvent(
        store,
        host,
        validInput({
          eventId: `evt-seed-${i}-synthetic`,
          taskId: `eng-task-${String(((i - 1) % 10) + 1).padStart(3, "0")}`,
          eventAt: `2026-10-01T${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00Z`,
          source: {
            repo: "onyxgolden/marketplace409",
            path: "scripts/team-brain/README.md",
            pin: { algo: "git-blob-sha1", id: "f".repeat(40) },
          },
        }),
        { caller: "principal:muse" },
      );
      if (r.result !== "CAPTURED") throw new Error(`seed failed: ${r.code}`);
    }
    return store;
  }

  it("charges before inspecting: budget exhaustion refuses with no partial output", () => {
    const host = syntheticHost();
    const store = seededStore(70, host);
    const r = recall(store, host, { kind: "FILED" });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(r.results).toBeUndefined();
    expect(MAX_CONSULTED_CANDIDATES).toBe(64);
  });

  it("caps results at 20 with deterministic ranking and stable tie-breaks", () => {
    const host = syntheticHost();
    const store = seededStore(25, host);
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.returned).toBe(RECALL_RESULT_CAP);
    expect(r.totalMatched).toBe(25);
    // Ranking: eventAt desc, episodeId asc on ties.
    const ats = r.results.map((x) => x.eventAt);
    const sorted = [...ats].sort().reverse();
    expect(ats).toEqual(sorted);
    const ties = r.results.filter((x) => x.eventAt === ats[0]).map((x) => x.episodeId);
    expect(ties).toEqual([...ties].sort());
  });

  it("exact task-ID query is certain; broad cues are ambiguous; misses are explicit", () => {
    const host = syntheticHost();
    const store = seededStore(5, host);
    const exact = recall(store, host, { taskId: "eng-task-001" });
    expect(exact.uncertainty).toBe("NONE");
    expect(exact.results.length).toBe(1);
    const broad = recall(store, host, { kind: "FILED" });
    expect(broad.uncertainty).toBe("AMBIGUOUS_CUES");
    const miss = recall(store, host, { taskId: "eng-task-nope" });
    expect(miss.uncertainty).toBe("NO_MATCH");
    expect(miss.results).toEqual([]);
  });

  it("contradictions coexist with explicit conflict flags", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput({ taskId: "eng-task-009", status: "BLOCKED", kind: "BLOCKED" }), { caller: "principal:muse" });
    captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-c2-synthetic",
        taskId: "eng-task-009",
        status: "IN_PROGRESS",
        kind: "PROGRESS",
        eventAt: "2026-10-16T11:00:00Z",
      }),
      { caller: "principal:muse" },
    );
    const r = recall(store, host, { taskId: "eng-task-009" });
    expect(r.results.filter((x) => x.conflict)).toHaveLength(2);
    expect(r.results[0].conflictWith).toHaveLength(1);
  });

  it("revoked sources are suppressed from retrieval, never deleted", () => {
    const host = syntheticHost();
    const store = seededStore(3, host);
    revokeSource(
      store,
      host,
      {
        repo: "onyxgolden/marketplace409",
        path: "scripts/team-brain/README.md",
        reason: "synthetic",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
        revokedAt: "2026-10-16T10:00:00Z",
      },
      { caller: "principal:muse" },
    );
    const r = recall(store, host, { kind: "FILED" });
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(3);
    expect(store.episodeCount()).toBe(3);
  });

  it("watchdog expiry refuses the whole task with no partial output", () => {
    const host = syntheticHost();
    const store = seededStore(3, host);
    const base = 1_700_000_000_000;
    let calls = 0;
    const clock = () => {
      calls += 1;
      return calls === 1 ? base : base + 6000;
    };
    const r = recall(store, host, { kind: "FILED" }, { clock });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.WATCHDOG_EXCEEDED });
    expect(r.results).toBeUndefined();
  });

  it("retrieved candidates carry provenance and a non-authoritative notice", () => {
    const host = syntheticHost();
    const store = seededStore(1, host);
    const r = recall(store, host, { taskId: "eng-task-001" });
    const ep = r.results[0];
    expect(ep.source.pin.algo).toBe("git-blob-sha1");
    expect(ep.attribution.authorityRef).toBe("auth:jason:eng-memory:1");
    expect(r.notice).toMatch(/not truth/);
  });
});

describe("mutations: adversarial variants the guards must catch", () => {
  it("raw-payload-capture variant is caught by the leakage scan", () => {
    // Simulate a broken store that retains raw caller input alongside the
    // episode. The leakage scan must flag it: this proves the scan has
    // teeth, and the real store (which never retains raw input) stays clean.
    const rawInput = validInput({ taskId: "prefix-CANARY_TOKEN_zz11qx-suffix" });
    const dirtyDump = { episodes: [{ episodeId: "em-x", rawInput }], retentionReviews: [] };
    const findings = scanArtifact(dirtyDump, CANARIES);
    expect(findings.length).toBeGreaterThan(0);
    expect(() => assertCleanArtifact(dirtyDump, CANARIES, "dirty")).toThrowError(
      expect.objectContaining({ code: ENG_CODES.LEAKAGE_DETECTED }),
    );
    // And the real store dump is clean.
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), { caller: "principal:muse" });
    expect(assertCleanArtifact(store.dumpForScan(), CANARIES, "store")).toBe(true);
  });

  it("leakage scanner flags forbidden key fragments in outputs", () => {
    const findings = scanArtifact({ episodes: [{ tenantId: "x" }] }, []);
    expect(findings.some((f) => f.kind === "key")).toBe(true);
  });
});

describe("handoff conformance mapping", () => {
  it("replay-after-denial stays refused (uncertain-outcome replay case)", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    denySource(
      store,
      host,
      {
        repo: "onyxgolden/marketplace409",
        path: "scripts/team-brain/README.md",
        reason: "synthetic",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
        revokedAt: "2026-10-16T10:00:00Z",
      },
      { caller: "principal:muse" },
    );
    const input = validInput();
    expect(captureEvent(store, host, input, { caller: "principal:muse" }).code).toBe(ENG_CODES.DENIED_SOURCE);
    // Retry after "recovery": still refused, never admitted.
    expect(captureEvent(store, host, input, { caller: "principal:muse" }).code).toBe(ENG_CODES.DENIED_SOURCE);
    expect(store.episodeCount()).toBe(0);
  });

  it("ambiguous recall never fabricates an answer", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = recall(store, host, { kind: "FILED" });
    expect(r.uncertainty).toBe("NO_MATCH");
    expect(r.results).toEqual([]);
  });
});

describe("battery and determinism", () => {
  it("battery fixtures are frozen: digest matches the committed pin", () => {
    const raw = readFileSync(join(here, "..", "fixtures", "battery-cases.json"), "utf8");
    const recorded = readFileSync(join(here, "..", "fixtures", "battery-cases.sha256"), "utf8").split(/\s+/)[0];
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(recorded);
  });

  it("frozen battery: 100/100 cases, 5/5 gold, leakage clean", () => {
    const battery = loadBattery();
    expect(battery.cases).toHaveLength(100);
    expect(battery.gold).toHaveLength(5);
    const run = runOnce(battery);
    expect(run.cases.passed).toBe(100);
    expect(run.gold.passed).toBe(5);
    expect(run.leakage.clean).toBe(true);
  });

  it("episode IDs are stable across independent runs", () => {
    const a = episodeIdentity({
      taskId: "t",
      kind: "FILED",
      principal: "principal:muse",
      eventAt: "2026-10-16T10:00:00Z",
      source: { repo: "r", path: "p", pin: { algo: "sha256", id: "d".repeat(64) } },
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
    });
    const b = episodeIdentity({
      taskId: "t",
      kind: "FILED",
      principal: "principal:muse",
      eventAt: "2026-10-16T10:00:00Z",
      source: { repo: "r", path: "p", pin: { algo: "sha256", id: "d".repeat(64) } },
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
    });
    expect(a).toBe(b);
    expect(episodeIdFor(a)).toMatch(/^em-[0-9a-f]{24}$/);
  });
});

// ---------------------------------------------------------------------------
// Fix round 2 (EMEM-001..007) regressions.
// ---------------------------------------------------------------------------

const MUSE = "principal:muse";
const CALLER_MUSE = { caller: MUSE };

function setDeep(obj, path, value) {
  let node = obj;
  for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]];
  node[path[path.length - 1]] = value;
}

function denialInput(overrides = {}) {
  return {
    repo: "onyxgolden/marketplace409",
    path: "scripts/team-brain/README.md",
    reason: "synthetic",
    attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
    revokedAt: "2026-10-16T10:00:00Z",
    ...overrides,
  };
}

describe("EMEM-001: scalar admission, budgets, async watchdog", () => {
  const SCALAR_PATHS = [
    ["eventId"],
    ["taskId"],
    ["principal"],
    ["eventAt"],
    ["kind"],
    ["status"],
    ["source", "repo"],
    ["source", "path"],
    ["source", "commit"],
    ["source", "pin", "algo"],
    ["source", "pin", "id"],
    ["attribution", "actor"],
    ["attribution", "authorityRef"],
  ];

  it("rejects getter-bearing objects at every scalar position with zero invocations", () => {
    const host = syntheticHost();
    expect(SCALAR_PATHS).toHaveLength(13);
    for (const path of SCALAR_PATHS) {
      let invocations = 0;
      const store = createFakeStore();
      const input = validInput();
      const hostile = {};
      Object.defineProperty(hostile, "x", {
        enumerable: true,
        configurable: true,
        get() {
          invocations += 1;
          return "s";
        },
      });
      setDeep(input, path, hostile);
      const r = captureEvent(store, host, input, CALLER_MUSE);
      expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.NONPRIMITIVE_SCALAR });
      expect(invocations).toBe(0);
      expect(store.episodeCount()).toBe(0);
    }
  });

  it("rejects arrays at scalar positions without traversal", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput({ taskId: ["eng-task-001"] }), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.NONPRIMITIVE_SCALAR });
  });

  it("rejects cyclic objects at scalar positions and terminates", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const cyclic = { label: "cycle" };
    cyclic.self = cyclic;
    const r = captureEvent(store, host, validInput({ taskId: cyclic }), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.NONPRIMITIVE_SCALAR });
    expect(store.episodeCount()).toBe(0);
  });

  it("hostile 65th canary dies on the budget charge with zero invocations", () => {
    const host = syntheticHost();
    const canaries = [];
    for (let i = 0; i < 64; i += 1) canaries.push(`SYNTHETIC_CANARY_${i}`);
    let invocations = 0;
    Object.defineProperty(canaries, "64", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        throw new Error("must not fire");
      },
    });
    host.prohibitedValues = canaries;
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(invocations).toBe(0);
  });

  it("recall charges before inspecting: hostile 65th candidate never read", () => {
    const host = syntheticHost();
    const plain = [];
    for (let i = 0; i < 64; i += 1) plain.push({ episodeId: `em-${i}` });
    let invocations = 0;
    const hostile = {};
    Object.defineProperty(hostile, "taskId", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        return "x";
      },
    });
    const store = {
      *episodesInOrder() {
        yield* plain;
        yield hostile;
      },
    };
    const r = recall(store, host, { kind: "FILED" });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(r.results).toBeUndefined();
    expect(invocations).toBe(0);
  });

  it("recallAsync terminates a hung async iterator via the real timer", async () => {
    const store = {
      async *episodesInOrder() {
        await new Promise(() => {});
        yield { episodeId: "em-never" };
      },
    };
    const r = await recallAsync(store, syntheticHost(), { kind: "FILED" }, { timeoutMs: 200 });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.WATCHDOG_EXHAUSTED });
    expect(r.results).toBeUndefined();
  });

  it("recallAsync returns results on the normal path", async () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const r = await recallAsync(store, host, { taskId: "eng-task-001" }, { timeoutMs: 2000 });
    expect(r.result).toBe("RECALLED");
    expect(r.results).toHaveLength(1);
    expect(r.uncertainty).toBe("NONE");
  });

  it("returned-payload accounting refuses past 256KiB with no partial output", () => {
    const host = syntheticHost();
    const episodes = [];
    for (let i = 0; i < 20; i += 1) {
      episodes.push({
        episodeId: `em-${String(i).padStart(2, "0")}`,
        taskId: "x".repeat(20000),
        source: {
          repo: "onyxgolden/marketplace409",
          path: "scripts/team-brain/README.md",
          pin: { algo: "git-blob-sha1", id: "a".repeat(40) },
        },
        principal: MUSE,
        eventAt: "2026-10-16T10:00:00Z",
        eventAtMs: 1760608800000,
        kind: "FILED",
        status: "OPEN",
        attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      });
    }
    const r = matchAndProject(episodes, host, { kind: "FILED" }, { consulted: 20, suppressed: 0 });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.RESULT_PAYLOAD_EXCEEDED });
    expect(r.results).toBeUndefined();
  });

  it("recall host validation is budgeted: hostile 65th registration never read", () => {
    // EMEM-001 verdict probe: 65 registrations with a counting getter on
    // the 65th repo. Recall must refuse BUDGET_EXHAUSTED with zero
    // invocations (charge-before-inspect, descriptor-safe reads).
    const host = syntheticHost();
    const regs = [];
    for (let i = 0; i < 64; i += 1) regs.push({ repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md" });
    let invocations = 0;
    const hostile = { path: "scripts/team-brain/README.md" };
    Object.defineProperty(hostile, "repo", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        return "onyxgolden/marketplace409";
      },
    });
    regs.push(hostile);
    host.sourceRegistrations = regs;
    const r = recall(createFakeStore(), host, { taskId: "eng-task-001" });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(r.results).toBeUndefined();
    expect(invocations).toBe(0);
  });

  it("capture host validation refuses (not throws) on a hostile 64th registration", () => {
    // EMEM-001 verdict probe: an accessor on array index 63 must never be
    // invoked — the charge that would exceed the budget fires first — and
    // the BUDGET_EXHAUSTED surfaces as a bounded REFUSED envelope.
    const host = syntheticHost();
    const regs = [];
    for (let i = 0; i < 63; i += 1) regs.push({ repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md" });
    let invocations = 0;
    const hostile = { path: "scripts/team-brain/README.md" };
    Object.defineProperty(hostile, "repo", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        return "onyxgolden/marketplace409";
      },
    });
    regs.push(hostile);
    regs.push({ repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md" });
    host.sourceRegistrations = regs;
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(invocations).toBe(0);
  });

  it("nested authority collections are charged per candidate", () => {
    // EMEM-001: a 65-element hostile actions array dies on the charge.
    const host = syntheticHost();
    const actions = [];
    for (let i = 0; i < 64; i += 1) actions.push("CAPTURE");
    let invocations = 0;
    Object.defineProperty(actions, "64", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        return "CAPTURE";
      },
    });
    host.authorityRegistrations = [
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: "principal:muse",
        actor: "Muse",
        actions,
        tasks: "any",
        sources: "any",
      },
    ];
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
    expect(invocations).toBe(0);
  });

  it("child-process-contained synchronous hang probe returns WATCHDOG_EXHAUSTED", async () => {
    // EMEM-001: the hang probe runs in a child process so a regression
    // here could never hang the suite itself.
    const { execFile } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const out = await new Promise((resolve, reject) => {
      execFile("node", [join(here, "hangProbe.child.mjs")], { timeout: 25000 }, (err, stdout, stderr) =>
        err ? reject(new Error(`hang probe failed: ${stderr || err.message}`)) : resolve(stdout),
      );
    });
    expect(out).toMatch(/HANG_PROBE_PASS/);
  }, 30000);

  it("verdict probe EMEM-001a: getter on authorityRegistrations[0].authorityRef refuses with zero invocations", () => {
    // The getter returns the SAME registered string — the refusal must
    // come from the accessor itself (rejected at admission, never
    // invoked), not from a wrong value.
    const host = syntheticHost();
    const orig = host.authorityRegistrations[0];
    let invocations = 0;
    const evil = { ...orig };
    Object.defineProperty(evil, "authorityRef", {
      enumerable: true,
      configurable: true,
      get() {
        invocations += 1;
        return orig.authorityRef;
      },
    });
    host.authorityRegistrations[0] = evil;
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.INVALID_HOST_CONFIG });
    expect(invocations).toBe(0);
  });

  it("verdict probe EMEM-001b: single aggregate budget — 64-episode recall never exceeds 64 charged units", async () => {
    // Instruments ConsultationBudget.charge: one invocation (admission +
    // recall drain) must record at most 64 charged units total, and the
    // 64-episode recall must refuse with BUDGET_EXHAUSTED (bounded
    // refusal before the first excess candidate), never RECALLED.
    const { ConsultationBudget } = await import("../budget.mjs");
    const host = syntheticHost();
    const store = seededStoreModule(64, host);
    let charged = 0;
    const origCharge = ConsultationBudget.prototype.charge;
    ConsultationBudget.prototype.charge = function (n, ...rest) {
      const result = origCharge.call(this, n, ...rest); // throws on exhaustion
      charged += n; // only units actually debited count as consulted
      return result;
    };
    try {
      const r = recall(store, host, { kind: "FILED" });
      expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED });
      expect(r.results).toBeUndefined();
      expect(charged).toBeLessThanOrEqual(64);
    } finally {
      ConsultationBudget.prototype.charge = origCharge;
    }
  });

  it("verdict probe EMEM-001c: factory hang returns WATCHDOG_EXHAUSTED promptly (child process)", async () => {
    // episodesInOrder() itself busy-loops. Must return WATCHDOG_EXHAUSTED
    // via the V8 preemptive boundary — never ETIMEDOUT/SIGTERM from the
    // parent watchdog.
    const { execFile } = await import("node:child_process");
    const out = await new Promise((resolve, reject) => {
      execFile("node", [join(here, "hangProbe.factory.child.mjs")], { timeout: 10000 }, (err, stdout, stderr) =>
        err ? reject(new Error(`factory hang probe failed: ${stderr || err.message}`)) : resolve(stdout),
      );
    });
    expect(out).toMatch(/FACTORY_HANG_PROBE_PASS/);
  }, 15000);

  it("verdict probe EMEM-001c: async-next hang returns WATCHDOG_EXHAUSTED promptly (child process)", async () => {
    // Async generator body busy-loops before its first await (synchronous
    // within next()). Must return WATCHDOG_EXHAUSTED via the V8 boundary
    // on the sync prefix — never ETIMEDOUT/SIGTERM.
    const { execFile } = await import("node:child_process");
    const out = await new Promise((resolve, reject) => {
      execFile("node", [join(here, "hangProbe.asyncNext.child.mjs")], { timeout: 10000 }, (err, stdout, stderr) =>
        err ? reject(new Error(`async-next hang probe failed: ${stderr || err.message}`)) : resolve(stdout),
      );
    });
    expect(out).toMatch(/ASYNC_NEXT_HANG_PROBE_PASS/);
  }, 15000);
});

describe("EMEM-002: caller binding and authority registrations", () => {
  function minimalHost() {
    // Exactly the two design registrations: no mixed principal/actor triples.
    const host = syntheticHost();
    host.authorityRegistrations = host.authorityRegistrations.slice(0, 2);
    return host;
  }

  it("verdict probe: known principal + wrong actor + known authority is refused", () => {
    const host = minimalHost();
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ principal: "principal:claude", attribution: { actor: "Jason", authorityRef: "auth:jason:eng-memory:1" } }),
      { caller: "principal:claude" },
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_PRINCIPAL_MISMATCH });
    expect(store.episodeCount()).toBe(0);
  });

  it("caller/principal mismatch is refused before any host checks", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput({ principal: "principal:claude" }), { caller: MUSE });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.CALLER_PRINCIPAL_MISMATCH });
  });

  it("missing caller is refused", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput());
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.MISSING_CALLER });
  });

  it("repo/path cross-product outside registered tuples is refused", () => {
    const host = syntheticHost();
    host.sourceRegistrations = [{ repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md" }];
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({
        source: {
          repo: "onyxgolden/marketplace409",
          path: "scripts/team-brain/ledger/validation.mjs",
          pin: { algo: "git-blob-sha1", id: "a".repeat(40) },
        },
      }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.UNAPPROVED_PATH });
  });

  it("fabricated pin against a pin-bound registration is refused", () => {
    const host = syntheticHost();
    host.registeredSourceIds = new Set([
      sourceIdentityString("onyxgolden/marketplace409", "scripts/team-brain/README.md", "git-blob-sha1", "a".repeat(40)),
    ]);
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "b".repeat(40) } } }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.SOURCE_PIN_MISMATCH });
    expect(store.episodeCount()).toBe(0);
  });

  it("random syntactically valid pin without a host identity is refused", () => {
    // EMEM-002: the synthetic host registers only repo/path pairs plus an
    // explicit pin-identity set. A random valid pin the host never vouched
    // for is caller-invented integrity metadata and fails closed.
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({
        source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "f".repeat(40).replace(/f/g, "e") } },
      }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.SOURCE_PIN_MISMATCH });
    expect(store.episodeCount()).toBe(0);
  });

  it("host without registered pin identities fails closed", () => {
    const host = syntheticHost();
    delete host.registeredSourceIds;
    expect(() => assertHostConfig(host)).toThrowError(/registeredSourceIds/);
  });

  it("wrong commit against a commit-bound registration is refused", () => {
    const host = syntheticHost();
    host.sourceRegistrations = [
      { repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md", commit: "a".repeat(40) },
    ];
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ source: { ...validInput().source, commit: "b".repeat(40) } }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.SOURCE_COMMIT_MISMATCH });
  });

  it("correct commit+pin against a bound registration captures", () => {
    const host = syntheticHost();
    host.sourceRegistrations = [
      { repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md", commit: "c".repeat(40) },
    ];
    host.registeredSourceIds = new Set([
      sourceIdentityString("onyxgolden/marketplace409", "scripts/team-brain/README.md", "git-blob-sha1", "d".repeat(40)),
    ]);
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({
        source: {
          repo: "onyxgolden/marketplace409",
          path: "scripts/team-brain/README.md",
          commit: "c".repeat(40),
          pin: { algo: "git-blob-sha1", id: "d".repeat(40) },
        },
      }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "CAPTURED", code: ENG_CODES.EPISODE_CAPTURED });
  });

  it("replaced pin identity suppresses already-captured episodes at recall", () => {
    // EMEM-002: capture under pin A, then the host replaces the registered
    // pin identity with pin B. Recall must not keep serving the disallowed
    // pin-A episode.
    const host = syntheticHost();
    const store = createFakeStore();
    const r1 = captureEvent(store, host, validInput(), CALLER_MUSE);
    expect(r1.result).toBe("CAPTURED");
    host.registeredSourceIds = new Set([
      sourceIdentityString("onyxgolden/marketplace409", "scripts/team-brain/README.md", "git-blob-sha1", "b".repeat(40)),
    ]);
    const r = recall(store, host, { taskId: "eng-task-001" });
    expect(r.result).toBe("RECALLED");
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(1);
    expect(r.uncertainty).toBe("NO_MATCH");
  });

  it("expired authority registration is refused", () => {
    const host = syntheticHost();
    for (const reg of host.authorityRegistrations) {
      if (reg.authorityRef === "auth:jason:eng-memory:1") reg.notAfterMs = 1;
    }
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_EXPIRED });
  });

  it("revoked authority registration is refused", () => {
    const host = syntheticHost();
    for (const reg of host.authorityRegistrations) {
      if (reg.authorityRef === "auth:jason:eng-memory:1") reg.revoked = true;
    }
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_REVOKED });
  });

  it("authority without the event action is refused", () => {
    const host = syntheticHost();
    host.authorityRegistrations = [
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: MUSE,
        actor: "Muse",
        actions: ["FILED"],
        tasks: "any",
        sources: "any",
      },
    ];
    const r = captureEvent(createFakeStore(), host, validInput({ kind: "PROGRESS" }), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_ACTION_DENIED });
  });

  it("authority without the task in scope is refused", () => {
    const host = syntheticHost();
    host.authorityRegistrations = [
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: MUSE,
        actor: "Muse",
        actions: ["*"],
        tasks: ["eng-task-009"],
        sources: "any",
      },
    ];
    const r = captureEvent(createFakeStore(), host, validInput({ taskId: "eng-task-001" }), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_SCOPE_DENIED });
  });

  it("removing an approved read path suppresses already-stored episodes", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).result).toBe("CAPTURED");
    host.approvedPaths.delete("scripts/team-brain/README.md");
    const r = recall(store, host, { taskId: "eng-task-001" });
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(1);
    expect(store.episodeCount()).toBe(1);
  });
});

describe("EMEM-002: commit restriction honored by recall", () => {
  // The synthetic host's source registrations carry no commit bindings;
  // these tests add one to the registration matching validInput()'s
  // (repo,path), capture, then mutate the CURRENT binding and recall.
  function commitHost(commit) {
    const host = syntheticHost();
    host.sourceRegistrations = host.sourceRegistrations.map((r) =>
      r.repo === "onyxgolden/marketplace409" && r.path === "scripts/team-brain/README.md" ? { ...r, commit } : { ...r },
    );
    return host;
  }

  it("verdict probe: changed commit binding suppresses recall (returned:0, suppressed:1)", () => {
    const c1 = "1".repeat(40);
    const c2 = "2".repeat(40);
    const host = commitHost(c1);
    const store = createFakeStore();
    const input = validInput();
    input.source.commit = c1;
    expect(captureEvent(store, host, input, CALLER_MUSE).result).toBe("CAPTURED");
    // Tighten the CURRENT binding: the captured commit is no longer vouched for.
    host.sourceRegistrations = commitHost(c2).sourceRegistrations;
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.returned).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(r.results).toEqual([]);
    expect(store.episodeCount()).toBe(1);
  });

  it("missing required commit suppresses recall", () => {
    const c1 = "1".repeat(40);
    const host = syntheticHost(); // no commit binding yet
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).result).toBe("CAPTURED");
    // Now the host declares a commit restriction: the commit-less episode
    // no longer satisfies the current registration.
    host.sourceRegistrations = commitHost(c1).sourceRegistrations;
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.returned).toBe(0);
    expect(r.suppressed).toBe(1);
  });

  it("matching commit retains recall permission", () => {
    const c1 = "1".repeat(40);
    const host = commitHost(c1);
    const store = createFakeStore();
    const input = validInput();
    input.source.commit = c1;
    expect(captureEvent(store, host, input, CALLER_MUSE).result).toBe("CAPTURED");
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.returned).toBe(1);
    expect(r.suppressed).toBe(0);
  });

  it("no commit required when the host declares no commit restriction", () => {
    const host = syntheticHost(); // no commit bindings
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).result).toBe("CAPTURED");
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.returned).toBe(1);
  });
});

describe("EMEM-003: registry-bound identity fields", () => {
  it("verdict probe: operational text in taskId is refused as unregistered", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ taskId: "SYNTHETIC Jane Doe rent balance $1200 account 555000" }),
      CALLER_MUSE,
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.UNREGISTERED_TASK });
    expect(store.episodeCount()).toBe(0);
  });

  it("unseen sensitive-looking strings are refused per field", () => {
    const host = syntheticHost();
    const cases = [
      [{ taskId: "SYNTHETIC-ACCT-998877" }, ENG_CODES.UNREGISTERED_TASK],
      [{ eventId: "SYNTHETIC-EVT 001" }, ENG_CODES.INVALID_EVENT_ID],
      [{ attribution: { actor: "SYNTHETIC Mallory", authorityRef: "auth:jason:eng-memory:1" } }, ENG_CODES.AUTHORITY_ACTOR_MISMATCH],
      [{ source: { ...validInput().source, repo: "SYNTHETIC/evil-corp" } }, ENG_CODES.UNAPPROVED_REPO],
      [{ source: { ...validInput().source, path: "SYNTHETIC/secrets.env" } }, ENG_CODES.UNAPPROVED_PATH],
      [{ source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "SYNTHETIC-not-hex" } } }, ENG_CODES.INVALID_PIN],
      [{ eventAt: "SYNTHETIC-o-clock" }, ENG_CODES.MALFORMED_TIMESTAMP],
      [{ kind: "SYNTHETIC" }, ENG_CODES.INVALID_KIND],
      [{ status: "SYNTHETIC" }, ENG_CODES.INVALID_STATUS],
    ];
    for (const [overrides, code] of cases) {
      const store = createFakeStore();
      const input = validInput(overrides);
      const caller = input.principal && typeof input.principal === "string" ? input.principal : MUSE;
      const r = captureEvent(store, host, input, { caller });
      expect(r.result).toBe("REFUSED");
      if (code) expect(r.code).toBe(code);
      expect(store.episodeCount()).toBe(0);
    }
    // Unknown principal with a matching caller: still refused at the registry.
    const store = createFakeStore();
    const r = captureEvent(
      store,
      host,
      validInput({ principal: "principal:SYNTHETIC-mallory" }),
      { caller: "principal:SYNTHETIC-mallory" },
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.UNKNOWN_PRINCIPAL });
  });

  it("registered task outside the authority source scope is refused", () => {
    const host = syntheticHost();
    host.authorityRegistrations = [
      {
        authorityRef: "auth:jason:eng-memory:1",
        principal: MUSE,
        actor: "Muse",
        actions: ["*"],
        tasks: "any",
        sources: [{ repo: "onyxgolden/marketplace409", path: "scripts/team-brain/ledger/validation.mjs" }],
      },
    ];
    const r = captureEvent(createFakeStore(), host, validInput(), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.AUTHORITY_SCOPE_DENIED });
  });

  it("free-text retention reasons are refused", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = denySource(store, host, denialInput({ reason: "free text with spaces" }), CALLER_MUSE);
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.INVALID_REASON });
    expect(store.listRetentionReviews()).toHaveLength(0);
  });
});

describe("EMEM-004: replay identity vs content conflicts", () => {
  it("verdict probe: same identity with changed status is a CONFLICT, not a silent duplicate", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(store, host, validInput(), CALLER_MUSE);
    expect(first).toMatchObject({ result: "CAPTURED" });
    const second = captureEvent(
      store,
      host,
      validInput({ eventId: "evt-test-002-synthetic", status: "BLOCKED" }),
      CALLER_MUSE,
    );
    expect(second).toMatchObject({ result: "CONFLICT", code: ENG_CODES.EPISODE_CONTENT_CONFLICT });
    expect(second.conflictsWith).toBe(first.episodeId);
    expect(second.episodeId).not.toBe(first.episodeId);
    expect(store.episodeCount()).toBe(2);
    // Both episodes carry conflict flags on recall: history is preserved, nothing erased.
    const r = recall(store, host, { taskId: "eng-task-001" });
    expect(r.results.filter((x) => x.conflict)).toHaveLength(2);
    const byId = new Map(r.results.map((x) => [x.episodeId, x]));
    expect(byId.get(first.episodeId).status).toBe("OPEN");
    expect(byId.get(second.episodeId).status).toBe("BLOCKED");
  });

  it("reordered equivalent input is still an idempotent duplicate", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const a = validInput();
    const first = captureEvent(store, host, a, CALLER_MUSE);
    expect(first.result).toBe("CAPTURED");
    const b = {
      status: a.status,
      kind: a.kind,
      eventAt: a.eventAt,
      principal: a.principal,
      source: { pin: { id: a.source.pin.id, algo: a.source.pin.algo }, path: a.source.path, repo: a.source.repo },
      taskId: a.taskId,
      eventId: a.eventId,
      attribution: { authorityRef: a.attribution.authorityRef, actor: a.attribution.actor },
    };
    const retry = captureEvent(store, host, b, CALLER_MUSE);
    expect(retry).toMatchObject({ result: "DUPLICATE_REPLAY", code: ENG_CODES.DUPLICATE_REPLAY });
    expect(retry.episodeId).toBe(first.episodeId);
    expect(store.episodeCount()).toBe(1);
  });

  it("changed pin under the same task captures as a separate episode", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(store, host, validInput(), CALLER_MUSE);
    expect(first.result).toBe("CAPTURED");
    const second = captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-test-003-synthetic",
        source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "b".repeat(40) } },
      }),
      CALLER_MUSE,
    );
    expect(second).toMatchObject({ result: "CAPTURED", code: ENG_CODES.EPISODE_CAPTURED });
    expect(store.episodeCount()).toBe(2);
    // Identical retry of the second is a duplicate of the second.
    const retry = captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-test-003-synthetic",
        source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "b".repeat(40) } },
      }),
      CALLER_MUSE,
    );
    expect(retry).toMatchObject({ result: "DUPLICATE_REPLAY" });
    expect(retry.episodeId).toBe(second.episodeId);
  });

  it("conflict-content retry is a duplicate of the conflict episode", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const conflict = captureEvent(
      store,
      host,
      validInput({ eventId: "evt-test-004-synthetic", status: "BLOCKED" }),
      CALLER_MUSE,
    );
    expect(conflict.result).toBe("CONFLICT");
    const retry = captureEvent(
      store,
      host,
      validInput({ eventId: "evt-test-004-synthetic", status: "BLOCKED" }),
      CALLER_MUSE,
    );
    expect(retry).toMatchObject({ result: "DUPLICATE_REPLAY", code: ENG_CODES.DUPLICATE_REPLAY });
    expect(retry.episodeId).toBe(conflict.episodeId);
    expect(store.episodeCount()).toBe(2);
  });

  it("changed commit is a distinct revision identity, never a silent duplicate", () => {
    // EMEM-004: the supplied source revision (commit) is part of the
    // canonical identity. Changing only the commit captures a separate
    // episode; recall preserves both commits.
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(
      store,
      host,
      validInput({ source: { ...validInput().source, commit: "1".repeat(40) } }),
      CALLER_MUSE,
    );
    expect(first.result).toBe("CAPTURED");
    const second = captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-commit-2-synthetic",
        source: { ...validInput().source, commit: "2".repeat(40) },
      }),
      CALLER_MUSE,
    );
    expect(second).toMatchObject({ result: "CAPTURED", code: ENG_CODES.EPISODE_CAPTURED });
    expect(second.episodeId).not.toBe(first.episodeId);
    expect(store.episodeCount()).toBe(2);
    const r = recall(store, host, { taskId: "eng-task-001" });
    expect(r.results).toHaveLength(2);
    const commits = r.results.map((x) => x.source.commit).sort();
    expect(commits).toEqual(["1".repeat(40), "2".repeat(40)]);
  });

  it("persisted OPEN/COMPLETE conflict survives recall with terminal status", () => {
    // EMEM-004: capture OPEN, then the same identity/time as COMPLETE.
    // Capture stores a CONFLICT with conflictsWith; recall must carry the
    // persisted material conflict even though COMPLETE is terminal.
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(store, host, validInput({ taskId: "eng-task-002" }), CALLER_MUSE);
    expect(first.result).toBe("CAPTURED");
    const conflict = captureEvent(
      store,
      host,
      validInput({ eventId: "evt-oc-2-synthetic", taskId: "eng-task-002", status: "COMPLETE" }),
      CALLER_MUSE,
    );
    expect(conflict).toMatchObject({ result: "CONFLICT", code: ENG_CODES.EPISODE_CONTENT_CONFLICT });
    expect(conflict.conflictsWith).toBe(first.episodeId);
    const r = recall(store, host, { taskId: "eng-task-002" });
    expect(r.results).toHaveLength(2);
    for (const ep of r.results) {
      expect(ep.conflict).toBe(true);
      expect(ep.conflictWith).toHaveLength(1);
    }
    const ids = r.results.map((x) => x.episodeId);
    for (const ep of r.results) {
      expect(ids).toContain(ep.conflictWith[0]);
    }
  });

  it("ordinary chronological completion is not a conflict", () => {
    // Distinct identities completing over time: no conflictsWith link, no
    // status disagreement among nonterminal episodes -> no conflict flags.
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput({ taskId: "eng-task-003" }), CALLER_MUSE);
    captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-occ-2-synthetic",
        taskId: "eng-task-003",
        status: "COMPLETE",
        kind: "COMPLETED",
        eventAt: "2026-10-16T11:00:00Z",
      }),
      CALLER_MUSE,
    );
    const r = recall(store, host, { taskId: "eng-task-003" });
    expect(r.results).toHaveLength(2);
    for (const ep of r.results) {
      expect(ep.conflict).toBe(false);
      expect(ep.conflictWith).toEqual([]);
    }
  });
});

describe("EMEM-005: detached store boundaries", () => {
  it("verdict probe: mutating recall output cannot rewrite stored provenance", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const r1 = recall(store, host, { taskId: "eng-task-001" });
    r1.results[0].source.pin.id = "b".repeat(40);
    r1.results[0].attribution.authorityRef = "auth:forged";
    const r2 = recall(store, host, { taskId: "eng-task-001" });
    expect(r2.results[0].source.pin.id).toBe("a".repeat(40));
    expect(r2.results[0].attribution.authorityRef).toBe("auth:jason:eng-memory:1");
    expect(r2.results[0].episodeId).toBe(r1.results[0].episodeId);
  });

  it("mutating capture input after capture cannot affect the store", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const input = validInput();
    const r = captureEvent(store, host, input, CALLER_MUSE);
    expect(r.result).toBe("CAPTURED");
    input.taskId = "eng-task-002";
    input.source.pin.id = "b".repeat(40);
    input.attribution.actor = "Mallory";
    const ep = store.getEpisode(r.identityHash);
    expect(ep.taskId).toBe("eng-task-001");
    expect(ep.source.pin.id).toBe("a".repeat(40));
    expect(ep.attribution.actor).toBe("Muse");
  });

  it("getEpisode, dumpForScan, and listRetentionReviews return detached copies", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput(), CALLER_MUSE);
    const ep = store.getEpisode(r.identityHash);
    ep.taskId = "mutated";
    ep.source.pin.id = "mutated";
    expect(store.getEpisode(r.identityHash).taskId).toBe("eng-task-001");
    const dump = store.dumpForScan();
    dump.episodes[0].taskId = "mutated";
    expect(store.getEpisode(r.identityHash).taskId).toBe("eng-task-001");
    denySource(store, host, denialInput(), CALLER_MUSE);
    const reviews = store.listRetentionReviews();
    expect(reviews).toHaveLength(1);
    reviews[0].reason = "mutated";
    reviews[0].source.repo = "mutated";
    const again = store.listRetentionReviews();
    expect(again[0].reason).toBe("synthetic");
    expect(again[0].source.repo).toBe("onyxgolden/marketplace409");
  });
});

describe("EMEM-006: epoch-ms timestamps and uncertainty", () => {
  it("verdict probe: 1ms-after-since millisecond event is matched", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const c = captureEvent(store, host, validInput({ eventAt: "2026-10-16T10:00:00.001Z" }), CALLER_MUSE);
    expect(c.result).toBe("CAPTURED");
    const r = recall(store, host, { taskId: "eng-task-001", since: "2026-10-16T10:00:00Z" });
    expect(r.result).toBe("RECALLED");
    expect(r.results).toHaveLength(1);
  });

  it("same-instant window bounds are inclusive", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const r = recall(store, host, {
      taskId: "eng-task-001",
      since: "2026-10-16T10:00:00Z",
      until: "2026-10-16T10:00:00Z",
    });
    expect(r.results).toHaveLength(1);
  });

  it("reverse window is refused", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const r = recall(store, host, {
      taskId: "eng-task-001",
      since: "2026-10-16T11:00:00Z",
      until: "2026-10-16T10:00:00Z",
    });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.INVALID_QUERY });
  });

  it("repository-only query is broad, not certain", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(store, host, validInput(), CALLER_MUSE);
    const r = recall(store, host, { sourceRepo: "onyxgolden/marketplace409" });
    expect(r.result).toBe("RECALLED");
    expect(r.uncertainty).toBe("AMBIGUOUS_CUES");
    expect(r.cueStrength).toBe("BROAD");
    expect(r.results).toHaveLength(1);
  });

  it("truncation is reported with coverage counts", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    for (let i = 1; i <= 25; i += 1) {
      const totalMinutes = i - 1;
      const r = captureEvent(
        store,
        host,
        validInput({
          eventId: `evt-trunc-${i}-synthetic`,
          taskId: `eng-task-${String(((i - 1) % 10) + 1).padStart(3, "0")}`,
          eventAt: `2026-10-01T${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00Z`,
          source: {
            repo: "onyxgolden/marketplace409",
            path: "scripts/team-brain/README.md",
            pin: { algo: "git-blob-sha1", id: "f".repeat(40) },
          },
        }),
        CALLER_MUSE,
      );
      if (r.result !== "CAPTURED") throw new Error(`seed failed: ${r.code}`);
    }
    const r = recall(store, host, { kind: "FILED" });
    expect(r.result).toBe("RECALLED");
    expect(r.truncated).toBe(true);
    expect(r.totalMatched).toBe(25);
    expect(r.returned).toBe(20);
    expect(r.cueStrength).toBe("BROAD");
    expect(r.notice).toMatch(/truncated/i);
  });

  it("ranking uses epoch-ms with episodeId tie-break", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    captureEvent(
      store,
      host,
      validInput({ eventId: "evt-tie-a-synthetic", source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "a".repeat(40) } } }),
      CALLER_MUSE,
    );
    captureEvent(
      store,
      host,
      validInput({ eventId: "evt-tie-b-synthetic", source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "b".repeat(40) } } }),
      CALLER_MUSE,
    );
    const r = recall(store, host, { taskId: "eng-task-001" });
    expect(r.results).toHaveLength(2);
    const ids = r.results.map((x) => x.episodeId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("EMEM-007: retention reviews on denial/revocation", () => {
  it("denial creates one retention-review record with attribution and trigger", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const d = denySource(store, host, denialInput(), CALLER_MUSE);
    expect(d.result).toBe("DENIED");
    expect(d.reviewId).toMatch(/^rr-[0-9a-f]{16}$/);
    const reviews = store.listRetentionReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      reviewId: d.reviewId,
      trigger: "DENIAL",
      status: "PENDING",
      reason: "synthetic",
      source: { repo: "onyxgolden/marketplace409", path: "scripts/team-brain/README.md" },
      attribution: { principal: MUSE, actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
    });
  });

  it("double denial converges on one review", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const d1 = denySource(store, host, denialInput(), CALLER_MUSE);
    const d2 = denySource(store, host, denialInput(), CALLER_MUSE);
    expect(d1.result).toBe("DENIED");
    expect(d2.result).toBe("DENIED");
    expect(d2.reviewId).toBe(d1.reviewId);
    expect(store.listRetentionReviews()).toHaveLength(1);
  });

  it("double revocation converges on one review", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r1 = revokeSource(store, host, denialInput(), CALLER_MUSE);
    const r2 = revokeSource(store, host, denialInput(), CALLER_MUSE);
    expect(r1.result).toBe("REVOKED");
    expect(r2.result).toBe("REVOKED");
    expect(r2.reviewId).toBe(r1.reviewId);
    expect(store.listRetentionReviews()).toHaveLength(1);
  });

  it("repeated capture on a revoked source keeps one review", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    expect(revokeSource(store, host, denialInput(), CALLER_MUSE).result).toBe("REVOKED");
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).code).toBe(ENG_CODES.SOURCE_REVOKED);
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).code).toBe(ENG_CODES.SOURCE_REVOKED);
    expect(store.listRetentionReviews()).toHaveLength(1);
    expect(store.listRetentionReviews()[0].trigger).toBe("REVOCATION");
  });

  it("denial review-write failure keeps suppression and reports pending; retry completes", () => {
    const host = syntheticHost();
    const realStore = createFakeStore();
    let failWrites = true;
    const store = {
      ...realStore,
      ensureRetentionReview(...args) {
        if (failWrites) throw new Error("synthetic store failure");
        return realStore.ensureRetentionReview(...args);
      },
    };
    const d1 = denySource(store, host, denialInput(), CALLER_MUSE);
    expect(d1).toMatchObject({ result: "DENIED_REVIEW_PENDING", code: ENG_CODES.RETENTION_REVIEW_PENDING });
    expect(d1.reviewId).toMatch(/^rr-/);
    // Suppression is in force even though the review is pending.
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).code).toBe(ENG_CODES.DENIED_SOURCE);
    expect(store.listRetentionReviews()).toHaveLength(0);
    failWrites = false;
    const d2 = denySource(store, host, denialInput(), CALLER_MUSE);
    expect(d2.result).toBe("DENIED");
    expect(d2.reviewId).toBe(d1.reviewId);
    expect(store.listRetentionReviews()).toHaveLength(1);
  });

  it("revocation review-write failure keeps suppression and reports pending; retry completes", () => {
    const host = syntheticHost();
    const realStore = createFakeStore();
    let failWrites = true;
    const store = {
      ...realStore,
      ensureRetentionReview(...args) {
        if (failWrites) throw new Error("synthetic store failure");
        return realStore.ensureRetentionReview(...args);
      },
    };
    const r1 = revokeSource(store, host, denialInput(), CALLER_MUSE);
    expect(r1).toMatchObject({ result: "REVOKED_REVIEW_PENDING", code: ENG_CODES.RETENTION_REVIEW_PENDING });
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).code).toBe(ENG_CODES.SOURCE_REVOKED);
    failWrites = false;
    const r2 = revokeSource(store, host, denialInput(), CALLER_MUSE);
    expect(r2.result).toBe("REVOKED");
    expect(r2.reviewId).toBe(r1.reviewId);
    expect(store.listRetentionReviews()).toHaveLength(1);
  });

  it("denying a source with episodes preserves history and suppresses retrieval", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput(), CALLER_MUSE).result).toBe("CAPTURED");
    expect(
      captureEvent(
        store,
        host,
        validInput({
          eventId: "evt-deny-hist-synthetic",
          source: { ...validInput().source, pin: { algo: "git-blob-sha1", id: "b".repeat(40) } },
        }),
        CALLER_MUSE,
      ).result,
    ).toBe("CAPTURED");
    expect(denySource(store, host, denialInput(), CALLER_MUSE).result).toBe("DENIED");
    const r = recall(store, host, { kind: "FILED" });
    expect(r.results).toEqual([]);
    expect(r.suppressed).toBe(2);
    expect(store.episodeCount()).toBe(2);
  });
});
