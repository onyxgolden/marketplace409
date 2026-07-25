import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedConnectionApplication:
    vi.fn(),
  getConnectionPlatformSuite:
    vi.fn(),
  exchangePublicToken:
    vi.fn(),
  mapPlaidExchangeToConnection:
    vi.fn(),
  provision:
    vi.fn(),
  persist:
    vi.fn(),
}));

vi.mock(
  "next/server",
  () => ({
    NextResponse: {
      json(
        body: unknown,
        init?: ResponseInit,
      ) {
        return new Response(
          JSON.stringify(body),
          {
            ...init,
            headers: {
              "content-type":
                "application/json",
            },
          },
        );
      },
    },
  }),
);

vi.mock(
  "@/lib/supabase/createAuthenticatedConnectionApplication",
  () => ({
    createAuthenticatedConnectionApplication:
      mocks.createAuthenticatedConnectionApplication,
  }),
);

vi.mock(
  "@/domains/plaid-adapter",
  () => ({
    mapPlaidExchangeToConnection:
      mocks.mapPlaidExchangeToConnection,
  }),
);


import {
  POST,
} from "./route";

describe(
  "POST /api/plaid/exchange-token",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns the authentication response when no owner is authenticated",
      async () => {
        const unauthorizedResponse =
          new Response(
            JSON.stringify({
              error:
                "Authenticated owner id is required.",
            }),
            {
              status: 401,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          );

        mocks
          .createAuthenticatedConnectionApplication
          .mockResolvedValue({
            response:
              unauthorizedResponse,
          });

        const response = await POST(
          new Request(
            "http://localhost/api/plaid/exchange-token",
            {
              method: "POST",
              body: JSON.stringify({
                publicToken:
                  "public-token",
              }),
            },
          ),
        );

        expect(response.status).toBe(401);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Authenticated owner id is required.",
        });

        expect(
          mocks.exchangePublicToken,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a missing public token",
      async () => {
        mocks
          .createAuthenticatedConnectionApplication
          .mockResolvedValue({
            currentOwnerId:
              vi.fn()
                .mockResolvedValue(
                  "owner-123",
                ),
          });

        const response = await POST(
          new Request(
            "http://localhost/api/plaid/exchange-token",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          ),
        );

        expect(response.status).toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "publicToken is required.",
        });

        expect(
          mocks.exchangePublicToken,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "provisions and persists a Plaid connection for the authenticated owner",
      async () => {
        const currentOwnerId =
          vi.fn()
            .mockResolvedValue(
              "owner-123",
            );

        const exchange = {
          itemId:
            "item-123",
          accessToken:
            "access-token-123",
        };

        const mappedConnection = {
          connection: {
            id:
              "connection-123",
            ownerId:
              "owner-123",
          },
          credentialReference: {
            id:
              "credential-123",
          },
          institutionReference: {
            id:
              "institution-123",
            connectionId:
              "connection-123",
          },
        };

        const provisioningResult = {
          ...mappedConnection,
          provisionedAt:
            "2026-07-22T04:00:00.000Z",
          readyForPersistence:
            true,
        };

        const persistenceResult = {
          ...mappedConnection,
          provisionedAt:
            "2026-07-22T04:00:00.000Z",
          persistedAt:
            "2026-07-22T04:01:00.000Z",
          readyForImport:
            true,
        };

        const connectionPlatformSuite = {
          plaidProvider: {
            exchangePublicToken:
              mocks.exchangePublicToken,
          },
          provisioningService: {
            provision:
              mocks.provision,
          },
          persistenceService: {
            persist:
              mocks.persist,
          },
        };

        mocks
          .getConnectionPlatformSuite
          .mockResolvedValue(
            connectionPlatformSuite,
          );

        mocks
          .createAuthenticatedConnectionApplication
          .mockResolvedValue({
            currentOwnerId,
            getConnectionPlatformSuite:
              mocks.getConnectionPlatformSuite,
          });


        mocks
          .exchangePublicToken
          .mockResolvedValue(exchange);

        mocks
          .mapPlaidExchangeToConnection
          .mockReturnValue(
            mappedConnection,
          );

        mocks
          .provision
          .mockReturnValue(
            provisioningResult,
          );

        mocks
          .persist
          .mockReturnValue(
            persistenceResult,
          );

        const response = await POST(
          new Request(
            "http://localhost/api/plaid/exchange-token",
            {
              method: "POST",
              body: JSON.stringify({
                publicToken:
                  "public-token-123",
                userId:
                  "caller-controlled-user",
              }),
            },
          ),
        );

        expect(response.status).toBe(200);

        expect(
          mocks.getConnectionPlatformSuite,
        ).toHaveBeenCalledOnce();

        expect(
          currentOwnerId,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.exchangePublicToken,
        ).toHaveBeenCalledWith({
          publicToken:
            "public-token-123",
        });

        expect(
          mocks.mapPlaidExchangeToConnection,
        ).toHaveBeenCalledWith({
          userId:
            "owner-123",
          exchange,
        });

        expect(
          mocks.mapPlaidExchangeToConnection,
        ).not.toHaveBeenCalledWith(
          expect.objectContaining({
            userId:
              "caller-controlled-user",
          }),
        );

        expect(
          mocks.provision,
        ).toHaveBeenCalledWith(
          mappedConnection,
        );

        expect(
          mocks.persist,
        ).toHaveBeenCalledWith(
          provisioningResult,
          {
            ownerId:
              "owner-123",
          },
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          itemId:
            "item-123",
          connection:
            persistenceResult.connection,
          credentialReference:
            persistenceResult
              .credentialReference,
          institutionReference:
            persistenceResult
              .institutionReference,
          provisionedAt:
            "2026-07-22T04:00:00.000Z",
          persistedAt:
            "2026-07-22T04:01:00.000Z",
          readyForImport:
            true,
        });
      },
    );

    it(
      "returns a server error when provisioning fails",
      async () => {
        const connectionPlatformSuite = {
          plaidProvider: {
            exchangePublicToken:
              mocks.exchangePublicToken,
          },
          provisioningService: {
            provision:
              mocks.provision,
          },
          persistenceService: {
            persist:
              mocks.persist,
          },
        };

        mocks
          .getConnectionPlatformSuite
          .mockResolvedValue(
            connectionPlatformSuite,
          );

        mocks
          .createAuthenticatedConnectionApplication
          .mockResolvedValue({
            currentOwnerId:
              vi.fn()
                .mockResolvedValue(
                  "owner-123",
                ),
            getConnectionPlatformSuite:
              mocks.getConnectionPlatformSuite,
          });

        mocks
          .exchangePublicToken
          .mockResolvedValue({
            itemId:
              "item-123",
          });

        mocks
          .mapPlaidExchangeToConnection
          .mockReturnValue({
            connection: {},
            credentialReference: {},
            institutionReference: {},
          });

        mocks
          .provision
          .mockImplementation(() => {
            throw new Error(
              "Provisioning failed.",
            );
          });

        const consoleError =
          vi.spyOn(
            console,
            "error",
          )
            .mockImplementation(
              () => {},
            );

        const response = await POST(
          new Request(
            "http://localhost/api/plaid/exchange-token",
            {
              method: "POST",
              body: JSON.stringify({
                publicToken:
                  "public-token-123",
              }),
            },
          ),
        );

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Provisioning failed.",
          details:
            null,
        });

        consoleError.mockRestore();
      },
    );
  },
);
