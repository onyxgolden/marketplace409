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
import { EVENT_KEY_SPECS, assertHostConfig, assertPin } from "../schemas.mjs";
import { createFakeStore } from "../store.mjs";
import { captureEvent, denySource, revokeSource, episodeIdentity, episodeIdFor, MAX_ADMITTED_BYTES } from "../capture.mjs";
import { recall, MAX_CONSULTED_CANDIDATES, RECALL_RESULT_CAP } from "../recall.mjs";
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
    const r1 = captureEvent(s1, host, validInput());
    const r2 = captureEvent(s2, syntheticHost(), validInput());
    expect(r1.result).toBe("CAPTURED");
    expect(r1.episodeId).toBe(r2.episodeId);
    expect(r1.episodeId.startsWith("em-")).toBe(true);
  });

  it("exact replay is idempotent: one logical event (handoff AC-19 analogue)", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const first = captureEvent(store, host, validInput());
    // Simulate crash: drop the result, retry the identical input.
    const retry = captureEvent(store, host, validInput());
    expect(first.result).toBe("CAPTURED");
    expect(retry.result).toBe("DUPLICATE_REPLAY");
    expect(retry.episodeId).toBe(first.episodeId);
    expect(store.episodeCount()).toBe(1);
  });

  it("refuses the whole task when admitted bytes exceed 256KiB", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const r = captureEvent(store, host, validInput({ taskId: "x".repeat(300 * 1024) }));
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.ADMISSION_BUDGET_EXCEEDED });
    expect(store.episodeCount()).toBe(0);
    expect(MAX_ADMITTED_BYTES).toBe(262144);
  });

  it("refuses unapproved repo/path and unknown principal", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    expect(captureEvent(store, host, validInput({ source: { ...validInput().source, repo: "evil/corp" } })).code).toBe(
      ENG_CODES.UNAPPROVED_REPO,
    );
    expect(
      captureEvent(store, host, validInput({ source: { ...validInput().source, path: "secrets/x.env" } })).code,
    ).toBe(ENG_CODES.UNAPPROVED_PATH);
    expect(captureEvent(store, host, validInput({ principal: "principal:intruder" })).code).toBe(
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
    );
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.FORGED_AUTHORITY });
  });

  it("requires attribution: omitted attribution is refused", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const input = validInput();
    delete input.attribution;
    expect(captureEvent(store, host, input).code).toBe(ENG_CODES.MISSING_ATTRIBUTION);
  });

  it("denied sources refuse before any body read; revocation records a retention review", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const denial = denySource(store, host, {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      reason: "synthetic",
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      revokedAt: "2026-10-16T10:00:00Z",
    });
    expect(denial.result).toBe("DENIED");
    // Throwing sentinel on the denied source: still refused without invocation.
    const { input, invocations } = throwingGetter(validInput(), "source");
    const r = captureEvent(store, host, input);
    expect(r.code).toBe(ENG_CODES.ACCESSOR_REJECTED);
    expect(invocations()).toBe(0);

    const host2 = syntheticHost();
    const store2 = createFakeStore();
    const rev = revokeSource(store2, host2, {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      reason: "synthetic",
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      revokedAt: "2026-10-16T10:00:00Z",
    });
    expect(rev.result).toBe("REVOKED");
    const r2 = captureEvent(store2, host2, validInput());
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
    const r = denySource(store, host, {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      reason: "forged",
      attribution: { actor: "Intruder", authorityRef: "auth:self-issued:fake" },
      revokedAt: "2026-10-16T10:00:00Z",
    });
    expect(r).toMatchObject({ result: "REFUSED", code: ENG_CODES.FORGED_AUTHORITY });
    // Source not denied: capture still succeeds.
    expect(captureEvent(store, host, validInput()).result).toBe("CAPTURED");
  });

  it("refusal diagnostics carry codes and safe IDs only, never rejected values", () => {
    const host = syntheticHost();
    const store = createFakeStore();
    const canary = "CANARY_TENANT_9f2e7a";
    const r = captureEvent(store, host, validInput({ taskId: `prefix-${canary}-suffix` }));
    expect(r.code).toBe(ENG_CODES.PROHIBITED_DATA);
    expect(JSON.stringify(r)).not.toContain(canary);
  });
});

describe("recall", () => {
  function seededStore(n, host) {
    const store = createFakeStore();
    for (let i = 1; i <= n; i++) {
      const r = captureEvent(
        store,
        host,
        validInput({
          eventId: `evt-seed-${i}-synthetic`,
          taskId: `eng-task-${String(i).padStart(3, "0")}`,
          eventAt: `2026-10-${String(1 + (i % 15)).padStart(2, "0")}T08:00:00Z`,
          source: {
            repo: "onyxgolden/marketplace409",
            path: "scripts/team-brain/README.md",
            pin: { algo: "git-blob-sha1", id: createHash("sha256").update(`seed${i}`).digest("hex").slice(0, 40) },
          },
        }),
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
    captureEvent(store, host, validInput({ taskId: "eng-task-c1", status: "BLOCKED", kind: "BLOCKED" }));
    captureEvent(
      store,
      host,
      validInput({
        eventId: "evt-c2-synthetic",
        taskId: "eng-task-c1",
        status: "IN_PROGRESS",
        kind: "PROGRESS",
        eventAt: "2026-10-16T11:00:00Z",
      }),
    );
    const r = recall(store, host, { taskId: "eng-task-c1" });
    expect(r.results.filter((x) => x.conflict)).toHaveLength(2);
    expect(r.results[0].conflictWith).toHaveLength(1);
  });

  it("revoked sources are suppressed from retrieval, never deleted", () => {
    const host = syntheticHost();
    const store = seededStore(3, host);
    revokeSource(store, host, {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      reason: "synthetic",
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      revokedAt: "2026-10-16T10:00:00Z",
    });
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
    captureEvent(store, host, validInput());
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
    denySource(store, host, {
      repo: "onyxgolden/marketplace409",
      path: "scripts/team-brain/README.md",
      reason: "synthetic",
      attribution: { actor: "Muse", authorityRef: "auth:jason:eng-memory:1" },
      revokedAt: "2026-10-16T10:00:00Z",
    });
    const input = validInput();
    expect(captureEvent(store, host, input).code).toBe(ENG_CODES.DENIED_SOURCE);
    // Retry after "recovery": still refused, never admitted.
    expect(captureEvent(store, host, input).code).toBe(ENG_CODES.DENIED_SOURCE);
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
