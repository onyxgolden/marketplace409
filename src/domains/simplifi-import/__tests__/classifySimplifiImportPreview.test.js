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
    [{ ...base, account_mapping_id: null }, {}, "unsupported"],
    [{ ...base, status: "pending" }, {}, "pending"],
    [{ ...base, category: "Unknown" }, {}, "unsupported"],
    [base, { existingFingerprints: ["v1:new"] }, "already_imported"],
    [base, { rentecOverlapFingerprints: ["v1:new"] }, "overlap_rentec"],
    [base, { plaidOverlapFingerprints: ["v1:new"] }, "overlap_plaid"],
    [{ ...base, account_scope: "personal" }, {}, "personal"],\n    [{ ...base, account_scope: "mixed" }, {}, "ambiguous"],
    [base, {}, "safe_missing"],
  ])("classifies rows fail closed", (row, options, expected) => {
    const result = classifySimplifiImportPreview([row], { categoryMappings: categories, ...options });
    expect(result.rows[0].classification).toBe(expected);
    expect(result.rows[0].approvable).toBe(expected === "safe_missing");
  });

  it("never approves mixed-account activity without transaction-level review", () => {\n    const result = classifySimplifiImportPreview(\n      [{ ...base, account_scope: "mixed" }],\n      { categoryMappings: categories },\n    );\n    expect(result.rows[0]).toMatchObject({\n      classification: "ambiguous",\n      approvable: false,\n      reason: "Mixed-account activity requires transaction-level business or personal review.",\n    });\n    expect(result.can_approve).toBe(false);\n  });\n\n  it("reports signed totals by classification", () => {
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
    expect(result.rows[0]).toMatchObject({ transaction_kind: "transfer", affects_noi: false, capitalized: false });
    expect(result.rows[1]).toMatchObject({ transaction_kind: "asset_purchase", affects_noi: false, capitalized: true });
  });

  it("never approves a category explicitly excluded by the landlord", () => {
    const result = classifySimplifiImportPreview([base], { categoryMappings: {
      repairs: { normalized_category: "excluded", treatment: "exclude" },
    } });
    expect(result.rows[0]).toMatchObject({ classification: "unsupported", approvable: false });
  });
});
