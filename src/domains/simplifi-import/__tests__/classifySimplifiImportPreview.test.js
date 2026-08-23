import { describe, expect, it } from "vitest";
import { classifySimplifiImportPreview } from "../classifySimplifiImportPreview";

const base = Object.freeze({
  account_mapping_id: "account_1",
  account_scope: "business",
  fingerprint: "v1:new",
  status: "cleared",
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
    [{ ...base, account_scope: "personal" }, {}, "personal"],
    [base, {}, "safe_missing"],
  ])("classifies rows fail closed", (row, options, expected) => {
    const result = classifySimplifiImportPreview([row], { categoryMappings: categories, ...options });
    expect(result.rows[0].classification).toBe(expected);
    expect(result.rows[0].approvable).toBe(expected === "safe_missing");
  });

  it("reports signed totals by classification", () => {
    const result = classifySimplifiImportPreview(
      [base, { ...base, fingerprint: "v1:second", amount_cents: 2500 }],
      { categoryMappings: categories },
    );
    expect(result.totals.safe_missing).toEqual({ count: 2, amount_cents: 1500 });
    expect(result.can_approve).toBe(true);
  });
});
