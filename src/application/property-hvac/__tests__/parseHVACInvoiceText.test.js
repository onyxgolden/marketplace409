import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseHVACInvoiceText,
} from "../parseHVACInvoiceText";

const INVOICE_TEXT = `
Arctic Air Conditioning & Heating
Invoice #603
Service Date: August 1, 2026

System was flat on refrigerant.
Found leaks at the filter drier and suction line weld.
Replaced filter drier and repaired suction line weld.
Pressure tested and pulled a vacuum.
Charged with 13 lbs R-410A.
Contactor was welded closed and was replaced.
Capacitor was out of range and was replaced.
Damaged low-voltage wire was repaired and rerouted.
Cleaned condenser coil.

Total: $950.00
`;

describe(
  "parseHVACInvoiceText",
  () => {
    it(
      "creates one reviewable event with all invoice actions",
      () => {
        const proposal =
          parseHVACInvoiceText(
            INVOICE_TEXT,
          );

        expect(
          proposal.requiresReview,
        ).toBe(true);

        expect(
          proposal.event,
        ).toMatchObject({
          eventType: "serviced",
          occurredAt:
            "2026-08-01T00:00:00.000Z",
          failureSymptoms:
            "System was flat on refrigerant.",
          costCents: 95000,
          vendorName:
            "Arctic Air Conditioning & Heating",
          invoiceReference: "603",
        });

        expect(
          proposal.event
            .componentActions,
        ).toHaveLength(9);
      },
    );

    it(
      "extracts independently reviewable component work",
      () => {
        const actions =
          parseHVACInvoiceText(
            INVOICE_TEXT,
          ).event.componentActions;

        expect(actions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionType: "replaced",
              componentType:
                "filter_drier",
            }),
            expect.objectContaining({
              actionType: "repaired",
              componentType:
                "refrigerant_line_set",
            }),
            expect.objectContaining({
              actionType: "replaced",
              componentType:
                "contactor",
            }),
            expect.objectContaining({
              actionType: "replaced",
              componentType:
                "capacitor",
            }),
            expect.objectContaining({
              actionType: "repaired",
              componentType:
                "low_voltage_wiring",
            }),
            expect.objectContaining({
              actionType: "cleaned",
              componentType:
                "condenser_coil",
            }),
            expect.objectContaining({
              actionType: "recharged",
              quantity: 13,
              unit: "pounds",
            }),
          ]),
        );
      },
    );

    it(
      "rejects empty invoice text",
      () => {
        expect(() =>
          parseHVACInvoiceText(""),
        ).toThrow(
          "HVAC invoice text is required.",
        );
      },
    );
  },
);
