/** Rubric scoring tests (§7). All vendor text is invented. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreComparison, scoreWithDifference, summarizeComparisons } from "../src/rubric.js";
import { supportedCell, trustedContext, scope } from "./helpers.js";
import { PROPOSITION_IDS } from "../src/taxonomy.js";

const F = PROPOSITION_IDS[2]; // payments.online-payment
const mk = (state, conflict = false) => ({
  ...supportedCell(F, "x"),
  evidence_state: state,
  conflict,
  freshness_status: "fresh",
});

test("both supported -> parity (coverage only)", () => {
  const r = scoreComparison({ feature_id: F, forge: mk("supported"), competitor: mk("supported") });
  assert.equal(r.verdict, "parity");
  assert.match(r.basis, /coverage-only/);
});

test("missing evidence on either side -> undetermined", () => {
  assert.equal(scoreComparison({ feature_id: F, forge: mk("supported"), competitor: mk("unsupported") }).verdict, "undetermined");
  assert.equal(scoreComparison({ feature_id: F, forge: mk("unsupported"), competitor: mk("supported") }).verdict, "undetermined");
  assert.equal(scoreComparison({ feature_id: F, forge: null, competitor: mk("supported") }).verdict, "undetermined");
});

test("missing scope -> undetermined (cannot establish comparability)", () => {
  const noScope = { ...mk("supported"), scope: null };
  assert.equal(scoreComparison({ feature_id: F, forge: noScope, competitor: mk("supported") }).verdict, "undetermined");
});

test("stale freshness -> undetermined", () => {
  const stale = { ...mk("supported"), freshness_status: "stale" };
  assert.equal(scoreComparison({ feature_id: F, forge: stale, competitor: mk("supported") }).verdict, "undetermined");
  assert.equal(scoreComparison({ feature_id: F, forge: mk("supported"), competitor: stale }).verdict, "undetermined");
});

test("unknown freshness -> undetermined", () => {
  const unk = { ...mk("supported"), freshness_status: "unknown" };
  assert.equal(scoreComparison({ feature_id: F, forge: unk, competitor: mk("supported") }).verdict, "undetermined");
});

test("conflict -> undetermined", () => {
  const r = scoreComparison({ feature_id: F, forge: mk("supported", true), competitor: mk("supported") });
  assert.equal(r.verdict, "undetermined");
});

test("scope mismatch -> not_comparable", () => {
  const forge = { ...mk("supported"), scope: { edition: "standard", platform: "web", region: "US" } };
  const comp = { ...mk("supported"), scope: { edition: "enterprise", platform: "web", region: "US" } };
  assert.equal(scoreComparison({ feature_id: F, forge, competitor: comp }).verdict, "not_comparable");
});

test("ahead requires cited explicit difference", () => {
  const noEvidence = scoreWithDifference({ feature_id: F, base: null, diffEvidence: null, trusted: trustedContext() });
  assert.equal(noEvidence.verdict, "undetermined");
  const base = { forge: mk("supported"), competitor: mk("supported") };
  const good = scoreWithDifference({
    feature_id: F, base, trusted: trustedContext(),
    diffEvidence: { direction: "forge_ahead", description: "FORGE reconciles failed autopay automatically; competitor docs show manual retry only.", citations: ["s1"] },
  });
  assert.equal(good.verdict, "ahead");
  const behind = scoreWithDifference({
    feature_id: F, base, trusted: trustedContext(),
    diffEvidence: { direction: "competitor_ahead", description: "Competitor supports split payments; FORGE does not.", citations: ["s2"] },
  });
  assert.equal(behind.verdict, "behind");
});

test("ahead requires grounded citations", () => {
  const base = { forge: mk("supported"), competitor: mk("supported") };
  const r = scoreWithDifference({
    feature_id: F, base, trusted: trustedContext(),
    diffEvidence: { direction: "forge_ahead", description: "Claimed difference.", citations: ["not-a-source"] },
  });
  assert.equal(r.verdict, "undetermined");
  assert.match(r.basis, /ungrounded/);
});

test("ahead requires a supported comparable base", () => {
  const t = trustedContext();
  const weak = { forge: mk("unsupported"), competitor: mk("supported") };
  const r = scoreWithDifference({
    feature_id: F, base: weak, trusted: t,
    diffEvidence: { direction: "forge_ahead", description: "x", citations: ["s1"] },
  });
  assert.equal(r.verdict, "undetermined");
});

test("summarize never declares a winner", () => {
  const s = summarizeComparisons([{ verdict: "ahead" }, { verdict: "parity" }, { verdict: "behind" }]);
  assert.equal(s.winner_declared, false);
  assert.equal(s.counts.ahead, 1);
  assert.equal(s.total, 3);
});
