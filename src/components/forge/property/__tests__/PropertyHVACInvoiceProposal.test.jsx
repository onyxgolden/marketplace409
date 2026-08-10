import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyHVACEventPanel, {
  applyHVACInvoiceProposal,
  buildHVACEventOperation,
  buildHVACInvoiceFormData,
} from "../PropertyHVACEventPanel.jsx";

describe(
  "PropertyHVACEventPanel invoice proposals",
  () => {
    it(
      "renders an active invoice and photo control",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyHVACEventPanel
              systemId="system_1"
            />,
          );

        expect(markup).toContain(
          "Add invoice or service photo",
        );

        expect(markup).toContain(
          'type="file"',
        );

        expect(markup).toContain(
          "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png",
        );

        expect(markup).not.toContain(
          "Add invoice or service photo — planned",
        );
      },
    );

    it(
      "builds owner-context invoice form data",
      () => {
        const file =
          new Blob(
            ["invoice"],
            {
              type:
                "application/pdf",
            },
          );

        const formData =
          buildHVACInvoiceFormData({
            file,
            propertyId:
              "1214-wagner",
            systemId:
              "system_1",
          });

        expect(
          formData.get(
            "invoice",
          ),
        ).toMatchObject({
          size: 7,
          type:
            "application/pdf",
        });

        expect(
          formData.get(
            "propertyId",
          ),
        ).toBe(
          "1214-wagner",
        );

        expect(
          formData.get(
            "systemId",
          ),
        ).toBe(
          "system_1",
        );
      },
    );

    it(
      "retains evidence identity in the event operation",
      () => {
        const operation =
          buildHVACEventOperation({
            systemId:
              "system_1",
            values: {
              componentId: "",
              eventType:
                "serviced",
              occurredAt:
                "2026-08-01",
              failureSymptoms: "",
              workPerformed:
                "Invoice work",
              costDollars:
                "950",
              vendorName: "",
              invoiceReference:
                "603",
              componentActions: [],
              notes: "",
            },
            evidenceId:
              "property_evidence_1",
          });

        expect(operation).toMatchObject({
          operation:
            "record-component-event",
          evidenceId:
            "property_evidence_1",
          event: {
            systemId:
              "system_1",
            invoiceReference:
              "603",
            costCents:
              95000,
          },
        });
      },
    );

    it(
      "applies the entire invoice proposal at once",
      () => {
        const values =
          applyHVACInvoiceProposal(
            {
              componentId:
                "component_1",
              eventType:
                "inspected",
              occurredAt:
                "2026-08-08",
              failureSymptoms: "",
              workPerformed: "",
              costDollars: "",
              vendorName: "",
              invoiceReference: "",
              componentActions: [],
              notes: "",
            },
            {
              event: {
                eventType:
                  "serviced",
                occurredAt:
                  "2026-08-01T00:00:00.000Z",
                failureSymptoms:
                  "System was flat on refrigerant.",
                workPerformed:
                  "Completed invoice work.",
                costCents: 95000,
                vendorName:
                  "Arctic Air Conditioning & Heating",
                invoiceReference:
                  "603",
                componentActions: [
                  {
                    actionType:
                      "replaced",
                    componentId: null,
                    componentType:
                      "filter_drier",
                    description:
                      "Replaced filter drier.",
                    quantity: null,
                    unit: null,
                    allocatedCostCents:
                      null,
                  },
                  {
                    actionType:
                      "recharged",
                    componentId: null,
                    componentType:
                      null,
                    description:
                      "Charged with R-410A.",
                    quantity: 13,
                    unit: "pounds",
                    allocatedCostCents:
                      null,
                  },
                ],
                notes:
                  "Review before saving.",
              },
            },
          );

        expect(values).toMatchObject({
          componentId:
            "component_1",
          eventType: "serviced",
          occurredAt:
            "2026-08-01",
          failureSymptoms:
            "System was flat on refrigerant.",
          workPerformed:
            "Completed invoice work.",
          costDollars: "950",
          vendorName:
            "Arctic Air Conditioning & Heating",
          invoiceReference: "603",
          notes:
            "Review before saving.",
        });

        expect(
          values.componentActions,
        ).toHaveLength(2);
      },
    );
  },
);
