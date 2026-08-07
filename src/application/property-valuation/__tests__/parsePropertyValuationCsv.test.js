import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePropertyValuationCsv,
} from "../parsePropertyValuationCsv";

describe(
  "parsePropertyValuationCsv",
  () => {
    it(
      "normalizes valuation headers and rows",
      () => {
        const result =
          parsePropertyValuationCsv(
            [
              "Property ID,Current Value,Valuation Type,Valuation Date",
              "property-1,125000,appraisal,2026-08-01",
            ].join("\n"),
          );

        expect(result.headers).toEqual([
          "property_id",
          "current_value",
          "valuation_type",
          "valuation_date",
        ]);

        expect(result.rows).toEqual([
          {
            property_id:
              "property-1",
            current_value:
              "125000",
            valuation_type:
              "appraisal",
            valuation_date:
              "2026-08-01",
          },
        ]);

        expect(
          Object.isFrozen(
            result.rows,
          ),
        ).toBe(true);
      },
    );

    it(
      "supports quoted commas, escaped quotes, and Windows line endings",
      () => {
        const result =
          parsePropertyValuationCsv(
            [
              "property_id,current_value,notes",
              '"property-1","$125,000.50","Owner said ""update"""',
            ].join("\r\n"),
          );

        expect(result.rows[0]).toEqual({
          property_id:
            "property-1",
          current_value:
            "$125,000.50",
          notes:
            'Owner said "update"',
        });
      },
    );

    it(
      "ignores blank rows",
      () => {
        const result =
          parsePropertyValuationCsv(
            "property_id,current_value\n\nproperty-1,125000\n",
          );

        expect(result.rows).toHaveLength(
          1,
        );
      },
    );

    it(
      "rejects missing required headers",
      () => {
        expect(() =>
          parsePropertyValuationCsv(
            "property_id,notes\nproperty-1,test",
          ),
        ).toThrow(
          "Property valuation CSV is missing required headers: current_value.",
        );
      },
    );

    it(
      "rejects duplicate normalized headers",
      () => {
        expect(() =>
          parsePropertyValuationCsv(
            "property_id,current value,current-value\nproperty-1,125000,125000",
          ),
        ).toThrow(
          "Property valuation CSV headers must be unique.",
        );
      },
    );

    it(
      "rejects unterminated quoted fields",
      () => {
        expect(() =>
          parsePropertyValuationCsv(
            'property_id,current_value\n"property-1,125000',
          ),
        ).toThrow(
          "Property valuation CSV contains an unterminated quoted field.",
        );
      },
    );

    it(
      "rejects rows wider than the header",
      () => {
        expect(() =>
          parsePropertyValuationCsv(
            "property_id,current_value\nproperty-1,125000,unexpected",
          ),
        ).toThrow(
          "Property valuation CSV row 2 contains more values than headers.",
        );
      },
    );
  },
);
