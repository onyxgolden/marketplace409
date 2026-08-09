import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import PropertyEvidenceHistoryPanel, {
  PropertyEvidenceHistoryList,
  buildPropertyEvidenceUrl,
} from "../PropertyEvidenceHistoryPanel.jsx";

describe(
  "PropertyEvidenceHistoryPanel",
  () => {
    it(
      "renders the property evidence history boundary",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyEvidenceHistoryPanel
              propertyId=""
            />,
          );

        expect(markup).toContain(
          "data-property-evidence-history-panel",
        );

        expect(markup).toContain(
          "Private evidence history",
        );

        expect(markup).toContain(
          "Choose a property to view its private evidence.",
        );

        expect(markup).toContain(
          "Refresh evidence",
        );
      },
    );

    it(
      "renders provenance, links, and review states without storage paths",
      () => {
        const markup =
          renderToStaticMarkup(
            <PropertyEvidenceHistoryList
              systems={[
                {
                  id:
                    "system-1",
                  name:
                    "Main HVAC",
                },
              ]}
              evidence={[
                {
                  id:
                    "property_evidence_1",
                  propertyId:
                    "1214-wagner",
                  hvacSystemId:
                    "system-1",
                  hvacEventId:
                    "event-1",
                  originalFilename:
                    "Invoice 603.pdf",
                  mimeType:
                    "application/pdf",
                  byteSize: 400,
                  extractionMethod:
                    "native_pdf",
                  parserVersion:
                    "hvac-invoice-v1",
                  reviewStatus:
                    "approved",
                  createdAt:
                    "2026-08-08T21:00:00.000Z",
                  accessUrl:
                    "https://private.example/signed",
                },
                {
                  id:
                    "property_evidence_2",
                  propertyId:
                    "1214-wagner",
                  hvacSystemId:
                    null,
                  hvacEventId:
                    null,
                  originalFilename:
                    "Unreadable photo.png",
                  mimeType:
                    "image/png",
                  byteSize: 1536,
                  extractionMethod:
                    "google_cloud_vision",
                  parserVersion:
                    null,
                  reviewStatus:
                    "extraction_failed",
                  createdAt:
                    "2026-08-09T00:00:00.000Z",
                  accessUrl:
                    "https://private.example/failed",
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "Invoice 603.pdf",
        );

        expect(markup).toContain(
          "Aug 8, 2026",
        );

        expect(markup).toContain(
          "Native PDF",
        );

        expect(markup).toContain(
          "hvac-invoice-v1",
        );

        expect(markup).toContain(
          "Main HVAC",
        );

        expect(markup).toContain(
          "Linked to approved service event",
        );

        expect(markup).toContain(
          'title="event-1"',
        );


        expect(markup).toContain(
          "Approved",
        );

        expect(markup).toContain(
          "Extraction failed",
        );

        expect(markup).toContain(
          "1.5 KB",
        );

        expect(markup).toContain(
          "https://private.example/signed",
        );

        expect(markup).not.toContain(
          "objectPath",
        );

        expect(markup).not.toContain(
          "property-evidence/",
        );
      },
    );

    it(
      "builds an encoded owner-safe evidence endpoint",
      () => {
        expect(
          buildPropertyEvidenceUrl(
            " 1214 Wagner ",
          ),
        ).toBe(
          "/api/property-evidence?propertyId=1214%20Wagner",
        );

        expect(
          buildPropertyEvidenceUrl(
            " ",
          ),
        ).toBeNull();
      },
    );
  },
);
