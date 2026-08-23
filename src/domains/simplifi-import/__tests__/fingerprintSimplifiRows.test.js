import { describe, expect, it } from "vitest";
import { fingerprintSimplifiRows } from "../fingerprintSimplifiRows";

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
  split_identity: "",
});

describe("fingerprintSimplifiRows", () => {
  it("is deterministic, versioned, and account isolated", () => {
    const first = fingerprintSimplifiRows([row], {
      accountMappings: { checking: { id: "account_1" } }, secret: "test-only-secret",
    })[0];
    const again = fingerprintSimplifiRows([row], {
      accountMappings: { checking: { id: "account_1" } }, secret: "test-only-secret",
    })[0];
    const otherAccount = fingerprintSimplifiRows([row], {
      accountMappings: { checking: { id: "account_2" } }, secret: "test-only-secret",
    })[0];
    expect(first.fingerprint).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(first.fingerprint).toBe(again.fingerprint);
    expect(first.fingerprint).not.toBe(otherAccount.fingerprint);
  });

  it("uses stable duplicate ordinals so equal rows keep cardinality", () => {
    const results = fingerprintSimplifiRows([row, row], {
      accountMappings: { checking: { id: "account_1" } }, secret: "test-only-secret",
    });
    expect(results.map((item) => item.duplicate_ordinal)).toEqual([1, 2]);
    expect(new Set(results.map((item) => item.fingerprint)).size).toBe(2);
  });

  it("keeps cosmetic notes out of identity but includes them in drift evidence", () => {
    const [first] = fingerprintSimplifiRows([row], {
      accountMappings: { checking: { id: "account_1" } }, secret: "test-only-secret",
    });
    const [changed] = fingerprintSimplifiRows([{ ...row, notes: "Changed" }], {
      accountMappings: { checking: { id: "account_1" } }, secret: "test-only-secret",
    });
    expect(first.fingerprint).toBe(changed.fingerprint);
    expect(first.evidence_hash).not.toBe(changed.evidence_hash);
  });

  it("leaves unmapped accounts unidentifiable and requires a secret", () => {
    expect(fingerprintSimplifiRows([row], { accountMappings: {}, secret: "secret" })[0].fingerprint).toBeNull();
    expect(() => fingerprintSimplifiRows([row], { accountMappings: {} })).toThrow("secret is required");
  });
});
