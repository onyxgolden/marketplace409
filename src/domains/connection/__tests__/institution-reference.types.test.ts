import {
  INSTITUTION_REFERENCE_TYPES,
  type InstitutionReference,
} from "../institution-reference.types";

describe("InstitutionReference", () => {
  it("supports provider-agnostic institution reference types", () => {
    expect(INSTITUTION_REFERENCE_TYPES).toEqual([
      "bank",
      "credit_card_issuer",
      "payment_processor",
      "accounting_platform",
      "property_management_platform",
      "csv_source",
      "manual_source",
      "future_integration",
    ]);
  });

  it("represents an external institution connected to FORGE", () => {
    const institutionReference: InstitutionReference = {
      id: "institution_001",
      connectionId: "connection_001",
      name: "Orange County Credit Union",
      type: "bank",
      provider: "plaid",
      externalInstitutionId: "ins_001",
      websiteUrl: "https://example.com",
      logoUrl: "https://example.com/logo.png",
      createdAt: "2026-06-30T23:00:00.000Z",
      updatedAt: "2026-06-30T23:00:00.000Z",
    };

    expect(institutionReference.connectionId).toBe("connection_001");
    expect(institutionReference.type).toBe("bank");
    expect(institutionReference.externalInstitutionId).toBe("ins_001");
  });

  it("supports manual and CSV-backed sources without external institution ids", () => {
    const institutionReference: InstitutionReference = {
      id: "institution_002",
      connectionId: "connection_002",
      name: "Owner Manual Entry",
      type: "manual_source",
      provider: "manual",
      createdAt: "2026-06-30T23:05:00.000Z",
      updatedAt: "2026-06-30T23:05:00.000Z",
    };

    expect(institutionReference.provider).toBe("manual");
    expect(institutionReference.externalInstitutionId).toBeUndefined();
  });

  it("does not store credentials or account balances", () => {
    const institutionReference: InstitutionReference = {
      id: "institution_003",
      connectionId: "connection_003",
      name: "Stripe",
      type: "payment_processor",
      provider: "stripe",
      externalInstitutionId: "acct_001",
      createdAt: "2026-06-30T23:10:00.000Z",
      updatedAt: "2026-06-30T23:10:00.000Z",
    };

    expect(Object.keys(institutionReference)).not.toContain("secret");
    expect(Object.keys(institutionReference)).not.toContain("accessToken");
    expect(Object.keys(institutionReference)).not.toContain("apiKey");
    expect(Object.keys(institutionReference)).not.toContain("balance");
    expect(Object.keys(institutionReference)).not.toContain("transactions");
  });
});
