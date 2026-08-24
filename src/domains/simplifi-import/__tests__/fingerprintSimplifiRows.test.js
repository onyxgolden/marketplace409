import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintSimplifiRows } from "../fingerprintSimplifiRows";

const SECRET = "test-only-secret";
const MAPPINGS = { checking: { id: "account_1" } };

// split_identity is "yes"/"no" on virtually every real Simplifi row -- never empty. The v1 bug only
// showed up because every earlier test fixture used an empty split_identity, which accidentally
// exercised the (correct) ordinal fallback instead of the (broken) "yes"/"no" branch that real data
// hits. This fixture matches reality.
const row = Object.freeze({
  account_name: "Checking",
  date: "2026-08-01",
  payee: "Vendor",
  amount_cents: -1000,
  category: "Repairs",
  tags: ["Rental"],
  notes: "Original",
  check_number: "",
  status: "cleared",
  split_identity: "no",
});

function fingerprint(rows, options = {}) {
  return fingerprintSimplifiRows(rows, { accountMappings: MAPPINGS, secret: SECRET, ...options });
}

// Reproduces the exact legacy (v1) fingerprint format so tests can simulate "this row was already
// imported under the old buggy scheme" without depending on fingerprintSimplifiRows' own (fixed)
// legacy-recognition logic to generate its own test fixtures.
function legacyV1Fingerprint(r, accountMappingId, splitIdentityLiteral) {
  const normalized = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const stableTags = (t) => [...(t ?? [])].map(normalized).filter(Boolean).sort().join("|");
  const evidence = [
    "v1", accountMappingId, r.date, r.amount_cents, normalized(r.payee), normalized(r.category),
    stableTags(r.tags), normalized(r.check_number),
  ].join("");
  const hash = createHmac("sha256", SECRET).update(`${evidence}${splitIdentityLiteral}`).digest("hex");
  return `v1:${hash}`;
}

describe("fingerprintSimplifiRows", () => {
  it("is deterministic, versioned as v2, and account isolated", () => {
    const first = fingerprint([row])[0];
    const again = fingerprint([row])[0];
    const otherAccount = fingerprintSimplifiRows([row], {
      accountMappings: { checking: { id: "account_2" } }, secret: SECRET,
    })[0];
    expect(first.fingerprint).toMatch(/^v2:[a-f0-9]{64}$/);
    expect(first.fingerprint_version).toBe("v2");
    expect(first.fingerprint).toBe(again.fingerprint);
    expect(first.fingerprint).not.toBe(otherAccount.fingerprint);
  });

  it("gives two identical source rows two unique fingerprints", () => {
    const results = fingerprint([row, row]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(2);
    expect(results.map((r) => r.duplicate_ordinal)).toEqual([1, 2]);
  });

  it("gives 37 identical rows 37 unique fingerprints", () => {
    const results = fingerprint(Array.from({ length: 37 }, () => row));
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(37);
    expect(results.map((r) => r.duplicate_ordinal)).toEqual(Array.from({ length: 37 }, (_, i) => i + 1));
  });

  it("never uses the literal split_identity 'yes'/'no' value as part of the fingerprint identity", () => {
    // Two rows, identical evidence, but opposite split_identity flags: under the old scheme these
    // would have produced two DIFFERENT v1 fingerprints (since split_identity was treated as
    // identity). Under the fix, split_identity is metadata only, so both fall into the same
    // canonical group and still get distinct-but-grouped-together fresh fingerprints, exactly as if
    // they were both "no".
    const yes = { ...row, split_identity: "yes" };
    const no = { ...row, split_identity: "no" };
    const resultsMixed = fingerprint([yes, no]);
    const resultsAllNo = fingerprint([no, no]);
    expect(resultsMixed.map((r) => r.fingerprint).sort()).toEqual(resultsAllNo.map((r) => r.fingerprint).sort());
    expect(new Set(resultsMixed.map((r) => r.fingerprint)).size).toBe(2);
  });

  it("leaves split_identity/duplicate_ordinal present on the row as metadata, not identity", () => {
    const [result] = fingerprint([row]);
    expect(result.split_identity).toBe("no");
    expect(result.duplicate_ordinal).toBe(1);
  });

  it("one legacy import plus N source rows leaves N-1 rows newly approvable (fresh)", () => {
    const rows = Array.from({ length: 5 }, () => row);
    const legacy = legacyV1Fingerprint(row, "account_1", "no");
    const results = fingerprint(rows, { existingFingerprints: [legacy] });

    const legacyMatches = results.filter((r) => r.fingerprint === legacy);
    const fresh = results.filter((r) => r.fingerprint !== legacy);
    expect(legacyMatches).toHaveLength(1);
    expect(legacyMatches[0].fingerprint_version).toBe("v1");
    expect(fresh).toHaveLength(4);
    expect(fresh.every((r) => r.fingerprint_version === "v2")).toBe(true);
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(5);
  });

  it("multiple legacy imports consume the same number of occurrences", () => {
    const rows = [
      { ...row, split_identity: "yes" },
      { ...row, split_identity: "no" },
      { ...row, split_identity: "no" },
      { ...row, split_identity: "no" },
    ];
    const legacyYes = legacyV1Fingerprint(row, "account_1", "yes");
    const legacyNo = legacyV1Fingerprint(row, "account_1", "no");
    const results = fingerprint(rows, { existingFingerprints: [legacyYes, legacyNo] });

    const legacyMatches = results.filter((r) => r.fingerprint_version === "v1");
    const fresh = results.filter((r) => r.fingerprint_version === "v2");
    expect(legacyMatches.map((r) => r.fingerprint).sort()).toEqual([legacyNo, legacyYes].sort());
    expect(fresh).toHaveLength(2);
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(4);
  });

  it("a legacy fingerprint is consumed by at most one row even if several rows could match it", () => {
    // Both rows share evidence AND split_identity "no", so both independently compute the SAME
    // legacy v1 fingerprint. Only one may claim it; the other must get a fresh, distinct fingerprint
    // -- otherwise the exact collision this fix exists to prevent would reappear for the leftover row.
    const legacy = legacyV1Fingerprint(row, "account_1", "no");
    const results = fingerprint([row, row], { existingFingerprints: [legacy] });
    expect(results.filter((r) => r.fingerprint === legacy)).toHaveLength(1);
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(2);
  });

  it("rerun after recovery is idempotent: previously-minted fresh fingerprints are recognized as already imported, not reassigned", () => {
    const rows = Array.from({ length: 5 }, () => row);
    const legacy = legacyV1Fingerprint(row, "account_1", "no");
    const firstPass = fingerprint(rows, { existingFingerprints: [legacy] });
    const freshFingerprints = firstPass.filter((r) => r.fingerprint !== legacy).map((r) => r.fingerprint);

    // Simulate two of the four fresh rows having since been approved and inserted.
    const nowExisting = [legacy, ...freshFingerprints.slice(0, 2)];
    const secondPass = fingerprint(rows, { existingFingerprints: nowExisting });

    const stillNew = secondPass.filter((r) => !nowExisting.includes(r.fingerprint));
    expect(stillNew).toHaveLength(2);
    expect(new Set(secondPass.map((r) => r.fingerprint)).size).toBe(5);
    // No fingerprint that was already recognized as existing gets reassigned to a different row.
    expect(secondPass.filter((r) => nowExisting.includes(r.fingerprint))).toHaveLength(3);
  });

  it("a third pass, once all five are imported, produces zero new fingerprints", () => {
    const rows = Array.from({ length: 5 }, () => row);
    const legacy = legacyV1Fingerprint(row, "account_1", "no");
    const firstPass = fingerprint(rows, { existingFingerprints: [legacy] });
    const allFingerprints = firstPass.map((r) => r.fingerprint);
    const thirdPass = fingerprint(rows, { existingFingerprints: allFingerprints });
    expect(thirdPass.every((r) => allFingerprints.includes(r.fingerprint))).toBe(true);
    expect(new Set(thirdPass.map((r) => r.fingerprint)).size).toBe(5);
  });

  it("CSV reordering preserves group cardinality and does not create duplicates", () => {
    const rows = [
      { ...row, notes: "a" }, { ...row, notes: "b" }, { ...row, notes: "c" },
      { ...row, notes: "d" }, { ...row, notes: "e" },
    ];
    const legacy = legacyV1Fingerprint(row, "account_1", "no");
    const forward = fingerprint(rows, { existingFingerprints: [legacy] });
    const shuffled = [rows[4], rows[1], rows[3], rows[0], rows[2]];
    const reordered = fingerprint(shuffled, { existingFingerprints: [legacy] });

    expect(new Set(forward.map((r) => r.fingerprint)).size).toBe(5);
    expect(new Set(reordered.map((r) => r.fingerprint)).size).toBe(5);
    expect(forward.filter((r) => r.fingerprint === legacy)).toHaveLength(1);
    expect(reordered.filter((r) => r.fingerprint === legacy)).toHaveLength(1);
    // Same set of fingerprints regardless of row order.
    expect([...forward.map((r) => r.fingerprint)].sort()).toEqual([...reordered.map((r) => r.fingerprint)].sort());
  });

  it("keeps cosmetic notes out of identity but includes them in drift evidence", () => {
    const [first] = fingerprint([row]);
    const [changed] = fingerprint([{ ...row, notes: "Changed" }]);
    expect(first.fingerprint).toBe(changed.fingerprint);
    expect(first.evidence_hash).not.toBe(changed.evidence_hash);
  });

  it("leaves unmapped accounts unidentifiable and requires a secret", () => {
    expect(fingerprintSimplifiRows([row], { accountMappings: {}, secret: "secret" })[0].fingerprint).toBeNull();
    expect(() => fingerprintSimplifiRows([row], { accountMappings: {} })).toThrow("secret is required");
  });
});
