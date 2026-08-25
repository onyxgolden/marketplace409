import { describe, expect, it } from "vitest";
import { buildSimplifiAssetRegistryPreview, inferSimplifiAssetClass } from "./buildSimplifiAssetRegistryPreview";

describe("Simplifi asset registry preview", () => {
  it.each([
    ["2015 Toyota Tacoma", "vehicle"], ["Box Trailer", "trailer"], ["Coleman 2x4", "trailer"],
    ["SCAG Turf Tiger II", "equipment"], ["Tractor", "equipment"], ["Card Ladder", "equipment"],
    ["Silver Eagle Coins", "collectible"], ["XRP wallet", "crypto"],
  ])("classifies %s as %s", (name, expected) => expect(inferSimplifiAssetClass(name)).toBe(expected));

  it("reuses imported account-scope evidence and produces a read-only ready row", () => {
    const preview = buildSimplifiAssetRegistryPreview({
      accounts: [{ id: "a1", name: "SCAG Turf Tiger II", type: "other", provider: "quicken_simplifi_csv", active: true }],
      balances: [{ financial_account_id: "a1", current_balance_cents: 800000, as_of: "2026-08-24" }],
      scopeEvidence: [{ financial_account_id: "a1", account_scope: "business" }],
    });
    expect(preview.rows[0]).toMatchObject({ assetClass: "equipment", ownershipScope: "business", valueCents: 800000, classification: "ready", approvable: true });
  });

  it("fails closed for mixed ownership, missing values, unknown classes, and duplicate assets", () => {
    const accounts = [
      { id: "mixed", name: "Tractor", type: "other", active: true },
      { id: "missing", name: "Box Trailer", type: "other", active: true },
      { id: "unknown", name: "Mystery asset", type: "other", active: true },
      { id: "duplicate", name: "Silver Eagle Coins", type: "other", active: true },
    ];
    const balances = [
      { financial_account_id: "mixed", current_balance_cents: 1400000 },
      { financial_account_id: "unknown", current_balance_cents: 1 },
      { financial_account_id: "duplicate", current_balance_cents: 1255200 },
    ];
    const scopeEvidence = [
      { financial_account_id: "mixed", account_scope: "business" },
      { financial_account_id: "mixed", account_scope: "personal" },
      { financial_account_id: "missing", account_scope: "business" },
      { financial_account_id: "unknown", account_scope: "personal" },
      { financial_account_id: "duplicate", account_scope: "personal" },
    ];
    const preview = buildSimplifiAssetRegistryPreview({ accounts, balances, scopeEvidence, existingAssets: [{ name: "silver eagle coins", active: true }] });
    expect(preview.rows.map((row) => row.classification)).toEqual(["needs_review", "needs_review", "needs_review", "already_registered"]);
  });

  it("excludes property accounts and ordinary bank accounts from registry approval", () => {
    const preview = buildSimplifiAssetRegistryPreview({
      accounts: [
        { id: "p", name: "Rental Property", type: "other", active: true },
        { id: "b", name: "Truck Checking", type: "depository", active: true },
      ],
      balances: [{ financial_account_id: "p", current_balance_cents: 1 }, { financial_account_id: "b", current_balance_cents: 1 }],
      scopeEvidence: [{ financial_account_id: "p", account_scope: "business" }, { financial_account_id: "b", account_scope: "business" }],
    });
    expect(preview.rows.map((row) => row.classification)).toEqual(["excluded", "excluded"]);
  });
});
