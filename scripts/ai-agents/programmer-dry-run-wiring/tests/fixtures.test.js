/**
 * fixtures.test.js — frozen fixture integrity + expected mapping.
 *
 * Every fixture file's bytes must match its manifest SHA-256, and
 * each fixture must map to the verification state the manifest
 * claims. The oversized fixture must refuse validation on the
 * 200-line budget.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = join(HERE, "..");
const SRC = join(WIRING, "..", "..", "..", "src", "application", "ai-lab", "programmer");

const { validateProposal } = await import(join(SRC, "proposalSchema.js"));
const { mapReceiptToVerification } = await import(join(SRC, "receiptMapping.js"));
const { serializePrivateItem } = await import(join(SRC, "privateItemSerializer.js"));
const { renderDetail } = await import(join(SRC, "proposalRenderer.js"));

const manifest = JSON.parse(readFileSync(join(WIRING, "fixtures", "manifest.json"), "utf8"));

test("manifest covers exactly the seven frozen fixtures", () => {
  assert.deepEqual(Object.keys(manifest.fixtures).sort(), [
    "blocked-timeout",
    "failed-verification",
    "malicious-strings",
    "not-run",
    "oversized-diff",
    "stale-digest",
    "unbound-all-pass",
  ]);
});

for (const [name, entry] of Object.entries(manifest.fixtures)) {
  test(`fixture ${name}: bytes match the manifest digest`, () => {
    const bytes = readFileSync(join(WIRING, "fixtures", entry.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  });
}

for (const [name, entry] of Object.entries(manifest.fixtures)) {
  test(`fixture ${name}: validates=${entry.validates} and maps to ${entry.verification_state}`, () => {
    const proposal = JSON.parse(readFileSync(join(WIRING, "fixtures", entry.file), "utf8"));
    if (!entry.validates) {
      assert.throws(() => validateProposal(proposal), (e) => e.code === "BUDGET_EXCEEDED");
      return;
    }
    const valid = validateProposal(proposal);
    const mapped = mapReceiptToVerification({ proposal: valid, receipt: valid.verification.receipt });
    assert.equal(mapped.verification_state, entry.verification_state);
    const item = serializePrivateItem({ proposal: valid, publishedAt: "2026-11-07T12:00:00Z" });
    assert.equal(item.verification.verification_state, entry.verification_state);
    assert.equal(item.kind, "programmer-dry-run-proposal");
    assert.equal(item.execution_authorized, false);
  });
}

test("malicious-strings fixture renders inert in the detail page", () => {
  const proposal = JSON.parse(readFileSync(join(WIRING, "fixtures", "malicious-strings.json"), "utf8"));
  const item = serializePrivateItem({ proposal, publishedAt: "2026-11-07T12:00:00Z" });
  const html = renderDetail(item, { mode: "SYNTHETIC_PREVIEW" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /<svg /);
  assert.doesNotMatch(html, /<[^>]*\son\w+=/);
  assert.doesNotMatch(html, /<\/script><script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Proposal only — never applied, committed, pushed, or merged by this system\./);
});

test("stale-digest fixture: a decision bound to the unbound fixture's digest refuses", async () => {
  const { validateDecision } = await import(join(SRC, "decisionValidator.js"));
  const unbound = serializePrivateItem({
    proposal: JSON.parse(readFileSync(join(WIRING, "fixtures", "unbound-all-pass.json"), "utf8")),
    publishedAt: "2026-11-07T12:00:00Z",
  });
  const stale = serializePrivateItem({
    proposal: JSON.parse(readFileSync(join(WIRING, "fixtures", "stale-digest.json"), "utf8")),
    publishedAt: "2026-11-07T12:00:00Z",
  });
  assert.notEqual(stale.proposal_digest, unbound.proposal_digest);
  assert.throws(
    () =>
      validateDecision(
        stale,
        {
          item_id: stale.item_id,
          proposal_digest: unbound.proposal_digest,
          row_id: "proposal",
          decision: "accept",
          note: "",
          at: "2026-11-07T13:00:00Z",
          decision_id: "dec-stale-1",
        },
        "synthetic-operator-001",
      ),
    (e) => e.code === "STALE_DIGEST",
  );
});
