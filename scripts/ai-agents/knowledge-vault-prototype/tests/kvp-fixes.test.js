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
      applicability: { scope_ids: ["facilities"], source_keys: ["vault|t/forked.md"] },
    }],
    supersessionRecords: [
      {
        record_id: "sup-f1", issuer: "steward-1",
        old_ref: { repo: "vault", path: "t/forked.md", commit: c1, blob: gitBlobId(fork1Text), algorithm: "git-sha1", revision: "rev-1" },
        new_ref: { repo: "vault", path: "t/forked.md", commit: cx, blob: gitBlobId(forkXText), algorithm: "git-sha1", revision: "rev-1" },
        effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
      },
      {
        record_id: "sup-f2", issuer: "steward-1",
        old_ref: { repo: "vault", path: "t/forked.md", commit: c1, blob: gitBlobId(fork1Text), algorithm: "git-sha1", revision: "rev-1" },
        new_ref: { repo: "vault", path: "t/forked.md", commit: cy, blob: gitBlobId(forkYText), algorithm: "git-sha1", revision: "rev-1" },
        effective_at: "2026-06-01T00:00:00Z", scope_ids: ["facilities"], registration_ref: "reg-1",
      },
    ],
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
      applicability: { scope_ids: ["facilities"], source_keys: ["vault|t/chain.md"] },
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
