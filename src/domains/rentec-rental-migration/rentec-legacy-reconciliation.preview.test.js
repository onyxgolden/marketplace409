import { describe, expect, it } from "vitest";
import { buildApiTransactionReconciliationFingerprint, previewRentecLegacyReconciliation } from "./rentec-legacy-reconciliation.preview.js";

const api = (transaction_time, amount, description) => buildApiTransactionReconciliationFingerprint({ transaction_time, amount, description });
const legacy = (event_date, amount, description) => ({ event_date, amount, description });

describe("Rentec legacy reconciliation preview", () => {
  it("classifies exact, probable, conflicting, new, and legacy-only records one to one", () => {
    const result = previewRentecLegacyReconciliation({
      apiRecords: [
        api("2026-01-01", -1500, "Rent payment"),
        api("2026-01-02", 200, "Different wording"),
        api("2026-01-03", 350, "Repair"),
        api("2026-01-04", 99, "New record"),
      ],
      legacyEvents: [
        legacy("2026-01-01", 1500, "Rent payment"),
        legacy("2026-01-02", 200, "Original wording"),
        legacy("2026-01-03", 300, "Repair"),
        legacy("2025-12-01", 50, "Legacy only"),
      ],
    });
    expect(result).toMatchObject({ mode: "preview_only", canCommit: false, apiTransactions: 4, legacyRentecEvents: 4, alreadyRepresented: 1, probableMatch: 1, conflicting: 1, newFromApi: 1, legacyOnly: 1 });
  });

  it("does not reuse one legacy event for duplicate API records", () => {
    const record = api("2026-01-01", 1500, "Rent payment");
    const result = previewRentecLegacyReconciliation({ apiRecords: [record, record], legacyEvents: [legacy("2026-01-01", 1500, "Rent payment")] });
    expect(result.alreadyRepresented).toBe(1);
    expect(result.newFromApi).toBe(1);
  });
});
