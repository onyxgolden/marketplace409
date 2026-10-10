import { describe, expect, it } from "vitest";
import { createCoordinator } from "./coordinator.mjs";
import { createTrustedProvenanceRegistry, createTrustedChannelStore } from "./trusted.mjs";

// Property-style checks for the Coordinator prototype:
//  - Authorization NEVER increases when trusted records are removed or
//    revoked, or when evaluation time moves past a token's expiry. Trusted
//    records are consulted on every evaluation (nothing is cached).
//  - Evaluation is deterministic: same inputs, byte-identical output.

const NOW = "2026-10-10T12:00:00.000Z";
const LATER = "2026-10-12T12:00:00.000Z";
const HEAD = "head-aaa";

const TIER_RANK = { unknown: 0, jason_ratified_process: 1, cryptographically_authenticated: 2 };

let seq = 0;
function p(name) {
  seq += 1;
  return `synthetic/properties/${String(seq).padStart(3, "0")}-${name}`;
}

function ingestChain(coordinator, { withToken = true, withRegistryAuth = false } = {}) {
  coordinator.ingest({
    kind: "task",
    path: p("task.md"),
    task_id: "task-p",
    submittedBy: "Claude",
    scope: "merge",
    code_head_sha: HEAD,
  });
  coordinator.ingest({
    kind: "submission",
    path: p("submission.md"),
    task_id: "task-p",
    submittedBy: "Claude",
    code_head_sha: HEAD,
  });
  coordinator.ingest({
    kind: "review",
    path: p("review.md"),
    task_id: "task-p",
    submittedBy: "ChatGPT",
    review_round: 1,
    verdict: "go",
    code_head_sha: HEAD,
  });
  coordinator.ingest({
    kind: "agreement-check",
    path: p("agreement.md"),
    task_id: "task-p",
    submittedBy: "Muse",
    principal_id: "koe-sr",
    code_head_sha: HEAD,
    evidence_run_id: "run-agree-p",
    checks: { exact_head_match: true, tests_rerun_pass: true, zero_conflict_markers: true, files_in_scope: true },
  });
  if (withRegistryAuth) {
    coordinator.ingest({
      kind: "authorization",
      path: p("jason-auth.md"),
      task_id: "task-p",
      submittedBy: "Jason",
      code_head_sha: HEAD,
      authorization_id: "auth-p",
    });
  }
  return withToken || withRegistryAuth;
}

function baseToken() {
  return {
    token_id: "tok-p",
    issuer: "jason-muse-channel",
    principal: "jason",
    authorized_relay: "muse",
    scope: "merge",
    task_id: "task-p",
    code_head_sha: HEAD,
    issued_at: "2026-10-10T00:00:00.000Z",
    expires_at: "2026-10-11T00:00:00.000Z",
    revocable: true,
    revoked: false,
  };
}

function authorizationLevel(out) {
  // A coarse monotone scale: merge_eligible > jason_authorized > neither.
  if (out.flags.merge_eligible) return 2;
  if (out.flags.jason_authorized) return 1;
  return 0;
}

describe("property: authorization never increases when trusted records are removed or revoked", () => {
  it("token path: revoke / remove / expire each only ever decrease authorization", () => {
    // expectJasonAuthorizedAfter: removing the *agreement* attestation
    // cannot touch Jason's own authorization (the token still stands) --
    // it only destroys merge eligibility. Every other mutation destroys
    // the authorization itself. In all cases authorization never increases.
    const mutations = {
      "revoke token": { run: ({ channelStore }) => channelStore.revokeToken("tok-p"), expectJasonAuthorizedAfter: false },
      "remove token": { run: ({ channelStore }) => channelStore.removeToken("tok-p"), expectJasonAuthorizedAfter: false },
      "remove agreement attestation": { run: ({ registry }) => registry.remove("run-agree-p"), expectJasonAuthorizedAfter: true },
      "evaluate after expiry": { run: () => {}, expectJasonAuthorizedAfter: false },
    };

    for (const [name, { run: mutate, expectJasonAuthorizedAfter }] of Object.entries(mutations)) {
      const registry = createTrustedProvenanceRegistry([
        { run_id: "run-agree-p", principal_id: "koe-sr", attested_at: "2026-10-10T01:00:00.000Z" },
      ]);
      const channelStore = createTrustedChannelStore([baseToken()]);
      const coordinator = createCoordinator({ registry, channelStore });
      ingestChain(coordinator);

      const before = coordinator.evaluate("task-p", { now: NOW });
      expect(before.flags.jason_authorized, name).toBe(true);
      expect(before.flags.merge_eligible, name).toBe(true);

      mutate({ registry, channelStore });
      const afterNow = name === "evaluate after expiry" ? LATER : NOW;
      const after = coordinator.evaluate("task-p", { now: afterNow });

      expect(authorizationLevel(after), name).toBeLessThanOrEqual(authorizationLevel(before));
      expect(TIER_RANK[after.provenance], name).toBeLessThanOrEqual(TIER_RANK[before.provenance]);
      expect(after.flags.jason_authorized, name).toBe(expectJasonAuthorizedAfter);
      expect(after.flags.merge_eligible, name).toBe(false);
    }
  });

  it("registry path: removing the registry attestation removes authorization", () => {
    const registry = createTrustedProvenanceRegistry([
      { run_id: "run-agree-p", principal_id: "koe-sr", attested_at: "2026-10-10T01:00:00.000Z" },
      { authorization_id: "auth-p", principal_id: "jason", attested_at: "2026-10-10T01:00:00.000Z" },
    ]);
    const channelStore = createTrustedChannelStore([]);
    const coordinator = createCoordinator({ registry, channelStore });
    ingestChain(coordinator, { withRegistryAuth: true, withToken: false });

    const before = coordinator.evaluate("task-p", { now: NOW });
    expect(before.provenance).toBe("cryptographically_authenticated");
    expect(before.flags.jason_authorized).toBe(true);
    expect(before.flags.merge_eligible).toBe(true);

    registry.remove("auth-p");
    const after = coordinator.evaluate("task-p", { now: NOW });
    expect(after.flags.jason_authorized).toBe(false);
    expect(after.flags.merge_eligible).toBe(false);
    expect(TIER_RANK[after.provenance]).toBeLessThan(TIER_RANK[before.provenance]);
  });

  it("expiry is checked on every evaluation, never cached", () => {
    const registry = createTrustedProvenanceRegistry([
      { run_id: "run-agree-p", principal_id: "koe-sr", attested_at: "2026-10-10T01:00:00.000Z" },
    ]);
    const channelStore = createTrustedChannelStore([baseToken()]);
    const coordinator = createCoordinator({ registry, channelStore });
    ingestChain(coordinator);

    const t1 = coordinator.evaluate("task-p", { now: NOW });
    const t2 = coordinator.evaluate("task-p", { now: LATER });
    const t3 = coordinator.evaluate("task-p", { now: NOW });
    expect(t1.flags.jason_authorized).toBe(true);
    expect(t2.flags.jason_authorized).toBe(false);
    // Re-evaluating at the earlier time reproduces the earlier result:
    // evaluation is a pure function of (artifacts, stores, now).
    expect(t3).toEqual(t1);
  });
});

describe("property: deterministic classification", () => {
  it("same inputs produce identical output across repeated evaluations", () => {
    const registry = createTrustedProvenanceRegistry([
      { run_id: "run-agree-p", principal_id: "koe-sr", attested_at: "2026-10-10T01:00:00.000Z" },
    ]);
    const channelStore = createTrustedChannelStore([baseToken()]);
    const coordinator = createCoordinator({ registry, channelStore });
    ingestChain(coordinator);

    const first = coordinator.evaluate("task-p", { now: NOW, live_code_head_sha: HEAD });
    for (let i = 0; i < 5; i += 1) {
      expect(coordinator.evaluate("task-p", { now: NOW, live_code_head_sha: HEAD })).toEqual(first);
    }
  });

  it("unknown task fails closed with unknown provenance", () => {
    const coordinator = createCoordinator({
      registry: createTrustedProvenanceRegistry(),
      channelStore: createTrustedChannelStore(),
    });
    const out = coordinator.evaluate("task-never-registered", { now: NOW });
    expect(out.provenance).toBe("unknown");
    expect(out.provenance_label).toBe("authorization provenance unknown");
    expect(out.flags.jason_authorized).toBe(false);
    expect(out.flags.agreement_check_passed).toBe(false);
    expect(out.flags.merge_eligible).toBe(false);
  });
});
