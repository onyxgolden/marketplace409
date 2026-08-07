import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapPropertyValuationRowToPropertyValuation,
  mapPropertyValuationToRow,
} from "../property-valuation.mapper";

import {
  createPropertyValuation,
} from "../property-valuation.types";

describe("property valuation mapper", () => {
  it("maps a persistence row into an immutable domain valuation", () => {
    const valuation =
      mapPropertyValuationRowToPropertyValuation({
        id: "valuation_1",
        owner_id: "owner_1",
        property_id: "1214-wagner",
        valuation_type: "owner_estimate",
        source: "manual",
        provider_name: null,
        provider_reference: null,
        amount_cents: 22500000,
        currency_code: "USD",
        effective_at:
          "2026-08-07T00:00:00.000Z",
        created_at:
          "2026-08-07T01:00:00.000Z",
        notes: "Owner supplied.",
      });

    expect(valuation).toEqual({
      id: "valuation_1",
      propertyId: "1214-wagner",
      valuationType: "owner_estimate",
      source: "manual",
      providerName: null,
      providerReference: null,
      amountCents: 22500000,
      currencyCode: "USD",
      effectiveAt:
        "2026-08-07T00:00:00.000Z",
      createdAt:
        "2026-08-07T01:00:00.000Z",
      notes: "Owner supplied.",
    });
    expect(Object.isFrozen(valuation)).toBe(
      true,
    );
  });

  it("maps a domain valuation into an owner-scoped persistence row", () => {
    const valuation = createPropertyValuation({
      id: "valuation_1",
      propertyId: "1214-wagner",
      valuationType: "provider_estimate",
      source: "zillow",
      providerName: "Zillow",
      providerReference: "zpid_123",
      amountCents: 23500000,
      currencyCode: "USD",
      effectiveAt:
        "2026-08-07T00:00:00.000Z",
      createdAt:
        "2026-08-07T01:00:00.000Z",
      notes: null,
    });

    expect(
      mapPropertyValuationToRow(
        valuation,
        "owner_1",
      ),
    ).toEqual({
      id: "valuation_1",
      owner_id: "owner_1",
      property_id: "1214-wagner",
      valuation_type: "provider_estimate",
      source: "zillow",
      provider_name: "Zillow",
      provider_reference: "zpid_123",
      amount_cents: 23500000,
      currency_code: "USD",
      effective_at:
        "2026-08-07T00:00:00.000Z",
      created_at:
        "2026-08-07T01:00:00.000Z",
      notes: null,
    });
  });

  it("requires owner scope when mapping a persistence row", () => {
    const valuation = createPropertyValuation({
      id: "valuation_1",
      propertyId: "1214-wagner",
      valuationType: "owner_estimate",
      source: "manual",
      providerName: null,
      providerReference: null,
      amountCents: 22500000,
      currencyCode: "USD",
      effectiveAt:
        "2026-08-07T00:00:00.000Z",
      createdAt:
        "2026-08-07T01:00:00.000Z",
      notes: null,
    });

    expect(() =>
      mapPropertyValuationToRow(
        valuation,
        "",
      ),
    ).toThrow(
      "Property valuation owner id is required.",
    );
  });
});
