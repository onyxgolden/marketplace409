import { describe, expect, test } from "vitest";

import { financialEventFactory } from "../financial-event.factory";
import { rentecSemanticResolver } from "../../rentec-import";
import type { RentecImportRecord } from "../../rentec-import";

describe("FinancialEventFactory", () => {
  test("creates a financial event from a resolved financial event input", () => {
    const record: RentecImportRecord = {
      date: "2026-01-01",
      property: "170 John",
      description: "Rental Income (Rentec EasyPay)",
      type: "income",
      amount: 1500,
      sourceCategory: "Rental Income (Rentec EasyPay)",
      rawRow: {
        PROPERTY: "170 John",
      },
    };

    const event = financialEventFactory.fromResolvedInput(
      rentecSemanticResolver.resolve(record),
    );

    expect(event).toMatchObject({
      property_id: "170-john",
      event_date: "2026-01-01",
      description: "Rental Income (Rentec EasyPay)",
      amount: 1500,
      transaction_kind: "income",
      normalized_category: "rental_income",
      tax_deductible: false,
      affects_noi: true,
      capitalized: false,
      source_system: "rentec",
      source_record_id: null,
      metadata: {
        property: "170 John",
        propertyName: "170 John",
        sourceCategory: "Rental Income (Rentec EasyPay)",
      },
    });
  });

  test("creates a capitalized financial event from a resolved financial event input", () => {
    const record: RentecImportRecord = {
      date: "2014-02-07",
      property: "335 BUTLER",
      description: "Commissions (Purchase Price)",
      type: "asset_purchase",
      amount: 25256.89,
      sourceCategory: "Commissions (Purchase Price)",
      rawRow: {
        PROPERTY: "335 BUTLER",
      },
    };

    const event = financialEventFactory.fromResolvedInput(
      rentecSemanticResolver.resolve(record),
    );

    expect(event).toMatchObject({
      property_id: "335-butler",
      event_date: "2014-02-07",
      description: "Commissions (Purchase Price)",
      amount: 25256.89,
      transaction_kind: "asset_purchase",
      normalized_category: "real_estate_purchase",
      tax_deductible: false,
      affects_noi: false,
      capitalized: true,
      source_system: "rentec",
      source_record_id: null,
    });
  });
});
