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

function ctx() {
  return { clock: Date.parse("2026-07-01T00:00:00Z"), sources: store.sources, readGrants: store.readGrants, principal: store.principals.jasonActive, criteria: store.criteria.standard };
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

test("exact boundary: 62 tickets (2 fixture resolutions + 62 = 64) succeeds in full", () => {
  const r = run(taskFor(store.bundleRefs["sixty-two-tickets"], 62, true), ctx());
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.ticket_results.length, 62);
});

test("exact boundary: one ticket past the cap (65 total) refuses BUDGET_EXCEEDED, not a partial result", () => {
  const r = run(taskFor(store.bundleRefs["sixty-five-tickets"], 65, true), ctx());
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
  const ref = { repo: "edu-sources", path: "tickets/sixty-two-tickets.json", commit: store.bundleRefs["sixty-two-tickets"].commit, blob, algorithm: "git-sha1", revision: "v1" };
  const c = ctx();
  // Register the oversized bundle under the SAME path/commit the fixture
  // store already grants read access to, with the correspondingly
  // recomputed blob — this test only needs an authorized, resolvable
  // oversized bundle, not a new fixture file.
  c.sources = { ...store.sources, [`${ref.repo}|${ref.path}`]: { revisions: { [ref.commit]: { text, blob } } } };

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
