import { describe, expect, it } from "vitest";
import { buildRentalPropertyPerformance } from "./buildRentalPropertyPerformance";

const TODAY = "2026-11-18";

function event(overrides) {
  return { status: "active", is_deleted: false, ...overrides };
}

function unit(overrides) {
  return { id: "unit_1", property_id: "1218-wagner", label: "1218 Wagner", status: "occupied", ...overrides };
}

function baseInput(overrides = {}) {
  return {
    units: [unit()],
    financialEvents: [],
    propertyFinancialSetups: [],
    today: TODAY,
    ...overrides,
  };
}

describe("buildRentalPropertyPerformance — attribution", () => {
  it("attributes events to the house by exact canonical slug, resolving the historical alias", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit({ property_id: "1900-w-decker", label: "1900 W Decker" })],
      financialEvents: [
        // The 2026 Rentec API pipeline wrote this house as "1900-west-decker";
        // the legacy CSV pipeline wrote "1900-w-decker". Both are one house.
        event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1900-west-decker" }),
        event({ event_date: "2026-11-06", amount: "1600.00", transaction_kind: "income", source_system: "rentec_api", property_id: "1900-w-decker" }),
      ],
    }));
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0].allTime.incomeCents).toBe(310000);
    expect(result.unassigned.eventCount).toBe(0);
  });

  it("puts null property ids and unmatched slugs in the Unassigned bucket, never in a house", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1000.00", transaction_kind: "income", source_system: "rentec", property_id: null }),
        event({ event_date: "2026-11-05", amount: "500.00", transaction_kind: "income", source_system: "rentec", property_id: "no-such-house" }),
        event({ event_date: "2026-11-05", amount: "200.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      ],
    }));
    expect(result.properties[0].allTime.incomeCents).toBe(20000);
    expect(result.unassigned.eventCount).toBe(2);
    expect(result.unassigned.allTime.incomeCents).toBe(150000);
    expect(result.unassigned.unmatchedSlugs).toEqual(["no-such-house"]);
  });

  it("keeps a unit with zero events as a $0 row instead of dropping it", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit({ property_id: "1218-wagner" }), unit({ id: "unit_2", property_id: "vacant-house", label: "Vacant House", status: "preparing" })],
    }));
    expect(result.properties).toHaveLength(2);
    const vacant = result.properties.find((property) => property.propertyId === "vacant-house");
    expect(vacant.allTime.profitCents).toBe(0);
    expect(vacant.investmentCents).toBe(0);
    expect(vacant.setupIncomplete).toBe(true);
  });

  it("returns null when the event projection is stale (no property_id field at all)", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1000.00", transaction_kind: "income", source_system: "rentec" }),
      ],
    }));
    expect(result).toBeNull();
  });
});

describe("buildRentalPropertyPerformance — profit windows", () => {
  it("computes month-to-date, year-to-date, and all-time operating profit as income minus operating expenses", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2026-11-06", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-03-10", amount: "1400.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2026-03-11", amount: "100.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        event({ event_date: "2020-06-01", amount: "1200.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2020-06-02", amount: "300.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
      ],
    }));
    const property = result.properties[0];
    expect(property.monthToDate.profitCents).toBe(130000);
    expect(property.yearToDate.profitCents).toBe(260000);
    expect(property.allTime.profitCents).toBe(350000);
  });

  it("excludes capitalized events, non-NOI expenses, untrusted sources, and transfers from operating profit", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        // Capitalized improvement: investment, not an operating expense.
        event({ event_date: "2026-11-06", amount: "50000.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "capital_improvement", affects_noi: true, capitalized: true }),
        // Non-NOI expense: excluded from operating profit.
        event({ event_date: "2026-11-07", amount: "400.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "other", affects_noi: false, capitalized: false }),
        // Bank-feed expense: untrusted source.
        event({ event_date: "2026-11-08", amount: "300.00", transaction_kind: "expense", source_system: "transaction", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        // Security-deposit transfer: not income or expense.
        event({ event_date: "2026-11-09", amount: "1000.00", transaction_kind: "transfer", source_system: "rentec", property_id: "1218-wagner" }),
        // A real operating expense, kept.
        event({ event_date: "2026-11-10", amount: "150.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
      ],
    }));
    const property = result.properties[0];
    expect(property.allTime.incomeCents).toBe(150000);
    expect(property.allTime.operatingExpensesCents).toBe(15000);
    expect(property.allTime.profitCents).toBe(135000);
    expect(property.allTime.capitalImprovementsCents).toBe(5000000);
  });

  it("pins Dec/Jan and leap-year window boundaries", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      today: "2024-02-29",
      financialEvents: [
        event({ event_date: "2024-02-29", amount: "100.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2024-02-01", amount: "50.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2024-01-31", amount: "70.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2023-12-31", amount: "90.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      ],
    }));
    const property = result.properties[0];
    expect(property.monthToDate.incomeCents).toBe(15000);
    expect(property.yearToDate.incomeCents).toBe(22000);
    expect(property.allTime.incomeCents).toBe(31000);
  });

  it("keeps pre-2014 rows out of the all-time totals and reports them as a diagnostic", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2005-01-25", amount: "999.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2007-06-01", amount: "111.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        event({ event_date: "2014-01-01", amount: "100.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      ],
    }));
    const property = result.properties[0];
    expect(property.allTime.incomeCents).toBe(10000);
    expect(result.pre2014.eventCount).toBe(2);
    expect(result.pre2014.incomeCents).toBe(99900);
    expect(result.pre2014.operatingExpensesCents).toBe(11100);
    expect(result.pre2014.profitCents).toBe(88800);
  });
});

describe("buildRentalPropertyPerformance — investment", () => {
  it("adds setup down payment + closing costs to capitalized events, without double-counting the setup echo rows", () => {
    // The live 930 Highland Drive shape: a full cash purchase ($37,500 down
    // = full price) + $628 closing costs, with the setup RPC's two echo
    // events carrying the same figures as capitalized asset_purchase rows.
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit({ id: "unit_highland", property_id: "930 Highland Drive", label: "930 Highland Drive", status: "preparing" })],
      propertyFinancialSetups: [{ property_id: "930 Highland Drive", purchase_price_cents: 3750000, down_payment_cents: 3750000, closing_costs_cents: 62800 }],
      financialEvents: [
        event({ event_date: "2026-01-15", amount: "37500.00", transaction_kind: "asset_purchase", source_system: "property_financial_setup", property_id: "930 Highland Drive", normalized_category: "real_estate_purchase", affects_noi: false, capitalized: true }),
        event({ event_date: "2026-01-15", amount: "628.00", transaction_kind: "asset_purchase", source_system: "property_financial_setup", property_id: "930 Highland Drive", normalized_category: "closing_costs", affects_noi: false, capitalized: true }),
        // A real renovation line from the same setup — this one DOES count.
        event({ event_date: "2026-02-01", amount: "5000.00", transaction_kind: "asset_purchase", source_system: "property_financial_setup", property_id: "930 Highland Drive", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      ],
    }));
    const property = result.properties[0];
    expect(property.hasSetup).toBe(true);
    expect(property.setupCashCents).toBe(3812800);
    // $37,500 down + $628 closing + $5,000 renovation = $43,128. The two
    // echo events ($37,500 + $628) are NOT added again.
    expect(property.investmentCents).toBe(4312800);
    expect(property.capitalImprovementsCents).toBe(500000);
    expect(result.diagnostics.setupEchoEventCount).toBe(2);
  });

  it("excludes a legacy acquisition-price asset_purchase from cash invested", () => {
    // A legacy Rentec asset_purchase row with an acquisition-price category
    // is the full purchase price, which can include financed money — it is
    // NOT cash equity paid, so it must never be labelled cash invested.
    // The property has no setup row, so its investment is unknown/partial.
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2020-05-01", amount: "180000.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "1218-wagner", normalized_category: "real_estate_purchase", affects_noi: false, capitalized: true }),
      ],
    }));
    const property = result.properties[0];
    expect(property.hasSetup).toBe(false);
    expect(property.setupIncomplete).toBe(true);
    expect(property.investmentCents).toBe(0);
    expect(property.capitalImprovementsCents).toBe(0);
    expect(result.diagnostics.excludedAcquisitionEventCount).toBe(1);
    expect(result.diagnostics.excludedAcquisitionCents).toBe(18000000);
    expect(result.diagnostics.ineligibleEventCount).toBe(0);
  });

  it("does not add a financed legacy purchase price to cash invested when a setup row exists", () => {
    // Fictional financed purchase: the setup row records the cash actually
    // paid (down payment + closing costs); the legacy asset_purchase row is
    // the full purchase price including the financed portion and must not be
    // added. A legacy capital-improvement row still counts.
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit({ id: "unit_finance", property_id: "999-example", label: "999 Example", status: "occupied" })],
      propertyFinancialSetups: [{ property_id: "999-example", purchase_price_cents: 15000000, down_payment_cents: 2500000, closing_costs_cents: 500000 }],
      financialEvents: [
        event({ event_date: "2020-05-01", amount: "150000.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "999-example", normalized_category: "real_estate_purchase", affects_noi: false, capitalized: true }),
        event({ event_date: "2020-06-01", amount: "10000.00", transaction_kind: "expense", source_system: "rentec", property_id: "999-example", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      ],
    }));
    const property = result.properties[0];
    expect(property.hasSetup).toBe(true);
    expect(property.setupCashCents).toBe(3000000);
    // $25,000 down + $5,000 closing + $10,000 capital improvement = $40,000.
    // The $150,000 legacy purchase-price row is excluded.
    expect(property.investmentCents).toBe(4000000);
    expect(property.capitalImprovementsCents).toBe(1000000);
    expect(result.diagnostics.excludedAcquisitionEventCount).toBe(1);
    expect(result.diagnostics.excludedAcquisitionCents).toBe(15000000);
  });

  it("counts legacy capital-improvement rows as invested cash even with no setup row", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        // A legacy Rentec renovation line (asset_purchase, capital_improvement).
        event({ event_date: "2020-05-01", amount: "50000.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "1218-wagner", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
        // A legacy capitalized improvement expense.
        event({ event_date: "2020-06-01", amount: "8000.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      ],
    }));
    const property = result.properties[0];
    expect(property.hasSetup).toBe(false);
    expect(property.setupIncomplete).toBe(true);
    // $50,000 + $8,000 of verified capital improvements — a partial known
    // amount, not a complete recorded-cash-invested total.
    expect(property.investmentCents).toBe(5800000);
    expect(property.capitalImprovementsCents).toBe(5800000);
    expect(result.diagnostics.excludedAcquisitionEventCount).toBe(0);
  });

  it("never puts the business-expenses capitalized bucket in a house", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1000.00", transaction_kind: "expense", source_system: "rentec", property_id: "business-expenses", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      ],
    }));
    expect(result.properties[0].investmentCents).toBe(0);
    expect(result.unassigned.capitalImprovementsCents).toBe(100000);
    expect(result.unassigned.investmentCents).toBe(100000);
  });
});

describe("buildRentalPropertyPerformance — property tax and expenses", () => {
  it("counts property tax only (property_tax + taxes_property_tax) as a subset of operating expenses", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "1000.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
        event({ event_date: "2026-11-06", amount: "800.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "property_tax", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-07", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "taxes_property_tax", affects_noi: true, capitalized: false }),
        // Generic / federal / state tax are NOT property tax.
        event({ event_date: "2026-11-08", amount: "500.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "taxes", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-09", amount: "300.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "taxes_federal_tax", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-10", amount: "100.00", transaction_kind: "expense", source_system: "manual", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
      ],
    }));
    const property = result.properties[0];
    expect(property.allTime.propertyTaxCents).toBe(100000);
    // Operating expenses include ALL of the above (190,000); tax is a subset.
    expect(property.allTime.operatingExpensesCents).toBe(190000);
    expect(property.allTime.profitCents).toBe(-90000);
  });

  it("groups operating expenses by category and sums exactly to the operating-expense subtotal", () => {
    const result = buildRentalPropertyPerformance(baseInput({
      financialEvents: [
        event({ event_date: "2026-11-05", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-06", amount: "50.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-07", amount: "800.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "property_tax", affects_noi: true, capitalized: false }),
        event({ event_date: "2026-11-08", amount: "25.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: null, affects_noi: true, capitalized: false }),
      ],
    }));
    const property = result.properties[0];
    const categories = property.expenseCategories.allTime;
    expect(categories.reduce((sum, entry) => sum + entry.cents, 0)).toBe(property.allTime.operatingExpensesCents);
    expect(categories.find((entry) => entry.category === "repairs_maintenance").cents).toBe(25000);
    expect(categories.find((entry) => entry.category === "property_tax").cents).toBe(80000);
    expect(categories.find((entry) => entry.category === "uncategorized").label).toBe("Uncategorized");
  });
});

describe("buildRentalPropertyPerformance — portfolio totals and parity", () => {
  it("reconciles per-property + unassigned exactly to independently grouped source totals", () => {
    const events = [
      event({ event_date: "2026-11-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", property_id: "1218-wagner" }),
      event({ event_date: "2026-11-06", amount: "200.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
      event({ event_date: "2026-11-06", amount: "800.00", transaction_kind: "expense", source_system: "rentec", property_id: "1218-wagner", normalized_category: "property_tax", affects_noi: true, capitalized: false }),
      event({ event_date: "2026-11-07", amount: "50000.00", transaction_kind: "asset_purchase", source_system: "rentec", property_id: "1218-wagner", normalized_category: "capital_improvement", affects_noi: false, capitalized: true }),
      event({ event_date: "2026-11-05", amount: "900.00", transaction_kind: "income", source_system: "rentec", property_id: "unmatched-house" }),
      event({ event_date: "2026-11-06", amount: "100.00", transaction_kind: "expense", source_system: "rentec", property_id: "unmatched-house", normalized_category: "repairs_maintenance", affects_noi: true, capitalized: false }),
    ];
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit(), unit({ id: "unit_2", property_id: "185-laxon", label: "185 Laxon", status: "preparing" })],
      financialEvents: events,
    }));

    // Independent grouping straight from the source rows (same filters, no
    // shared code path with the helper): every eligible cent must appear
    // exactly once, in exactly one bucket.
    const expected = { income: 0, expenses: 0, tax: 0, capital: 0 };
    for (const row of events) {
      const cents = Math.round(Math.abs(Number(row.amount)) * 100);
      if (row.transaction_kind === "income") expected.income += cents;
      if (row.transaction_kind === "expense" && row.affects_noi === true && row.capitalized !== true) {
        expected.expenses += cents;
        if (row.normalized_category === "property_tax") expected.tax += cents;
      }
      if (row.capitalized === true) expected.capital += cents;
    }
    const actual = [...result.properties, result.unassigned].reduce((acc, bucket) => ({
      income: acc.income + bucket.allTime.incomeCents,
      expenses: acc.expenses + bucket.allTime.operatingExpensesCents,
      tax: acc.tax + bucket.allTime.propertyTaxCents,
      capital: acc.capital + bucket.allTime.capitalImprovementsCents,
    }), { income: 0, expenses: 0, tax: 0, capital: 0 });
    expect(actual).toEqual(expected);

    // Portfolio total is the sum of house rows only — unmatched stays separate.
    expect(result.portfolioTotals.allTime.incomeCents).toBe(150000);
    expect(result.portfolioTotals.allTime.profitCents).toBe(50000);
    expect(result.portfolioTotals.investmentCents).toBe(5000000);
    expect(result.unassigned.allTime.profitCents).toBe(80000);
  });

  it("aggregates a full 12,393-row history in one linear pass with exact totals", () => {
    const events = [];
    let expectedIncome = 0;
    let expectedExpenses = 0;
    for (let index = 0; index < 12393; index += 1) {
      const isIncome = index % 3 !== 0;
      const amount = ((index % 97) + 1) * 10;
      const eventDate = `20${String(14 + (index % 13)).padStart(2, "0")}-${String((index % 12) + 1).padStart(2, "0")}-15`;
      events.push(event({
        event_date: eventDate,
        amount: String(amount),
        transaction_kind: isIncome ? "income" : "expense",
        source_system: "rentec",
        property_id: index % 2 === 0 ? "1218-wagner" : "185-laxon",
        normalized_category: isIncome ? null : "repairs_maintenance",
        affects_noi: true,
        capitalized: false,
      }));
      // The all-time window is 2014-01-01 through the reference date
      // (2026-11-18): a synthetic 2026-12 row falls outside it.
      if (eventDate >= "2014-01-01" && eventDate <= TODAY) {
        if (isIncome) expectedIncome += amount * 100;
        else expectedExpenses += amount * 100;
      }
    }
    const result = buildRentalPropertyPerformance(baseInput({
      units: [unit(), unit({ id: "unit_2", property_id: "185-laxon", label: "185 Laxon", status: "preparing" })],
      financialEvents: events,
    }));
    expect(result.properties).toHaveLength(2);
    const totalIncome = result.properties.reduce((sum, property) => sum + property.allTime.incomeCents, 0)
      + result.unassigned.allTime.incomeCents;
    const totalExpenses = result.properties.reduce((sum, property) => sum + property.allTime.operatingExpensesCents, 0)
      + result.unassigned.allTime.operatingExpensesCents;
    expect(totalIncome).toBe(expectedIncome);
    expect(totalExpenses).toBe(expectedExpenses);
    expect(result.diagnostics.ineligibleEventCount).toBe(0);
  });
});
