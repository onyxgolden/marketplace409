import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate:
    vi.fn(),
  listEvidence:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication",
  () => ({
    createAuthenticatedPropertyEvidenceApplication:
      mocks.authenticate,
  }),
);

import {
  GET,
} from "./route";

function authenticate() {
  mocks.authenticate
    .mockResolvedValue({
      user: {
        id:
          "authenticated-owner",
      },
      application: {
        listEvidence:
          mocks.listEvidence,
      },
    });
}

describe(
  "GET /api/property-evidence",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "lists signed evidence through authenticated owner authority",
      async () => {
        authenticate();

        const evidence = [
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
            updatedAt:
              "2026-08-08T22:00:00.000Z",
            accessUrl:
              "https://private.example/signed",
            accessExpiresInSeconds:
              300,
          },
        ];

        mocks.listEvidence
          .mockResolvedValue(
            evidence,
          );

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-evidence" +
                "?propertyId=%201214-wagner%20" +
                "&hvacSystemId=%20system-1%20" +
                "&hvacEventId=%20event-1%20" +
                "&reviewStatus=%20approved%20" +
                "&ownerId=spoofed-owner",
            ),
          );

        expect(
          mocks.listEvidence,
        ).toHaveBeenCalledWith(
          {
            propertyId:
              "1214-wagner",
            hvacSystemId:
              "system-1",
            hvacEventId:
              "event-1",
            reviewStatus:
              "approved",
          },
          "authenticated-owner",
        );

        expect(response.status).toBe(
          200,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          evidence,
        });
      },
    );

    it(
      "requires a property identity",
      async () => {
        authenticate();

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-evidence",
            ),
          );

        expect(response.status).toBe(
          400,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "propertyId is required.",
        });

        expect(
          mocks.listEvidence,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "passes through authentication failure",
      async () => {
        const authenticationResponse =
          Response.json(
            {
              error:
                "Authentication required.",
            },
            {
              status: 401,
            },
          );

        mocks.authenticate
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-evidence?propertyId=1214-wagner",
            ),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          mocks.listEvidence,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns controlled query failures",
      async () => {
        authenticate();

        mocks.listEvidence
          .mockRejectedValue(
            new Error(
              "Private signing failed.",
            ),
          );

        const response =
          await GET(
            new Request(
              "http://localhost/api/property-evidence?propertyId=1214-wagner",
            ),
          );

        expect(response.status).toBe(
          500,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Private signing failed.",
        });
      },
    );
  },
);
