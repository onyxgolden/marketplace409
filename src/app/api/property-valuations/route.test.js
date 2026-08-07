import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedPropertyValuationApplication:
    vi.fn(),
  recordManual:
    vi.fn(),
  previewSpreadsheetRows:
    vi.fn(),
  importSpreadsheetRows:
    vi.fn(),
  listLatest:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyValuationApplication",
  () => ({
    createAuthenticatedPropertyValuationApplication:
      mocks.createAuthenticatedPropertyValuationApplication,
  }),
);

import {
  GET,
  POST,
} from "./route";

function configureAuthenticatedRequest() {
  mocks.createAuthenticatedPropertyValuationApplication
    .mockResolvedValue({
      user: {
        id:
          "authenticated-owner",
      },
      application: {
        recordManual:
          mocks.recordManual,
        previewSpreadsheetRows:
          mocks.previewSpreadsheetRows,
        importSpreadsheetRows:
          mocks.importSpreadsheetRows,
        listLatest:
          mocks.listLatest,
      },
    });
}

function createRequest(body) {
  return new Request(
    "http://localhost/api/property-valuations",
    {
      method:
        "POST",
      body:
        JSON.stringify(body),
    },
  );
}

describe(
  "GET /api/property-valuations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns latest valuations using authenticated owner authority",
      async () => {
        configureAuthenticatedRequest();

        const valuations = [
          {
            id:
              "valuation-1",
            propertyId:
              "property-1",
            amountCents:
              12500000,
          },
        ];

        mocks.listLatest
          .mockResolvedValue(
            valuations,
          );

        const response =
          await GET();

        expect(
          mocks.listLatest,
        ).toHaveBeenCalledWith(
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          valuations,
        });
      },
    );

    it(
      "returns the authentication response unchanged",
      async () => {
        const authenticationResponse =
          Response.json(
            {
              error:
                "Authenticated owner id is required.",
            },
            {
              status:
                401,
            },
          );

        mocks.createAuthenticatedPropertyValuationApplication
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await GET();

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          mocks.listLatest,
        ).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "POST /api/property-valuations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns the authentication response unchanged",
      async () => {
        const authenticationResponse =
          Response.json(
            {
              error:
                "Authenticated owner id is required.",
            },
            {
              status: 401,
            },
          );

        mocks.createAuthenticatedPropertyValuationApplication
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await POST(
            createRequest({
              operation:
                "record-manual",
              valuation: {
                propertyId:
                  "property-1",
                amount:
                  125000,
              },
            }),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          mocks.recordManual,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "records a manual valuation using only the authenticated owner",
      async () => {
        configureAuthenticatedRequest();

        const valuation = {
          id:
            "valuation-1",
          propertyId:
            "property-1",
          amountCents:
            12500000,
          source:
            "manual",
        };

        mocks.recordManual
          .mockResolvedValue(
            valuation,
          );

        const response =
          await POST(
            createRequest({
              operation:
                "record-manual",
              ownerId:
                "spoofed-owner",
              valuation: {
                propertyId:
                  "property-1",
                amount:
                  125000,
                ownerId:
                  "spoofed-owner",
                source:
                  "spreadsheet",
              },
            }),
          );

        expect(response.status).toBe(
          200,
        );

        expect(
          mocks.recordManual,
        ).toHaveBeenCalledWith(
          {
            propertyId:
              "property-1",
            amount:
              125000,
            ownerId:
              "spoofed-owner",
            source:
              "spreadsheet",
          },
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          valuation,
        });
      },
    );

    it(
      "previews spreadsheet rows without persistence",
      async () => {
        configureAuthenticatedRequest();

        const rows = [
          {
            property_id:
              "property-1",
            current_value:
              "125000",
          },
        ];

        const preview = {
          valid:
            true,
          rowCount:
            1,
          validRowCount:
            1,
          invalidRowCount:
            0,
          valuations:
            [],
          errors:
            [],
        };

        mocks.previewSpreadsheetRows
          .mockReturnValue(
            preview,
          );

        const response =
          await POST(
            createRequest({
              operation:
                "preview-spreadsheet",
              rows,
            }),
          );

        expect(
          mocks.previewSpreadsheetRows,
        ).toHaveBeenCalledWith(
          rows,
        );

        expect(
          mocks.importSpreadsheetRows,
        ).not.toHaveBeenCalled();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          preview,
        });
      },
    );

    it(
      "imports spreadsheet rows using authenticated owner authority",
      async () => {
        configureAuthenticatedRequest();

        const rows = [
          {
            property_id:
              "property-1",
            current_value:
              "125000",
          },
        ];

        const result = {
          valid:
            true,
          rowCount:
            1,
          validRowCount:
            1,
          invalidRowCount:
            0,
          valuations:
            [],
          errors:
            [],
          importedCount:
            1,
          persistedValuations:
            [],
        };

        mocks.importSpreadsheetRows
          .mockResolvedValue(
            result,
          );

        const response =
          await POST(
            createRequest({
              operation:
                "import-spreadsheet",
              ownerId:
                "spoofed-owner",
              rows,
            }),
          );

        expect(
          mocks.importSpreadsheetRows,
        ).toHaveBeenCalledWith(
          rows,
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          result,
        });
      },
    );

    it(
      "returns a non-success result for an invalid spreadsheet",
      async () => {
        configureAuthenticatedRequest();

        const result = {
          valid:
            false,
          rowCount:
            1,
          validRowCount:
            0,
          invalidRowCount:
            1,
          valuations:
            [],
          errors: [
            {
              rowNumber:
                2,
              message:
                "Property valuation amount is required.",
            },
          ],
          importedCount:
            0,
          persistedValuations:
            [],
        };

        mocks.importSpreadsheetRows
          .mockResolvedValue(
            result,
          );

        const response =
          await POST(
            createRequest({
              operation:
                "import-spreadsheet",
              rows: [
                {
                  property_id:
                    "property-1",
                },
              ],
            }),
          );

        expect(response.status).toBe(
          200,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            false,
          result,
        });
      },
    );

    it(
      "rejects unsupported operations",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            createRequest({
              operation:
                "delete-everything",
            }),
          );

        expect(response.status).toBe(
          400,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "A supported property valuation operation is required.",
        });
      },
    );

    it(
      "rejects missing operation inputs",
      async () => {
        configureAuthenticatedRequest();

        const manualResponse =
          await POST(
            createRequest({
              operation:
                "record-manual",
            }),
          );

        expect(
          manualResponse.status,
        ).toBe(400);

        const spreadsheetResponse =
          await POST(
            createRequest({
              operation:
                "import-spreadsheet",
              rows:
                null,
            }),
          );

        expect(
          spreadsheetResponse.status,
        ).toBe(400);

        expect(
          mocks.recordManual,
        ).not.toHaveBeenCalled();

        expect(
          mocks.importSpreadsheetRows,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns operation failures as server errors",
      async () => {
        configureAuthenticatedRequest();

        mocks.recordManual
          .mockRejectedValue(
            new Error(
              "Unable to persist valuation.",
            ),
          );

        const consoleError =
          vi.spyOn(
            console,
            "error",
          )
            .mockImplementation(
              () => {},
            );

        const response =
          await POST(
            createRequest({
              operation:
                "record-manual",
              valuation: {
                propertyId:
                  "property-1",
                amount:
                  125000,
              },
            }),
          );

        expect(response.status).toBe(
          500,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Unable to persist valuation.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
