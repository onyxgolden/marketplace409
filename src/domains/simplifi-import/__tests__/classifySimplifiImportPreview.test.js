import { describe, expect, it } from "vitest";
import { classifySimplifiImportPreview } from "../classifySimplifiImportPreview";

const base = Object.freeze({
  account_mapping_id: "account_1",
  account_scope: "business",
  fingerprint: "v1:new",
  status: "cleared",
  date: "2026-08-01",
  category: "Repairs",
  amount_cents: -1000,
});
const categories = { repairs: { normalized_category: "repairs_maintenance" } };

describe("classifySimplifiImportPreview", () => {
  it.each([
    [{ ...base, account_mapping_id: null }, {}, "unsupported", false],
    [{ ...base, account_scope: "excluded" }, {}, "unsupported", false],
    [{ ...base, status: "pending" }, {}, "pending", false],
    [{ ...base, category: "Unknown" }, {}, "unsupported", false],
    [base, { existingFingerprints: ["v1:new"] }, "already_imported", false],
    [base, { rentecOverlapFingerprints: ["v1:new"] }, "overlap_rentec", false],
    [base, { plaidOverlapFingerprints: ["v1:new"] }, "overlap_plaid", false],
    [{ ...base, account_scope: "personal" }, {}, "personal", true],
    [{ ...base, account_scope: "mixed" }, {}, "personal", true],
    [base, {}, "safe_missing", true],
  ])("classifies rows fail closed", (row, options, expected, expectedApprovable) => {
    const result = classifySimplifiImportPreview([row], { categoryMappings: categories, ...options });
    expect(result.rows[0].classification).toBe(expected);
    expect(result.rows[0].approvable).toBe(expectedApprovable);
  });

  it.each(["personal", "mixed"])(
    "applies the same shared guards (pending/category/exclude/dedup) to account_scope=%s as business rows",
    (accountScope) => {
      const pending = classifySimplifiImportPreview(
        [{ ...base, account_scope: accountScope, status: "pending" }],
        { categoryMappings: categories },
      );
      expect(pending.rows[0]).toMatchObject({ classification: "pending", approvable: false });

      const noCategory = classifySimplifiImportPreview(
        [{ ...base, account_scope: accountScope, category: "Unknown" }],
        { categoryMappings: categories },
      );
      expect(noCategory.rows[0]).toMatchObject({ classification: "unsupported", approvable: false });

      const excludedCategory = classifySimplifiImportPreview(
        [{ ...base, account_scope: accountScope }],
        { categoryMappings: { repairs: { normalized_category: "excluded", treatment: "exclude" } } },
      );
      expect(excludedCategory.rows[0]).toMatchObject({ classification: "unsupported", approvable: false });

      const transfer = classifySimplifiImportPreview(
        [{ ...base, account_scope: accountScope }],
        { categoryMappings: { repairs: { normalized_category: "transfer", treatment: "transfer" } } },
      );
      expect(transfer.rows[0]).toMatchObject({
        classification: "transfer_pair", approvable: false, transaction_kind: "transfer", affects_noi: false,
      });

      const alreadyImported = classifySimplifiImportPreview(
        [{ ...base, account_scope: accountScope }],
        { categoryMappings: categories, existingFingerprints: ["v1:new"] },
      );
      expect(alreadyImported.rows[0]).toMatchObject({ classification: "already_imported", approvable: false });
    },
  );

  it("imports a clean personal-account row as approvable business_scope=personal, never affecting NOI or capitalization", () => {
    const result = classifySimplifiImportPreview(
      [{ ...base, account_scope: "personal" }],
      { categoryMappings: categories },
    );
    expect(result.rows[0]).toMatchObject({
      classification: "personal", approvable: true, business_scope: "personal",
      affects_noi: false, capitalized: false,
      reason: "Personal activity is tracked for personal reporting but excluded from business reports.",
    });
    expect(result.can_approve).toBe(true);
  });

  it("defaults a mixed-account row to personal (business_scope=personal, approvable), preserving account_scope='mixed' for future relabeling", () => {
    const result = classifySimplifiImportPreview(
      [{ ...base, account_scope: "mixed" }],
      { categoryMappings: categories },
    );
    expect(result.rows[0]).toMatchObject({
      classification: "personal", approvable: true, business_scope: "personal", account_scope: "mixed",
      reason: "Mixed-account activity is imported as personal by default; relabel individual transactions to business later.",
    });
  });

  it("forces affects_noi and capitalized false for a personal-scope row even when the category treatment is operating/asset_purchase", () => {
    const operating = classifySimplifiImportPreview(
      [{ ...base, account_scope: "personal" }],
      { categoryMappings: { repairs: { normalized_category: "business_income", treatment: "operating" } } },
    );
    expect(operating.rows[0]).toMatchObject({ affects_noi: false, capitalized: false, business_scope: "personal" });

    const assetPurchase = classifySimplifiImportPreview(
      [{ ...base, account_scope: "personal" }],
      { categoryMappings: { repairs: { normalized_category: "real_estate_purchase", treatment: "asset_purchase" } } },
    );
    expect(assetPurchase.rows[0]).toMatchObject({ affects_noi: false, capitalized: false, business_scope: "personal" });
  });

  it("marks a business-scope safe_missing row business_scope=business", () => {
    const result = classifySimplifiImportPreview([base], { categoryMappings: categories });
    expect(result.rows[0]).toMatchObject({ classification: "safe_missing", business_scope: "business" });
  });

  it("classifies a treatment=transfer row as transfer_pair, never safe_missing, regardless of overlap evidence", () => {
    // Regression: treatment="transfer" previously fell through to the same safe_missing/overlap
    // logic as any operating category, since nothing distinguished it after the exclude branch.
    // A transfer must be rejected before overlap evidence is even consulted.
    const evidence = [{ id: "evidence_1", source_system: "rentec", event_date: "2026-08-01",
      signed_amount_cents: -1000, normalized_category: "transfer" }];
    const result = classifySimplifiImportPreview([base], {
      categoryMappings: { repairs: { normalized_category: "transfer", treatment: "transfer" } },
      overlapEvidence: evidence,
    });
    expect(result.rows[0]).toMatchObject({
      classification: "transfer_pair",
      approvable: false,
      transaction_kind: "transfer",
      affects_noi: false,
    });
    expect(result.can_approve).toBe(false);
  });

  it("classifies a credit-card payment as transfer_pair, never safe_missing", () => {
    const row = { ...base, category: "Credit Card Payment", amount_cents: -50000 };
    const result = classifySimplifiImportPreview([row], {
      categoryMappings: { "credit card payment": { normalized_category: "credit_card_payment", treatment: "transfer" } },
    });
    expect(result.rows[0]).toMatchObject({ classification: "transfer_pair", approvable: false });
  });

  it("classifies both sides of a paired account-to-account transfer as transfer_pair, and excludes both from safe_missing totals", () => {
    const outgoing = { ...base, fingerprint: "v1:out", category: "Business Savings", amount_cents: -336800 };
    const incoming = { ...base, fingerprint: "v1:in", category: "Dugood Bus Ck", amount_cents: 336800 };
    const result = classifySimplifiImportPreview([outgoing, incoming], {
      categoryMappings: {
        "business savings": { normalized_category: "business_savings", treatment: "transfer" },
        "dugood bus ck": { normalized_category: "dugood_bus_ck", treatment: "transfer" },
      },
    });
    expect(result.rows.map((row) => row.classification)).toEqual(["transfer_pair", "transfer_pair"]);
    expect(result.rows.every((row) => row.approvable === false)).toBe(true);
    expect(result.totals.safe_missing).toBeUndefined();
    expect(result.totals.transfer_pair).toEqual({ count: 2, amount_cents: 0 });
    expect(result.can_approve).toBe(false);
  });

  it("reports signed totals by classification", () => {
    const result = classifySimplifiImportPreview(
      [base, { ...base, fingerprint: "v1:second", amount_cents: 2500 }],
      { categoryMappings: categories },
    );
    expect(result.totals.safe_missing).toEqual({ count: 2, amount_cents: 1500 });
    expect(result.can_approve).toBe(true);
  });

  it("uses owner-scoped cross-source evidence once, preserving cardinality", () => {
    const evidence = [{ id: "rentec_1", source_system: "rentec_api", event_date: "2026-08-03",
      signed_amount_cents: -1000, normalized_category: "repairs_maintenance" }];
    const result = classifySimplifiImportPreview(
      [base, { ...base, fingerprint: "v1:second" }],
      { categoryMappings: categories, overlapEvidence: evidence },
    );
    expect(result.rows.map((row) => row.classification)).toEqual(["overlap_rentec", "safe_missing"]);
  });

  it("fails closed when more than one existing event could match", () => {
    const overlapEvidence = ["one", "two"].map((id) => ({ id, source_system: "plaid",
      event_date: "2026-08-01", signed_amount_cents: -1000, normalized_category: "repairs_maintenance" }));
    const result = classifySimplifiImportPreview([base], { categoryMappings: categories, overlapEvidence });
    expect(result.rows[0]).toMatchObject({ classification: "ambiguous", approvable: false });
  });

  it("keeps transfers and asset purchases out of operating income", () => {
    const rows = [base, { ...base, fingerprint: "v1:asset", category: "Purchase" }];
    const result = classifySimplifiImportPreview(rows, { categoryMappings: {
      repairs: { normalized_category: "transfer", treatment: "transfer" },
      purchase: { normalized_category: "real_estate_purchase", treatment: "asset_purchase" },
    } });
    expect(result.rows[0]).toMatchObject({
      transaction_kind: "transfer", affects_noi: false, capitalized: false,
      classification: "transfer_pair", approvable: false,
    });
    expect(result.rows[1]).toMatchObject({ transaction_kind: "asset_purchase", affects_noi: false, capitalized: true });
  });

  it("never approves a category explicitly excluded by the landlord", () => {
    const result = classifySimplifiImportPreview([base], { categoryMappings: {
      repairs: { normalized_category: "excluded", treatment: "exclude" },
    } });
    expect(result.rows[0]).toMatchObject({ classification: "unsupported", approvable: false });
  });
});
