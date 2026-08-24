import { describe, expect, it } from "vitest";
import { buildSimplifiImportPreview } from "../buildSimplifiImportPreview";

const csv = [
  "Account,Date,Payee,Amount,Category,Status",
  "Checking,8/1/2026,Tenant,1500.00,Rent Income,Cleared",
  "Card,8/2/2026,Store,-50.00,Repairs,Cleared",
].join("\n");
const ownerAccounts = [
  { id: "forge_checking", type: "checking" },
  { id: "forge_card", type: "credit card" },
];
const categoryMappings = {
  "rent income": { normalized_category: "rental_income" },
  repairs: { normalized_category: "repairs_maintenance" },
};

function preview(overrides = {}) {
  return buildSimplifiImportPreview({
    csv,
    ownerAccounts,
    requestedMappings: [
      { simplifi_account_name: "Checking", forge_account_id: "forge_checking", scope: "business" },
      { simplifi_account_name: "Card", forge_account_id: "forge_card", scope: "business" },
    ],
    categoryMappings,
    fingerprintSecret: "test-only-secret",
    ...overrides,
  });
}

describe("buildSimplifiImportPreview", () => {
  it("builds a read-only, owner-account-scoped preview", () => {
    const result = preview();
    expect(result).toMatchObject({
      status: "preview_only",
      row_count: 2,
      can_approve: true,
      totals: { safe_missing: { count: 2, amount_cents: 145000 } },
    });
    expect(result.accounts).toEqual([
      { account_name: "Checking", row_count: 1, amount_cents: 150000, mapped: true },
      { account_name: "Card", row_count: 1, amount_cents: -5000, mapped: true },
    ]);
  });

  it("does not permit a cross-owner or invented FORGE account mapping", () => {
    expect(() => preview({
      requestedMappings: [{ simplifi_account_name: "Checking", forge_account_id: "other_owner_account" }],
    })).toThrow("does not belong to this owner");
  });

  it("leaves an unmapped CSV account unsupported rather than guessing", () => {
    const result = preview({
      requestedMappings: [
        { simplifi_account_name: "Checking", forge_account_id: "forge_checking", scope: "business" },
      ],
    });
    expect(result.accounts[1]).toMatchObject({ account_name: "Card", mapped: false });
    expect(result.rows[1]).toMatchObject({ classification: "unsupported", approvable: false });
  });

  it("rejects duplicate mappings and unsupported account scope", () => {
    expect(() => preview({
      requestedMappings: [
        { simplifi_account_name: "Checking", forge_account_id: "forge_checking" },
        { simplifi_account_name: " checking ", forge_account_id: "forge_checking" },
      ],
    })).toThrow("mapped more than once");
    expect(() => preview({
      requestedMappings: [
        { simplifi_account_name: "Checking", forge_account_id: "forge_checking", scope: "unknown" },
      ],
    })).toThrow("Unsupported Simplifi account scope");
  });

  it("recognizes previously imported evidence without making it approvable", () => {
    const first = preview();
    const rerun = preview({ existingFingerprints: [first.rows[0].fingerprint] });
    expect(rerun.rows[0]).toMatchObject({ classification: "already_imported", approvable: false });
    expect(rerun.rows[1].classification).toBe("safe_missing");
  });

  it("keeps explicitly excluded accounts out of approval", () => {
    const result = preview({
      requestedMappings: [
        { simplifi_account_name: "Checking", forge_account_id: "forge_checking", scope: "excluded" },
        { simplifi_account_name: "Card", forge_account_id: "forge_card", scope: "business" },
      ],
    });
    expect(result.rows[0]).toMatchObject({ classification: "personal", approvable: false });
    expect(result.preview_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("allows an excluded account without inventing a FORGE account or mapping its categories", () => {
    const result = preview({
      requestedMappings: [
        { simplifi_account_name: "Checking", scope: "excluded" },
        { simplifi_account_name: "Card", forge_account_id: "forge_card", scope: "business" },
      ],
      categoryMappings: { repairs: categoryMappings.repairs },
    });

    expect(result.accounts[0]).toMatchObject({ account_name: "Checking", mapped: true });
    expect(result.rows[0]).toMatchObject({
      account_mapping_id: "excluded:checking",
      account_scope: "excluded",
      classification: "personal",
      approvable: false,
    });
    expect(result.rows[1]).toMatchObject({ classification: "safe_missing", approvable: true });
  });
});
