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

  it("translates platform credit and depository account types into the import vocabulary", () => {
    const result = preview({
      ownerAccounts: [
        { id: "forge_checking", name: "Business Savings", type: "depository" },
        { id: "forge_card", name: "Chase Credit Card", type: "credit" },
      ],
    });

    expect(result.rows[0].account_type).toBe("savings");
    expect(result.rows[1].account_type).toBe("credit card");
    expect(result.totals.safe_missing.count).toBe(2);
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
    expect(result.rows[0]).toMatchObject({ classification: "unsupported", approvable: false });
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
      classification: "unsupported",
      approvable: false,
    });
    expect(result.rows[1]).toMatchObject({ classification: "safe_missing", approvable: true });
  });

  it("preserves business/personal/transfer segregation across duplicate-evidence rows with the corrected fingerprint scheme", () => {
    const duplicateCsv = [
      "Account,Date,Payee,Amount,Category,Status",
      "Checking,8/1/2026,Store,-50.00,Repairs,Cleared",
      "Checking,8/1/2026,Store,-50.00,Repairs,Cleared",
      "Card,8/2/2026,Coffee,-6.00,Shopping,Cleared",
      "Card,8/2/2026,Coffee,-6.00,Shopping,Cleared",
      "Card,8/2/2026,Coffee,-6.00,Shopping,Cleared",
      "Checking,8/3/2026,Business Savings,-1000.00,Business Savings,Cleared",
    ].join("\n");
    const result = buildSimplifiImportPreview({
      csv: duplicateCsv,
      ownerAccounts,
      requestedMappings: [
        { simplifi_account_name: "Checking", forge_account_id: "forge_checking", scope: "business" },
        { simplifi_account_name: "Card", forge_account_id: "forge_card", scope: "personal" },
      ],
      categoryMappings: {
        repairs: { normalized_category: "repairs_maintenance", treatment: "operating" },
        shopping: { normalized_category: "shopping", treatment: "operating" },
        "business savings": { normalized_category: "business_savings", treatment: "transfer" },
      },
      fingerprintSecret: "test-only-secret",
    });

    const byClassification = Object.fromEntries(
      Object.entries(result.totals).map(([k, v]) => [k, v.count]),
    );
    expect(byClassification).toEqual({ safe_missing: 2, personal: 3, transfer_pair: 1 });
    expect(new Set(result.rows.map((r) => r.fingerprint)).size).toBe(6);
    expect(result.rows.filter((r) => r.classification === "safe_missing").every((r) => r.business_scope === "business")).toBe(true);
    expect(result.rows.filter((r) => r.classification === "personal").every((r) => r.business_scope === "personal")).toBe(true);
  });
});
