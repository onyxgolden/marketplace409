import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedForgeApplication:
    vi.fn(),
  getForgeApplicationSuite:
    vi.fn(),
  assignTransactionsToProperty:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

import {
  POST,
} from "./route";

const transaction = Object.freeze({
  id:
    "transaction-1",
  financialAccountId:
    "account-1",
  connectionId:
    "connection-1",
  provider:
    "plaid",
  providerTransactionId:
    "provider-transaction-1",
  providerAccountId:
    "provider-account-1",
  amountCents:
    12500,
  currencyCode:
    "USD",
  date:
    "2026-08-04",
  description:
    "LOWES",
  merchantName:
    "LOWES",
  category: [
    "Home Improvement",
  ],
  pending:
    false,
  createdAt:
    "2026-08-04T00:00:00.000Z",
});

const property = Object.freeze({
  id:
    "property-1",
  name:
    "Rental 1",
});

function configureAuthenticatedRequest() {
  mocks.getForgeApplicationSuite
    .mockResolvedValue({
      transactionReviewApplicationSuite: {
        bulkAssignmentService: {
          assignTransactionsToProperty:
            mocks.assignTransactionsToProperty,
        },
      },
    });

  mocks.createAuthenticatedForgeApplication
    .mockResolvedValue({
      supabaseClient: {
        from:
          vi.fn(),
      },
      user: {
        id:
          "authenticated-owner",
      },
      getForgeApplicationSuite:
        mocks.getForgeApplicationSuite,
    });
}

describe(
  "POST /api/transactions/assign-properties",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.assignTransactionsToProperty
        .mockResolvedValue({
          assignments: [
            {
              transaction,
              property,
              rule: {
                id:
                  "rule-1",
              },
              reviewItem:
                null,
            },
          ],
          assignedCount:
            1,
          failedCount:
            0,
        });
    });

    it(
      "bulk assigns using authenticated owner authority",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    ownerId:
                      "spoofed-request-owner",

                    organizationId:
                      "spoofed-request-organization",

                    assignments: [
                      {
                        transaction,
                        property,

                        ownerId:
                          "spoofed-item-owner",

                        organizationId:
                          "spoofed-item-organization",
                      },
                    ],
                  }),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          mocks.getForgeApplicationSuite,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.assignTransactionsToProperty,
        ).toHaveBeenCalledTimes(1);

        const serviceInput =
          mocks.assignTransactionsToProperty
            .mock.calls[0][0];

        expect(serviceInput).toEqual({
          assignments: [
            {
              transaction,
              property,
              ownerId:
                "authenticated-owner",
              organizationId:
                null,
              reviewItem:
                undefined,
            },
          ],
          ownerId:
            "authenticated-owner",
          organizationId:
            null,
        });

        expect(
          serviceInput.ownerId,
        ).not.toBe(
          "spoofed-request-owner",
        );

        expect(
          serviceInput.assignments[0].ownerId,
        ).not.toBe(
          "spoofed-item-owner",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          assignments: [
            {
              transaction,
              property,
              rule: {
                id:
                  "rule-1",
              },
              reviewItem:
                null,
            },
          ],
          assignedCount:
            1,
          failedCount:
            0,
        });
      },
    );

    it(
      "returns the authentication response without composing services",
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

        mocks.createAuthenticatedForgeApplication
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    assignments: [
                      {
                        transaction,
                        property,
                      },
                    ],
                  }),
              },
            ),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();

        expect(
          mocks.assignTransactionsToProperty,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects missing assignments",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({}),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "assignments is required.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an empty assignment collection",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    assignments: [],
                  }),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "assignments must contain at least one assignment.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an assignment without a transaction",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    assignments: [
                      {
                        property,
                      },
                    ],
                  }),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "assignment transaction is required.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an assignment without a property",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    assignments: [
                      {
                        transaction,
                      },
                    ],
                  }),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "assignment property is required.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a controlled 500 response when bulk assignment fails",
      async () => {
        configureAuthenticatedRequest();

        mocks.assignTransactionsToProperty
          .mockRejectedValue(
            new Error(
              "Bulk assignment failed.",
            ),
          );

        const consoleError =
          vi.spyOn(
            console,
            "error",
          ).mockImplementation(
            () => {},
          );

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-properties",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    assignments: [
                      {
                        transaction,
                        property,
                      },
                    ],
                  }),
              },
            ),
          );

        expect(
          response.status,
        ).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Bulk assignment failed.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
