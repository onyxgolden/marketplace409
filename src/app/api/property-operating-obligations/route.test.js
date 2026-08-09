import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  list: vi.fn(),
  buildAccrualProjection:
    vi.fn(),
  previewSpreadsheet:
    vi.fn(),
  importSpreadsheet:
    vi.fn(),
  createVerifiedPolicy:
    vi.fn(),
  verifyCoverage:
    vi.fn(),
  reconcilePayment:
    vi.fn(),
  loadImportContext:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyOperatingObligationApplication",
  () => ({
    createAuthenticatedPropertyOperatingObligationApplication:
      mocks.authenticate,
  }),
);

import {
  GET,
  POST,
} from "./route";

function authenticate() {
  mocks.authenticate.mockResolvedValue({
    user: {
      id:
        "authenticated-owner",
    },
    application: {
      list: mocks.list,
      buildAccrualProjection:
        mocks.buildAccrualProjection,
      previewSpreadsheet:
        mocks.previewSpreadsheet,
      importSpreadsheet:
        mocks.importSpreadsheet,
      createVerifiedPolicy:
        mocks.createVerifiedPolicy,
      verifyCoverage:
        mocks.verifyCoverage,
      reconcilePayment:
        mocks.reconcilePayment,
    },
    loadImportContext:
      mocks.loadImportContext,
  });
}

function request({
  method = "GET",
  query = "",
  body = null,
} = {}) {
  return new Request(
    `http://localhost/api/property-operating-obligations${query}`,
    {
      method,
      body:
        body === null
          ? undefined
          : JSON.stringify(body),
    },
  );
}

describe(
  "/api/property-operating-obligations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      authenticate();

      mocks.list.mockResolvedValue(
        [],
      );
      mocks.loadImportContext
        .mockResolvedValue({
          properties: [
            {
              id:
                "1214-wagner",
            },
          ],
          financialEvents: [
            {
              id:
                "financial_event_1",
            },
          ],
        });
    });

    it(
      "lists obligations through authenticated owner filters",
      async () => {
        const obligations = [
          {
            id:
              "obligation_1",
          },
        ];

        mocks.list.mockResolvedValue(
          obligations,
        );

        const response =
          await GET(
            request({
              query:
                "?propertyId=%201214-wagner%20" +
                "&scope=property" +
                "&obligationType=property_tax" +
                "&status=active" +
                "&recognitionStatus=accrual_ready" +
                "&unreconciledOnly=true",
            }),
          );

        expect(
          mocks.list,
        ).toHaveBeenCalledWith(
          {
            propertyId:
              "1214-wagner",
            scope: "property",
            obligationType:
              "property_tax",
            status: "active",
            recognitionStatus:
              "accrual_ready",
            unreconciledOnly:
              true,
          },
          "authenticated-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          obligations,
          projection: null,
        });
      },
    );

    it(
      "returns an optional accrual projection",
      async () => {
        const projection = {
          propertyExpenseCents: {
            "1214-wagner":
              100000,
          },
        };

        mocks.buildAccrualProjection
          .mockResolvedValue(
            projection,
          );

        const response =
          await GET(
            request({
              query:
                "?periodStart=2025-01-01" +
                "&periodEnd=2026-01-01",
            }),
          );

        expect(
          mocks.buildAccrualProjection,
        ).toHaveBeenCalledWith({
          ownerId:
            "authenticated-owner",
          periodStart:
            "2025-01-01",
          periodEnd:
            "2026-01-01",
          query: {
            propertyId: null,
            scope: null,
            obligationType:
              null,
            status: null,
            recognitionStatus:
              null,
            unreconciledOnly:
              false,
          },
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          obligations: [],
          projection,
        });
      },
    );

    it(
      "requires complete projection dates",
      async () => {
        const response =
          await GET(
            request({
              query:
                "?periodStart=2025-01-01",
            }),
          );

        expect(response.status).toBe(
          400,
        );
        expect(
          mocks.list,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "previews against server-loaded properties and events",
      async () => {
        const preview = {
          valid: true,
          obligations: [],
        };

        mocks.previewSpreadsheet
          .mockReturnValue(preview);

        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "preview-spreadsheet",
                csv: "ledger",
                ownerId:
                  "spoofed-owner",
                properties: [
                  {
                    id:
                      "spoofed-property",
                  },
                ],
              },
            }),
          );

        expect(
          mocks.previewSpreadsheet,
        ).toHaveBeenCalledWith({
          csv: "ledger",
          properties: [
            {
              id:
                "1214-wagner",
            },
          ],
          financialEvents: [
            {
              id:
                "financial_event_1",
            },
          ],
          taxServiceYear: 2025,
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          preview,
        });
      },
    );

    it(
      "imports only through authenticated owner authority",
      async () => {
        const result = {
          valid: true,
          importedCount: 1,
        };

        mocks.importSpreadsheet
          .mockResolvedValue(
            result,
          );

        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "import-spreadsheet",
                csv: "ledger",
                ownerId:
                  "spoofed-owner",
              },
            }),
          );

        expect(
          mocks.importSpreadsheet,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            csv: "ledger",
            ownerId:
              "authenticated-owner",
          }),
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          result,
        });
      },
    );

    it(
      "creates a verified policy only for an owned property",
      async () => {
        const policy = {
          id:
            "property_operating_obligation_south29",
          propertyId:
            "1214-wagner",
        };

        mocks.createVerifiedPolicy
          .mockResolvedValue(
            policy,
          );

        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "create-verified-policy",
                propertyId:
                  "1214-wagner",
                subjectLabel:
                  "1214 WAGNER annual insurance",
                obligationType:
                  "fire_insurance",
                annualAmountCents:
                  78668,
                servicePeriodStart:
                  "2025-12-16",
                servicePeriodEnd:
                  "2026-12-16",
                providerName:
                  "Scottsdale Insurance Company",
                providerReference:
                  "DFS5003139",
                notes:
                  "Windstorm excluded.",
                ownerId:
                  "spoofed-owner",
              },
            }),
          );

        expect(
          mocks.createVerifiedPolicy,
        ).toHaveBeenCalledWith({
          propertyId:
            "1214-wagner",
          subjectLabel:
            "1214 WAGNER annual insurance",
          obligationType:
            "fire_insurance",
          annualAmountCents:
            78668,
          servicePeriodStart:
            "2025-12-16",
          servicePeriodEnd:
            "2026-12-16",
          providerName:
            "Scottsdale Insurance Company",
          providerReference:
            "DFS5003139",
          evidenceId: null,
          notes:
            "Windstorm excluded.",
          ownerId:
            "authenticated-owner",
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          policy,
        });
      },
    );

    it(
      "rejects a verified policy for an unowned property",
      async () => {
        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "create-verified-policy",
                propertyId:
                  "unowned-property",
                subjectLabel:
                  "Unowned policy",
                obligationType:
                  "fire_insurance",
                annualAmountCents:
                  78668,
                servicePeriodStart:
                  "2025-12-16",
                servicePeriodEnd:
                  "2026-12-16",
              },
            }),
          );

        expect(response.status).toBe(
          404,
        );
        expect(
          mocks.createVerifiedPolicy,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "verifies coverage through authenticated owner authority",
      async () => {
        const obligation = {
          id:
            "obligation_1",
          servicePeriodStart:
            "2026-03-19",
          servicePeriodEnd:
            "2027-03-19",
          recognitionStatus:
            "accrual_ready",
        };

        mocks.verifyCoverage
          .mockResolvedValue(
            obligation,
          );

        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "verify-coverage",
                obligationId:
                  "obligation_1",
                servicePeriodStart:
                  "2026-03-19",
                servicePeriodEnd:
                  "2027-03-19",
                annualAmountCents:
                  41945,
                obligationType:
                  "fire_insurance",
                providerName:
                  "Farm Bureau",
                providerReference:
                  "policy-reference",
                notes:
                  "Document verified.",
                ownerId:
                  "spoofed-owner",
              },
            }),
          );

        expect(
          mocks.verifyCoverage,
        ).toHaveBeenCalledWith({
          obligationId:
            "obligation_1",
          servicePeriodStart:
            "2026-03-19",
          servicePeriodEnd:
            "2027-03-19",
          annualAmountCents:
            41945,
          obligationType:
            "fire_insurance",
          providerName:
            "Farm Bureau",
          providerReference:
            "policy-reference",
          notes:
            "Document verified.",
          ownerId:
            "authenticated-owner",
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          obligation,
        });
      },
    );

    it(
      "requires complete coverage dates before verification",
      async () => {
        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "verify-coverage",
                obligationId:
                  "obligation_1",
                servicePeriodStart:
                  "2026-03-19",
              },
            }),
          );

        expect(response.status).toBe(
          400,
        );
        expect(
          mocks.verifyCoverage,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "reconciles only to an owned financial event",
      async () => {
        const obligation = {
          id:
            "obligation_1",
          reconciledFinancialEventId:
            "financial_event_1",
        };

        mocks.reconcilePayment
          .mockResolvedValue(
            obligation,
          );

        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "reconcile-payment",
                obligationId:
                  "obligation_1",
                financialEventId:
                  "financial_event_1",
                ownerId:
                  "spoofed-owner",
              },
            }),
          );

        expect(
          mocks.reconcilePayment,
        ).toHaveBeenCalledWith({
          obligationId:
            "obligation_1",
          financialEventId:
            "financial_event_1",
          ownerId:
            "authenticated-owner",
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          obligation,
        });
      },
    );

    it(
      "rejects reconciliation to an unowned event",
      async () => {
        const response =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "reconcile-payment",
                obligationId:
                  "obligation_1",
                financialEventId:
                  "other_event",
              },
            }),
          );

        expect(response.status).toBe(
          404,
        );
        expect(
          mocks.reconcilePayment,
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
                "Authenticated owner id is required.",
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
          await GET(request());

        expect(response).toBe(
          authenticationResponse,
        );
        expect(
          mocks.list,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects unsupported operations and missing CSV",
      async () => {
        const unsupported =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "delete-everything",
              },
            }),
          );

        expect(
          unsupported.status,
        ).toBe(400);

        const missingCsv =
          await POST(
            request({
              method: "POST",
              body: {
                operation:
                  "preview-spreadsheet",
              },
            }),
          );

        expect(
          missingCsv.status,
        ).toBe(400);
        expect(
          mocks.loadImportContext,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns controlled application failures",
      async () => {
        mocks.list.mockRejectedValue(
          new Error(
            "Private query failed.",
          ),
        );

        const response =
          await GET(request());

        expect(response.status).toBe(
          500,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Private query failed.",
        });
      },
    );
  },
);
