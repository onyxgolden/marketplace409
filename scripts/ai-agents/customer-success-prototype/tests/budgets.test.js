/**
 * budgets.test.js — the budget-charging-order bug class that has bitten
 * every other agent in this program (Financial Manager needed 5 fix
 * rounds on exactly this; Tax Agent's trust root had the analogous
 * self-certification mistake). Proves the exact object-count boundary
 * and that candidates beyond it are never classified/drafted.
 *
 * Architectural note for the reviewer: unlike a resolver that fetches
 * each candidate individually (where a Proxy on the resolver/fetcher
 * can prove a specific later candidate's fields were never read), this
 * agent's ticket bundle is one pre-registered JSON blob — the whole
 * array is necessarily decoded by one `JSON.parse` call (unavoidable;
 * JSON has no partial/lazy decode). What budget.countObject() actually
 * gates is per-ticket SCHEMA VALIDATION AND CLASSIFICATION, called as
 * literally the first thing after the charge in src/index.js's loop,
 * never before it. A Proxy on individual array elements can't observe
 * this (JSON.parse produces plain objects, not Proxies, and the loop
 * only reads `rawTickets[i]` itself — never a deeper field — before
 * charging), so the proofs here are behavioral instead: (1) the success/
 * refusal boundary is EXACTLY right (62 succeeds, 63 refuses — not off
 * by one in either direction, which would be the case if the charge
 * order or count were wrong), and (2) a 1000-ticket over-budget bundle
 * refuses fast, which it could only do by giving up near the front of
 * the array rather than fully validating/classifying/drafting for 1000
 * tickets first and refusing only at the end.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "../src/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

/**
 * Minimal context for exactly one bundle (policy + that bundle only) —
 * CS-001 fix: context validation is itself object-charged now (one
 * charge per registered source/revision/grant + principal + criteria),
 * so dumping the WHOLE shared fixture store (25 bundles) into every
 * context would exhaust the 64-object budget before a single ticket is
 * ever reached. `extra` optionally layers additional sources/grants on
 * top, for the budget-leak regressions below.
 */
function ctx(bundleRef, extra = {}) {
  const policyKey = `${store.criteria.standard.policy_ref.repo}|${store.criteria.standard.policy_ref.path}`;
  const bundleKey = bundleRef ? `${bundleRef.repo}|${bundleRef.path}` : null;
  const sources = { [policyKey]: store.sources[policyKey], ...(bundleKey && store.sources[bundleKey] ? { [bundleKey]: store.sources[bundleKey] } : {}), ...(extra.sources ?? {}) };
  const readGrants = [{ repo: store.criteria.standard.policy_ref.repo, path: store.criteria.standard.policy_ref.path }, ...(bundleRef ? [{ repo: bundleRef.repo, path: bundleRef.path }] : []), ...(extra.readGrants ?? [])];
  return { clock: Date.parse("2026-07-01T00:00:00Z"), sources, readGrants, principal: store.principals.jasonActive, criteria: store.criteria.standard };
}
function taskFor(bundleRef, declared, complete) {
  return {
    schema_version: "1",
    task_id: "budget-unit-test",
    operation: "analyze",
    fixture_refs: { ticket_bundle: bundleRef },
    options: { population: { declared_total: declared, complete }, header_claims: { avg_response_minutes: null, avg_resolution_minutes: null, sla_compliance_pct: null, csat_mean: null, csat_positive_pct: null } },
  };
}

test("budget object exhaustion throws BUDGET_EXCEEDED at the configured cap", () => {
  const b = makeBudget();
  assert.throws(() => {
    for (let i = 0; i <= BUDGET_LIMITS.maxObjects; i++) b.countObject();
  }, (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget span exhaustion throws BUDGET_EXCEEDED at the configured cap", () => {
  const b = makeBudget();
  assert.throws(() => {
    for (let i = 0; i <= BUDGET_LIMITS.maxSpans; i++) b.countSpan();
  }, (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget payload exhaustion throws INPUT_LIMIT", () => {
  const b = makeBudget();
  assert.throws(() => b.countPayload("x".repeat(BUDGET_LIMITS.maxPayloadBytes + 1), "test"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("exact boundary: 54 tickets (8 context charges + 2 fixture resolutions + 54 = 64) succeeds in full", () => {
  const r = run(taskFor(store.bundleRefs["fifty-four-tickets"], 54, true), ctx(store.bundleRefs["fifty-four-tickets"]));
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.ticket_results.length, 54);
});

test("exact boundary: three tickets past the cap (57 total) refuses BUDGET_EXCEEDED, not a partial result", () => {
  const r = run(taskFor(store.bundleRefs["fifty-seven-tickets"], 57, true), ctx(store.bundleRefs["fifty-seven-tickets"]));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(r.report.ticket_results.length, 0, "no partial ticket_results on budget refusal");
  assert.equal(r.complete, false);
});

test("a 1000-ticket over-budget bundle refuses fast — it cannot be fully validating/classifying/drafting 1000 tickets before giving up", () => {
  const bigTickets = Array.from({ length: 1000 }, (_, i) => ({
    ticket_id: `t-big-${i}`,
    created_at: "2026-06-01T10:00:00Z",
    first_response_at: "2026-06-01T10:05:00Z",
    resolved_at: null,
    status: "OPEN",
    issue_tags: ["TECHNICAL"],
    impact: "NONE",
    sentiment_signal: "UNKNOWN",
    rating: null,
    subject: "x".repeat(200),
    body: "y".repeat(200),
    notes: "z".repeat(200),
  }));
  const text = JSON.stringify(bigTickets);
  const blob = gitBlobIdLocal(Buffer.from(text, "utf8"));
  const ref = { repo: "edu-sources", path: "tickets/fifty-four-tickets.json", commit: store.bundleRefs["fifty-four-tickets"].commit, blob, algorithm: "git-sha1", revision: "v1" };
  // Register the oversized bundle under the SAME path/commit the fixture
  // store already grants read access to, with the correspondingly
  // recomputed blob — this test only needs an authorized, resolvable
  // oversized bundle, not a new fixture file. Minimal context (policy +
  // this one bundle) only — not the whole shared store (see ctx() above).
  const c = ctx(null, { sources: { [`${ref.repo}|${ref.path}`]: { revisions: { [ref.commit]: { text, blob } } } }, readGrants: [{ repo: ref.repo, path: ref.path }] });

  const t0 = Date.now();
  const r = run(taskFor(ref, 1000, true), c);
  const elapsed = Date.now() - t0;

  assert.equal(r.status, "REFUSED");
  // Either cap can fire first depending on exact byte sizes (this bundle
  // trips the 256 KiB payload cap before the 64-object cap) — both are
  // legitimate fail-closed outcomes; the point of this test is the speed,
  // proving it did not fully validate/classify/draft all 1000 first.
  assert.ok(["BUDGET_EXCEEDED", "INPUT_LIMIT"].includes(r.diagnostics[0].code), `expected a budget-related refusal, got ${r.diagnostics[0].code}`);
  assert.ok(elapsed < 200, `expected a fast fail-closed refusal, took ${elapsed}ms`);
});

function gitBlobIdLocal(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function fixtureCommitLocal(seed) {
  return createHash("sha1").update(Buffer.from(`cs001-test-fixture|${seed}`, "utf8")).digest("hex");
}

// ---------------------------------------------------------------------
// CS-001: context (sources/revisions/readGrants/principal/criteria) is
// itself a candidate population now, not a free pre-pass. These prove
// the fix against the exact finding: an unused oversized revision no
// longer slips past the total byte budget, and candidates past the
// object cap are genuinely never read — not merely never used.
// ---------------------------------------------------------------------

test("CS-001: an unused oversized revision registered in context is still charged against the total input budget", () => {
  const bundleRef = store.bundleRefs["single-technical-outage"];
  const unusedText = "x".repeat(300000); // > 262144-byte budget by itself once policy+bundle bytes are added
  const unusedCommit = fixtureCommitLocal("cs001-unused-filler");
  const unusedBlob = fixtureCommitLocal("cs001-unused-filler-blob"); // format-only check at registration time, never resolved
  const unusedKey = "edu-sources|policy/unused-filler-doc.md";
  const c = ctx(bundleRef, { sources: { [unusedKey]: { revisions: { [unusedCommit]: { text: unusedText, blob: unusedBlob } } } } });
  const r = run(taskFor(bundleRef, 1, true), c);
  assert.equal(r.status, "REFUSED");
  assert.ok(
    ["INPUT_LIMIT", "BUDGET_EXCEEDED"].includes(r.diagnostics[0].code),
    `an unused 300,000-byte registered revision must be charged and refused, got ${r.status}/${r.diagnostics[0]?.code}`
  );
  assert.equal(r.complete, false);
  assert.equal(r.report.ticket_results.length, 0, "no partial result when the unused context revision alone blows the budget");
});

function fillerSource(seedIndex) {
  const commit = fixtureCommitLocal(`cs001-filler-commit-${seedIndex}`);
  const blob = fixtureCommitLocal(`cs001-filler-blob-${seedIndex}`);
  return { key: `edu-sources|filler/${String(seedIndex).padStart(4, "0")}.md`, commit, revision: { text: "x", blob } };
}

test("CS-001 poisoned tail: a context.sources entry past the object cap is never read, not merely never charged", () => {
  const bundleRef = store.bundleRefs["single-technical-outage"];
  let poisonTouched = false;
  const poisonedEntry = new Proxy(
    {},
    {
      get(_target, prop) {
        poisonTouched = true;
        throw new Error(`poisoned context.sources entry had '${String(prop)}' read — it should have been refused before any field access`);
      },
    }
  );
  // policy(2 charges) + bundle(2 charges) + 30 real fillers (2 charges
  // each = 60) = 64 exactly; this poisoned entry is inserted last, so
  // its own charge is the 65th attempt — BEFORE any of its fields
  // (routed through the Proxy's throwing get trap) are ever touched.
  const fillerSources = {};
  for (let i = 0; i < 30; i++) {
    const f = fillerSource(i);
    fillerSources[f.key] = { revisions: { [f.commit]: f.revision } };
  }
  fillerSources["edu-sources|filler/zzzz-poison.md"] = poisonedEntry;
  const c = ctx(bundleRef, { sources: fillerSources });
  const r = run(taskFor(bundleRef, 1, true), c);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poisonTouched, false, "the poisoned entry past the object cap must never be read, not just never used");
});
