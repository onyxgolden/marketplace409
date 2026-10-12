/**
 * kvp-fixes.test.js — regression tests for the KVP-001..KVP-004 review
 * blockers. Each test names the blocker it guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";
import { makeBudget, BudgetError, resolveSourceRef, BUDGET_LIMITS } from "../src/resolver.js";
import { authenticateRecord } from "../src/supersession.js";
import { validateContext } from "../src/schemas.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

const CLOCK = Date.parse("2026-10-12T12:00:00Z");

function baseCtx() {
  return {
    clock: CLOCK,
    vocabulary,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
}

function task(query, extra = {}) {
  return {
    query,
    query_key: null,
    filters: { source_tags: [], as_of_date: null, max_source_age_days: null },
    requested_action: "answer",
    source_pin: null,
    ...extra,
  };
}

function gitBlobId(text) {
  return createHash("sha1").update(`blob ${Buffer.byteLength(text, "utf8")}\0${text}`, "utf8").digest("hex");
}

function pinFor(sourceKey, label) {
  const [repo, path] = sourceKey.split("|");
  const revs = store.sources[sourceKey].revisions;
  const commit = Object.keys(revs).find((c) => revs[c].revision === label);
  const rev = revs[commit];
  return { repo, path, commit, blob: gitBlobId(rev.text), algorithm: "git-sha1", revision: rev.revision };
}

// ---------- KVP-001: authority coverage is ALL-subset, not ANY-overlap ----------

test("KVP-001: record with a scope outside steward authority fails closed", () => {
  const ctx = baseCtx();
  const budget = makeBudget();
  const record = {
    record_id: "sup-partial",
    issuer: "steward-ops",
    old_ref: pinFor("vault|facilities/generator.md", "rev-1"),
    new_ref: pinFor("vault|facilities/generator.md", "rev-2"),
    effective_at: "2026-06-01T00:00:00Z",
    scope_ids: ["facilities", "finance"], // finance not in steward-ops authority
    registration_ref: "reg-001",
  };
  const { authenticated, flags } = authenticateRecord(record, ctx, CLOCK, budget);
  assert.equal(authenticated, false);
  assert.match(flags[0].reason, /no authority over record scope/);
});

test("KVP-001: record outside registration applicability fails closed", () => {
  const ctx = baseCtx();
  const budget = makeBudget();
  const record = store.supersessionRecords.find((r) => r.record_id === "sup-022");
  const { authenticated, flags } = authenticateRecord(record, ctx, CLOCK, budget);
  assert.equal(authenticated, false);
  assert.match(flags[0].reason, /applicability does not cover/);
});

test("KVP-001: fully-covered record still authenticates", () => {
  const ctx = baseCtx();
  const budget = makeBudget();
  const record = store.supersessionRecords.find((r) => r.record_id === "sup-020");
  const { authenticated } = authenticateRecord(record, ctx, CLOCK, budget);
  assert.equal(authenticated, true);
});

// ---------- KVP-002: unique stable claim IDs; same-source conflicts ----------

test("KVP-002: claim IDs are unique per fact and stable across runs", () => {
  const r1 = run(task("What is the boiler mode?"), baseCtx());
  const r2 = run(task("What is the boiler mode?"), baseCtx());
  assert.equal(r1.status, "ANSWERED");
  assert.equal(r1.claims.length, 3);
  const ids1 = r1.claims.map((c) => c.claim_id).sort();
  const ids2 = r2.claims.map((c) => c.claim_id).sort();
  assert.equal(new Set(ids1).size, 3, "three facts must have three distinct IDs");
  assert.deepEqual(ids1, ids2, "IDs must be stable across runs");
});

test("KVP-002: same-source contradiction cites both spans and asserts no winner", () => {
  const r = run(task("What is the chiller mode?"), baseCtx());
  assert.equal(r.contradiction_count, 1);
  assert.equal(r.confidence, "LOW");
  const [contra] = r.contradictions;
  assert.equal(contra.source_a, contra.source_b, "same-source conflict is detected");
  assert.notEqual(contra.span_a.quoted_text, contra.span_b.quoted_text, "both exact spans cited");
  assert.match(r.answer_text, /disagree/);
  assert.equal(r.complete, false);
});

// ---------- KVP-003: ledger dates validated; coverage gaps reduce confidence ----------

test("KVP-003: invalid ledger effective_at refuses as INVALID_INPUT", () => {
  const evil = JSON.parse(JSON.stringify(store));
  const wifiKey = "vault|handbook/wifi.md";
  const rev1 = Object.keys(evil.sources[wifiKey].revisions)[0];
  evil.sources[wifiKey].revisions[rev1].effective_at = "not-a-date";
  const r = run(task("What is the wifi password?"), { ...baseCtx(), sources: evil.sources });
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["INVALID_INPUT"]);
});

test("KVP-003: missing ledger effective_at refuses as INVALID_INPUT", () => {
  const evil = JSON.parse(JSON.stringify(store));
  const wifiKey = "vault|handbook/wifi.md";
  const rev1 = Object.keys(evil.sources[wifiKey].revisions)[0];
  delete evil.sources[wifiKey].revisions[rev1].effective_at;
  const r = run(task("What is the wifi password?"), { ...baseCtx(), sources: evil.sources });
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["INVALID_INPUT"]);
});

test("KVP-003: good source + fork-ambiguous source answers LOW and incomplete", () => {
  // Synthetic mixed context: good.md answers cleanly; forked.md has two
  // competing supersession records (a fork), so its coverage is a real gap.
  const claimLine = (key, value) => `claim: ${key} = ${value}; units: state; scopes: facilities`;
  const mkRev = (text) => ({
    blob: gitBlobId(text),
    revision: "rev-1",
    text,
    effective_at: "2026-01-01T00:00:00Z",
    verified_at: "2026-01-02T00:00:00Z",
    algorithm: "git-sha1",
  });
  const goodText = ["# Good", claimLine("mixed-key", "alpha"), ""].join("\n");
  const fork1Text = ["# Forked", claimLine("mixed-key", "beta"), ""].join("\n");
  const forkXText = ["# Forked", claimLine("mixed-key", "gamma"), ""].join("\n");
  const forkYText = ["# Forked", claimLine("mixed-key", "delta"), ""].join("\n");
  const c = (t) => createHash("sha256").update(t, "utf8").digest("hex").slice(0, 40);
  const [cg, c1, cx, cy] = [c(goodText), c(fork1Text), c(forkXText), c(forkYText)];
  const sref = (commit, text) => ({ repo: "vault", path: "t/forked.md", commit, blob: gitBlobId(text), algorithm: "git-sha1", revision: "rev-1" });
  const forkRecords = [
    {
      record_id: "sup-f1", issuer: "steward-1",
      old_ref: sref(c1, fork1Text),
      new_ref: sref(cx, forkXText),
      effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
    },
    {
      record_id: "sup-f2", issuer: "steward-1",
      old_ref: sref(c1, fork1Text),
      new_ref: sref(cy, forkYText),
      effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
    },
  ];
  const ctx = {
    clock: CLOCK,
    vocabulary: [{ query_key: "mixed-key", phrases: ["mixed probe"] }],
    sources: {
      "vault|t/good.md": { repo: "vault", path: "t/good.md", tags: [], claim_keys: ["mixed-key"], revisions: { [cg]: mkRev(goodText) } },
      "vault|t/forked.md": {
        repo: "vault", path: "t/forked.md", tags: [], claim_keys: ["mixed-key"],
        revisions: { [c1]: mkRev(fork1Text), [cx]: mkRev(forkXText), [cy]: mkRev(forkYText) },
      },
    },
    readGrants: [
      { repo: "vault", path: "t/good.md" },
      { repo: "vault", path: "t/forked.md" },
    ],
    stewards: [{ steward_id: "steward-1", registered_by: "jason", authority_scope_ids: ["facilities"], valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }],
    registrations: [{
      registration_ref: "reg-1", steward_id: "steward-1", action_ids: ["supersede"],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
      applicability: {
        scope_ids: ["facilities"], source_keys: ["vault|t/forked.md"],
        transitions: forkRecords.map((r) => ({ old_ref: r.old_ref, new_ref: r.new_ref })),
      },
    }],
    supersessionRecords: forkRecords,
  };
  const r = run(task("mixed probe"), ctx);
  assert.equal(r.status, "ANSWERED");
  assert.equal(r.claims.length, 1, "only the good source's claim survives");
  assert.match(r.claims[0].text, /alpha/);
  assert.equal(r.confidence, "LOW", "the fork's coverage gap reduces confidence");
  assert.equal(r.complete, false, "completeness reflects the missing coverage");
  assert.ok(r.diagnostics.some((d) => d.code === "STALE_EVIDENCE" && d.reducesConfidence === true));
});

// ---------- KVP-004: everything consulted is budgeted; BudgetError never swallowed ----------

test("KVP-004: payload budget trips exactly past the limit", () => {
  const budget = makeBudget();
  budget.countPayload("x".repeat(BUDGET_LIMITS.maxPayloadBytes), "exact");
  assert.throws(() => budget.countPayload("x", "one-more"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("KVP-004: pinned source text at the payload limit resolves; one byte over refuses", () => {
  const mkSource = (text) => {
    const commit = "a".repeat(40);
    return {
      sources: {
        "vault|t/big.md": {
          revisions: {
            [commit]: { blob: gitBlobId(text), revision: "rev-1", text, effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1" },
          },
        },
      },
      ref: { repo: "vault", path: "t/big.md", commit, blob: gitBlobId(text), algorithm: "git-sha1", revision: "rev-1" },
    };
  };
  const ok = mkSource("x".repeat(BUDGET_LIMITS.maxPayloadBytes));
  resolveSourceRef(ok.ref, ok.sources, makeBudget()); // must not throw
  const over = mkSource("x".repeat(BUDGET_LIMITS.maxPayloadBytes + 1));
  assert.throws(() => resolveSourceRef(over.ref, over.sources, makeBudget()), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("KVP-004: denied source bytes are never read (accessor spy)", () => {
  const deniedKey = "vault|restricted/exec.md";
  const evilSources = {};
  let accessed = false;
  for (const [k, entry] of Object.entries(store.sources)) {
    const revs = {};
    for (const [cm, rev] of Object.entries(entry.revisions)) {
      const { text, ...meta } = rev;
      revs[cm] = { ...meta };
      if (k === deniedKey) {
        Object.defineProperty(revs[cm], "text", {
          get() { accessed = true; return text; },
          enumerable: true, configurable: true,
        });
      } else {
        revs[cm].text = text;
      }
    }
    evilSources[k] = { ...entry, revisions: revs };
  }
  const r = run(task("What is the board meeting cadence?"), { ...baseCtx(), sources: evilSources });
  assert.equal(accessed, false, "denied source text must never be accessed");
  assert.ok(r.diagnostics.some((d) => d.code === "READ_DENIED"));
});

test("KVP-004: object exhaustion during supersession refuses, no partial answer", () => {
  // 40 chained records = 80 pin resolutions > 64 object budget.
  const N = 40;
  const texts = [];
  for (let i = 0; i <= N; i++) {
    texts.push(["# Chain", `claim: chain-key = v${i}; units: state; scopes: facilities`, ""].join("\n"));
  }
  const commits = texts.map((t) => createHash("sha256").update(`chain${t}`, "utf8").digest("hex").slice(0, 40));
  const revisions = {};
  texts.forEach((t, i) => {
    revisions[commits[i]] = {
      blob: gitBlobId(t), revision: `rev-${i}`, text: t,
      effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1",
    };
  });
  const sref = (i) => ({ repo: "vault", path: "t/chain.md", commit: commits[i], blob: gitBlobId(texts[i]), algorithm: "git-sha1", revision: `rev-${i}` });
  const records = [];
  for (let i = 0; i < N; i++) {
    records.push({
      record_id: `sup-c${i}`, issuer: "steward-1",
      old_ref: sref(i), new_ref: sref(i + 1),
      effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
    });
  }
  const ctx = {
    clock: CLOCK,
    vocabulary: [{ query_key: "chain-key", phrases: ["chain probe"] }],
    sources: { "vault|t/chain.md": { repo: "vault", path: "t/chain.md", tags: [], claim_keys: ["chain-key"], revisions } },
    readGrants: [{ repo: "vault", path: "t/chain.md" }],
    stewards: [{ steward_id: "steward-1", registered_by: "jason", authority_scope_ids: ["facilities"], valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }],
    registrations: [{
      registration_ref: "reg-1", steward_id: "steward-1", action_ids: ["supersede"],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
      applicability: {
        scope_ids: ["facilities"], source_keys: ["vault|t/chain.md"],
        transitions: records.map((r) => ({ old_ref: r.old_ref, new_ref: r.new_ref })),
      },
    }],
    supersessionRecords: records,
  };
  const r = run(task("chain probe"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["BUDGET_EXCEEDED"]);
  assert.equal(r.claims.length, 0, "no partial answer after exhaustion");
  assert.equal(r.complete, false);
});

test("KVP-004: span exhaustion during retrieval refuses, no partial answer", () => {
  // 600 claims > 512 span budget.
  const lines = ["# Spans"];
  for (let i = 0; i < 600; i++) {
    lines.push(`claim: span-key = value${i}; units: state; scopes: facilities`);
  }
  lines.push("");
  const text = lines.join("\n");
  const commit = "b".repeat(40);
  const ctx = {
    clock: CLOCK,
    vocabulary: [{ query_key: "span-key", phrases: ["span probe"] }],
    sources: {
      "vault|t/spans.md": {
        repo: "vault", path: "t/spans.md", tags: [], claim_keys: ["span-key"],
        revisions: {
          [commit]: { blob: gitBlobId(text), revision: "rev-1", text, effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1" },
        },
      },
    },
    readGrants: [{ repo: "vault", path: "t/spans.md" }],
    stewards: [],
    registrations: [],
    supersessionRecords: [],
  };
  const r = run(task("span probe"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["BUDGET_EXCEEDED"]);
  assert.equal(r.claims.length, 0, "no partial answer after exhaustion");
  assert.equal(r.complete, false);
});

// ---------- KVP-001 round 3: per-fact ALL-scope coverage; exact transition binding ----------

function kvp1r3Ctx({ stewardScopes, recordScopes, factScopes, recordId = "sup-t1" }) {
  const claimLine = `claim: t1-key = v1; units: state; scopes: ${factScopes.join(",")}`;
  const text1 = ["# T1 rev1", claimLine, ""].join("\n");
  const text2 = ["# T1 rev2", claimLine, ""].join("\n");
  const c1 = createHash("sha256").update(`t1a${text1}`, "utf8").digest("hex").slice(0, 40);
  const c2 = createHash("sha256").update(`t1b${text2}`, "utf8").digest("hex").slice(0, 40);
  const mkRev = (t, eff) => ({
    blob: gitBlobId(t), revision: "rev-1", text: t,
    effective_at: eff, verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1",
  });
  const oldRef = { repo: "vault", path: "t/t1.md", commit: c1, blob: gitBlobId(text1), algorithm: "git-sha1", revision: "rev-1" };
  const newRef = { repo: "vault", path: "t/t1.md", commit: c2, blob: gitBlobId(text2), algorithm: "git-sha1", revision: "rev-2" };
  const record = {
    record_id: recordId, issuer: "steward-1",
    old_ref: oldRef, new_ref: newRef,
    effective_at: "2026-06-01T00:00:00Z", scope_ids: recordScopes, registration_ref: "reg-1",
  };
  return {
    clock: CLOCK,
    vocabulary: [{ query_key: "t1-key", phrases: ["t1 probe"] }],
    sources: {
      "vault|t/t1.md": {
        repo: "vault", path: "t/t1.md", tags: [], claim_keys: ["t1-key"],
        revisions: { [c1]: mkRev(text1, "2026-01-01T00:00:00Z"), [c2]: mkRev(text2, "2026-06-01T00:00:00Z") },
      },
    },
    readGrants: [{ repo: "vault", path: "t/t1.md" }],
    stewards: [{ steward_id: "steward-1", registered_by: "jason", authority_scope_ids: stewardScopes, valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }],
    registrations: [{
      registration_ref: "reg-1", steward_id: "steward-1", action_ids: ["supersede"],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
      applicability: {
        scope_ids: stewardScopes, source_keys: ["vault|t/t1.md"],
        transitions: [{ old_ref: oldRef, new_ref: newRef }],
      },
    }],
    supersessionRecords: [record],
  };
}

test("KVP-001r3: mixed-scope fact (authorized + unauthorized scope) is not quoted HIGH", () => {
  // Probe replication: steward holds [facilities], record covers [facilities],
  // fact names [facilities, finance]. Finance is outside the authenticated
  // authority -> the fact must be excluded in full, never HIGH.
  const ctx = kvp1r3Ctx({ stewardScopes: ["facilities"], recordScopes: ["facilities"], factScopes: ["facilities", "finance"] });
  const r = run(task("t1 probe"), ctx);
  assert.equal(r.claims.length, 0, "mixed-scope fact must not be emitted");
  assert.ok(r.diagnostics.some((d) => d.code === "SCOPE_NOT_COVERED" && d.reducesConfidence === true));
  assert.equal(r.confidence, "LOW");
  assert.equal(r.complete, false);
  assert.ok(!r.answer_text.includes("v1"), "uncovered value must not be quoted");
});

test("KVP-001r3: fully-covered fact is emitted HIGH", () => {
  // Steward holds [facilities, site-a]; fact names [facilities, site-a].
  // Every fact scope is inside the authenticated authority -> emitted.
  const ctx = kvp1r3Ctx({ stewardScopes: ["facilities", "site-a"], recordScopes: ["facilities"], factScopes: ["facilities", "site-a"] });
  const r = run(task("t1 probe"), ctx);
  assert.equal(r.status, "ANSWERED");
  assert.equal(r.claims.length, 1);
  assert.match(r.claims[0].text, /scopes: facilities,site-a/);
  assert.equal(r.confidence, "HIGH");
  assert.equal(r.complete, true);
});

test("KVP-001r3: record pins not matching a declared transition fail closed", () => {
  // Registration declares transition A->A. Record claims A->B (different
  // new pin). Source keys match, but the exact transition is not declared.
  const ctx = kvp1r3Ctx({ stewardScopes: ["facilities"], recordScopes: ["facilities"], factScopes: ["facilities"] });
  const otherText = ["# Other", "claim: t1-key = v2; units: state; scopes: facilities", ""].join("\n");
  const c2 = createHash("sha256").update(`t1x${otherText}`, "utf8").digest("hex").slice(0, 40);
  ctx.sources["vault|t/t1.md"].revisions[c2] = {
    blob: gitBlobId(otherText), revision: "rev-2", text: otherText,
    effective_at: "2026-07-01T00:00:00Z", verified_at: "2026-07-02T00:00:00Z", algorithm: "git-sha1",
  };
  const evilRecord = {
    record_id: "sup-evil", issuer: "steward-1",
    old_ref: ctx.supersessionRecords[0].old_ref,
    new_ref: { repo: "vault", path: "t/t1.md", commit: c2, blob: gitBlobId(otherText), algorithm: "git-sha1", revision: "rev-2" },
    effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
  };
  ctx.supersessionRecords = [evilRecord];
  const budget = makeBudget();
  const vctx = validateContext(ctx, budget);
  const { authenticated, flags } = authenticateRecord(evilRecord, vctx, CLOCK, budget);
  assert.equal(authenticated, false);
  assert.match(flags[0].reason, /no exact transition matching/);
});

// ---------- KVP-003 round 3: hash/verification failures are coverage gaps ----------

function kvp3r3Ctx() {
  const claimLine = "claim: t3-key = v1; units: state; scopes: facilities";
  const goodText = ["# Good", claimLine, ""].join("\n");
  const badText = ["# Bad copy", claimLine, ""].join("\n");
  const cg = createHash("sha256").update(`t3g${goodText}`, "utf8").digest("hex").slice(0, 40);
  const cb = createHash("sha256").update(`t3b${badText}`, "utf8").digest("hex").slice(0, 40);
  const mkRev = (t, blob) => ({
    blob: blob ?? gitBlobId(t), revision: "rev-1", text: t,
    effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1",
  });
  return {
    clock: CLOCK,
    vocabulary: [{ query_key: "t3-key", phrases: ["t3 probe"] }],
    sources: {
      "vault|t/good.md": { repo: "vault", path: "t/good.md", tags: [], claim_keys: ["t3-key"], revisions: { [cg]: mkRev(goodText) } },
      // Bad copy: valid shape, but the registered blob is all zeros —
      // recomputation fails with HASH_MISMATCH.
      "vault|t/bad.md": { repo: "vault", path: "t/bad.md", tags: [], claim_keys: ["t3-key"], revisions: { [cb]: mkRev(badText, "0".repeat(40)) } },
    },
    readGrants: [{ repo: "vault", path: "t/good.md" }, { repo: "vault", path: "t/bad.md" }],
    stewards: [],
    registrations: [],
    supersessionRecords: [],
  };
}

test("KVP-003r3: good source + hash-mismatched source answers LOW and incomplete", () => {
  // Probe replication: the bad copy's revision fails blob verification.
  // The good source's claim survives, but required relevant evidence
  // could not be verified -> LOW, complete:false.
  const r = run(task("t3 probe"), kvp3r3Ctx());
  assert.equal(r.status, "ANSWERED");
  assert.equal(r.claims.length, 1, "only the good source's claim survives");
  assert.match(r.claims[0].text, /v1/);
  assert.ok(r.diagnostics.some((d) => d.code === "HASH_MISMATCH" && d.reducesConfidence === true),
    "hash failure must be marked as a coverage gap");
  assert.equal(r.confidence, "LOW", "unverified relevant evidence reduces confidence");
  assert.equal(r.complete, false, "completeness reflects the missing coverage");
});

test("KVP-003r3: pinned source that fails verification is a coverage gap", () => {
  // Explicit pin to a revision whose blob does not match -> the pin names
  // explicitly requested evidence; its failure is a relevant gap.
  const ctx = kvp3r3Ctx();
  const badKey = "vault|t/bad.md";
  const cb = Object.keys(ctx.sources[badKey].revisions)[0];
  const pinTask = task("t3 probe", {
    source_pin: { repo: "vault", path: "t/bad.md", commit: cb, blob: "0".repeat(40), algorithm: "git-sha1", revision: "rev-1" },
  });
  const r = run(pinTask, ctx);
  assert.ok(r.diagnostics.some((d) => (d.code === "HASH_MISMATCH" || d.code === "SOURCE_UNVERIFIED") && d.reducesConfidence === true));
  assert.equal(r.confidence, "LOW");
  assert.equal(r.complete, false);
});

test("KVP-003r3: irrelevant filtered source is not a coverage gap", () => {
  // A source filtered out by tags leaves no diagnostic and does not
  // reduce confidence: it was never relevant.
  const ctx = kvp3r3Ctx();
  ctx.sources["vault|t/bad.md"].tags = ["other"];
  const r = run(task("t3 probe", { filters: { source_tags: ["official"], as_of_date: null, max_source_age_days: null } }), {
    ...ctx,
    sources: {
      "vault|t/good.md": { ...ctx.sources["vault|t/good.md"], tags: ["official"] },
      "vault|t/bad.md": ctx.sources["vault|t/bad.md"],
    },
  });
  assert.equal(r.status, "ANSWERED");
  assert.equal(r.claims.length, 1);
  assert.equal(r.confidence, "HIGH", "filtered-out source is not a gap");
  assert.equal(r.complete, true);
});

// ---------- KVP-004 round 3: byte accounting; denied-pin resolution order ----------

function kvp4r3MinimalCtx(actionId) {
  const text = ["# M", "claim: t4-key = v1; units: state; scopes: facilities", ""].join("\n");
  const c1 = createHash("sha256").update(`t4${text}`, "utf8").digest("hex").slice(0, 40);
  return {
    clock: CLOCK,
    vocabulary: [{ query_key: "t4-key", phrases: ["t4 probe"] }],
    sources: {
      "vault|t/m.md": {
        repo: "vault", path: "t/m.md", tags: [], claim_keys: ["t4-key"],
        revisions: {
          [c1]: { blob: gitBlobId(text), revision: "rev-1", text, effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1" },
        },
      },
    },
    readGrants: [{ repo: "vault", path: "t/m.md" }],
    stewards: [{ steward_id: "steward-1", registered_by: "jason", authority_scope_ids: ["facilities"], valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }],
    registrations: [{
      registration_ref: "reg-1", steward_id: "steward-1", action_ids: [actionId],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
    }],
    supersessionRecords: [],
  };
}

test("KVP-004r3: 400KB action ID in a registration trips INPUT_LIMIT", () => {
  // Probe replication: a valid-shape registration carrying a 400,000-char
  // action ID must not ride in on a 1-object consulted charge.
  const r = run(task("t4 probe"), kvp4r3MinimalCtx("x".repeat(400000)));
  assert.equal(r.status, "REFUSED");
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["INPUT_LIMIT"]);
  assert.equal(r.complete, false);
  assert.equal(r.claims.length, 0, "no partial answer");
});

test("KVP-004r3: registry payload at exact byte limit passes; one byte over refuses", () => {
  // Deterministic boundary at the validateContext level, where the
  // metadata byte accounting happens: measure the baseline registry
  // payload, then size the action ID so the total lands exactly on the
  // limit. countPayload throws only when strictly over the limit.
  const baselineCtx = kvp4r3MinimalCtx("x");
  const b0 = makeBudget();
  validateContext(baselineCtx, b0);
  const baseline = b0.used.payloadBytes;
  // Replacing the 1-char action ID with length L changes the total by
  // (L - 1) content bytes (JSON string framing is constant).
  const L = BUDGET_LIMITS.maxPayloadBytes - baseline + 1;
  assert.ok(L > 100, "sanity: boundary is far above the baseline");

  const b1 = makeBudget();
  validateContext(kvp4r3MinimalCtx("x".repeat(L)), b1);
  assert.equal(b1.used.payloadBytes, BUDGET_LIMITS.maxPayloadBytes, "exact-limit payload is accepted");

  const b2 = makeBudget();
  assert.throws(
    () => validateContext(kvp4r3MinimalCtx("x".repeat(L + 1)), b2),
    (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT",
    "one byte over the limit must refuse"
  );
});

function kvp4r3DeniedPinCtx({ denyOld, denyNew }) {
  const textOld = ["# Old", "claim: t5-key = v1; units: state; scopes: it", ""].join("\n");
  const textNew = ["# New", "claim: t5-key = v2; units: state; scopes: it", ""].join("\n");
  const cOld = createHash("sha256").update(`t5o${textOld}`, "utf8").digest("hex").slice(0, 40);
  const cNew = createHash("sha256").update(`t5n${textNew}`, "utf8").digest("hex").slice(0, 40);
  let oldAccesses = 0;
  let newAccesses = 0;
  const revOld = {
    blob: gitBlobId(textOld), revision: "rev-1",
    effective_at: "2026-01-01T00:00:00Z", verified_at: "2026-01-02T00:00:00Z", algorithm: "git-sha1",
  };
  const revNew = {
    blob: gitBlobId(textNew), revision: "rev-2",
    effective_at: "2026-06-01T00:00:00Z", verified_at: "2026-06-02T00:00:00Z", algorithm: "git-sha1",
  };
  Object.defineProperty(revOld, "text", { get() { oldAccesses++; return textOld; }, enumerable: true, configurable: true });
  Object.defineProperty(revNew, "text", { get() { newAccesses++; return textNew; }, enumerable: true, configurable: true });
  const oldRef = { repo: "vault", path: "t/old.md", commit: cOld, blob: gitBlobId(textOld), algorithm: "git-sha1", revision: "rev-1" };
  const newRef = { repo: "vault", path: "t/new.md", commit: cNew, blob: gitBlobId(textNew), algorithm: "git-sha1", revision: "rev-2" };
  const record = {
    record_id: "sup-d1", issuer: "steward-1", old_ref: oldRef, new_ref: newRef,
    effective_at: "2026-06-01T00:00:00Z", scope_ids: ["it"], registration_ref: "reg-1",
  };
  const grants = [{ repo: "vault", path: "t/old.md" }, { repo: "vault", path: "t/new.md" }];
  const filtered = grants.filter((g) => !((denyOld && g.path === "t/old.md") || (denyNew && g.path === "t/new.md")));
  const ctx = {
    clock: CLOCK,
    vocabulary: [{ query_key: "t5-key", phrases: ["t5 probe"] }],
    sources: {
      "vault|t/old.md": { repo: "vault", path: "t/old.md", tags: [], claim_keys: ["t5-key"], revisions: { [cOld]: revOld } },
      "vault|t/new.md": { repo: "vault", path: "t/new.md", tags: [], claim_keys: ["t5-key"], revisions: { [cNew]: revNew } },
    },
    readGrants: filtered,
    stewards: [{ steward_id: "steward-1", registered_by: "jason", authority_scope_ids: ["it"], valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false }],
    registrations: [{
      registration_ref: "reg-1", steward_id: "steward-1", action_ids: ["supersede"],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
      applicability: { scope_ids: ["it"], source_keys: ["vault|t/old.md", "vault|t/new.md"], transitions: [{ old_ref: oldRef, new_ref: newRef }] },
    }],
    supersessionRecords: [record],
  };
  return { ctx, record, counts: () => ({ oldAccesses, newAccesses }) };
}

test("KVP-004r3: denied replacement pin text is never accessed", () => {
  // Probe replication: the new_ref has no read grant. authenticateRecord
  // must check the grant BEFORE resolving, so the denied bytes are never
  // read or hashed — zero text accesses.
  const { ctx, record, counts } = kvp4r3DeniedPinCtx({ denyOld: false, denyNew: true });
  const budget = makeBudget();
  const vctx = validateContext(ctx, budget);
  const { authenticated, flags } = authenticateRecord(record, vctx, CLOCK, budget);
  assert.equal(authenticated, false);
  assert.match(flags[0].reason, /read permission denied for replacement/);
  assert.deepEqual(counts(), { oldAccesses: 0, newAccesses: 0 }, "denied pin bytes must never be touched");
});

test("KVP-004r3: denied superseded pin text is never accessed", () => {
  const { ctx, record, counts } = kvp4r3DeniedPinCtx({ denyOld: true, denyNew: false });
  const budget = makeBudget();
  const vctx = validateContext(ctx, budget);
  const { authenticated, flags } = authenticateRecord(record, vctx, CLOCK, budget);
  assert.equal(authenticated, false);
  assert.match(flags[0].reason, /read permission denied for superseded/);
  assert.deepEqual(counts(), { oldAccesses: 0, newAccesses: 0 }, "denied pin bytes must never be touched");
});

test("KVP-004r3: good source + consulted-budget exhaustion refuses with no partial answer", () => {
  // A good source exists, but 5000 registrations exhaust the consulted
  // budget during validation -> REFUSED, complete:false, zero claims.
  const ctx = kvp4r3MinimalCtx("read");
  const regs = [];
  for (let i = 0; i < 5000; i++) {
    regs.push({
      registration_ref: `reg-x-${i}`, steward_id: "steward-1", action_ids: ["read"],
      valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false,
    });
  }
  ctx.registrations = regs;
  const r = run(task("t4 probe"), ctx);
  assert.equal(r.status, "REFUSED");
  assert.ok(["INPUT_LIMIT", "BUDGET_EXCEEDED"].includes(r.diagnostics[0].code));
  assert.equal(r.complete, false);
  assert.equal(r.claims.length, 0, "no partial answer after exhaustion");
});
