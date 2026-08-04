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
  assignTransactionToProperty:
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
        manualAssignmentService: {
          assignTransactionToProperty:
            mocks.assignTransactionToProperty,
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
  "POST /api/transactions/assign-property",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.assignTransactionToProperty
        .mockResolvedValue({
          transaction,
          property,
          rule: {
            id:
              "rule-1",
          },
          reviewItem:
            null,
        });
    });

    it(
      "assigns using authenticated owner authority",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-property",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    transaction,
                    property,

                    ownerId:
                      "spoofed-owner",

                    organizationId:
                      "spoofed-organization",
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
          mocks.assignTransactionToProperty,
        ).toHaveBeenCalledWith({
          transaction,
          property,
          ownerId:
            "authenticated-owner",
          organizationId:
            null,
          reviewItem:
            undefined,
        });

        const serviceInput =
          mocks.assignTransactionToProperty
            .mock.calls[0][0];

        expect(
          serviceInput.ownerId,
        ).not.toBe(
          "spoofed-owner",
        );

        expect(
          serviceInput.organizationId,
        ).not.toBe(
          "spoofed-organization",
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          transaction,
          property,
          rule: {
            id:
              "rule-1",
          },
          reviewItem:
            null,
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
              "http://localhost/api/transactions/assign-property",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    transaction,
                    property,
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
          mocks.assignTransactionToProperty,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects missing transaction input",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-property",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    property,
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
            "transaction is required.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects missing property input",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await POST(
            new Request(
              "http://localhost/api/transactions/assign-property",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    transaction,
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
            "property is required.",
        });

        expect(
          mocks.getForgeApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a controlled 500 response when assignment fails",
      async () => {
        configureAuthenticatedRequest();

        mocks.assignTransactionToProperty
          .mockRejectedValue(
            new Error(
              "Assignment failed.",
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
              "http://localhost/api/transactions/assign-property",
              {
                method:
                  "POST",
                body:
                  JSON.stringify({
                    transaction,
                    property,
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
            "Assignment failed.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
