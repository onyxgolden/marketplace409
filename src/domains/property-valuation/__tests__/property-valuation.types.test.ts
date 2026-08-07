import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPropertyValuation,
} from "../property-valuation.types";

function buildValuation(overrides = {}) {
  return {
    id: "valuation_1",
    propertyId: "property_1",
    valuationType: "owner_estimate" as const,
    source: "manual" as const,
    providerName: null,
    providerReference: null,
    amountCents: 22500000,
    currencyCode: "usd",
    effectiveAt: "2026-08-07T00:00:00.000Z",
    createdAt: "2026-08-07T00:00:00.000Z",
    notes: "Owner supplied estimate.",
    ...overrides,
  };
}

describe("PropertyValuation", () => {
  it("creates an immutable valuation with normalized presentation metadata", () => {
    const valuation = createPropertyValuation(
      buildValuation({
        providerName: "  Owner  ",
        notes: "  Reviewed manually.  ",
      }),
    );

    expect(valuation.amountCents).toBe(
      22500000,
    );
    expect(valuation.currencyCode).toBe(
      "USD",
    );
    expect(valuation.providerName).toBe(
      "Owner",
    );
    expect(valuation.notes).toBe(
      "Reviewed manually.",
    );
    expect(Object.isFrozen(valuation)).toBe(
      true,
    );
  });

  it.each([
    ["purchase_price", "spreadsheet"],
    ["owner_estimate", "manual"],
    ["appraisal", "other_provider"],
    ["assessed_value", "county_records"],
    ["provider_estimate", "zillow"],
  ] as const)(
    "supports %s valuations from %s",
    (valuationType, source) => {
      const valuation =
        createPropertyValuation(
          buildValuation({
            valuationType,
            source,
          }),
        );

      expect(valuation.valuationType).toBe(
        valuationType,
      );
      expect(valuation.source).toBe(source);
    },
  );

  it.each([
    ["id", { id: "" }],
    ["property id", { propertyId: "" }],
    [
      "amount",
      { amountCents: -1 },
    ],
    [
      "integer amount",
      { amountCents: 1.5 },
    ],
    [
      "currency",
      { currencyCode: "US" },
    ],
    [
      "effective date",
      { effectiveAt: "not-a-date" },
    ],
    [
      "creation date",
      { createdAt: "not-a-date" },
    ],
  ])(
    "rejects an invalid %s",
    (_label, overrides) => {
      expect(() =>
        createPropertyValuation(
          buildValuation(overrides),
        ),
      ).toThrow();
    },
  );

  it("rejects unsupported valuation types and sources", () => {
    expect(() =>
      createPropertyValuation(
        buildValuation({
          valuationType: "unknown",
        }) as never,
      ),
    ).toThrow(
      "Property valuation requires a supported valuation type.",
    );

    expect(() =>
      createPropertyValuation(
        buildValuation({
          source: "unknown",
        }) as never,
      ),
    ).toThrow(
      "Property valuation requires a supported source.",
    );
  });
});
