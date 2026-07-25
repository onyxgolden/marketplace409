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
  buildConnectionOperations:
    vi.fn(),
  executeOperation:
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

import {
  GET,
  POST,
} from "./route";

function configureAuthenticatedRequest({
  ownerId = "owner-1",
} = {}) {
  const getConnectionPlatformSuite =
    vi.fn().mockResolvedValue({
      connectionOperationsApplication: {
        buildConnectionOperations:
          mocks.buildConnectionOperations,
        executeOperation:
          mocks.executeOperation,
      },
    });

  mocks
    .createAuthenticatedConnectionApplication
    .mockResolvedValue({
      user: {
        id: ownerId,
      },
      currentOwnerId:
        vi.fn(async () => ownerId),
      getConnectionPlatformSuite,
    });

  return {
    getConnectionPlatformSuite,
  };
}

describe(
  "GET /api/connection/operations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks
        .buildConnectionOperations
        .mockResolvedValue({
          type:
            "connection-operations",
          status: "ready",
        });
    });

    it(
      "returns authenticated connection operations",
      async () => {
        const {
          getConnectionPlatformSuite,
        } = configureAuthenticatedRequest();

        const response = await GET();

        expect(response.status).toBe(200);

        expect(
          getConnectionPlatformSuite,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.buildConnectionOperations,
        ).toHaveBeenCalledOnce();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            type:
              "connection-operations",
            status: "ready",
          },
        });
      },
    );

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

        const response = await GET();

        expect(response.status).toBe(401);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Authenticated owner id is required.",
        });

        expect(
          mocks.buildConnectionOperations,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 500 when connection operations execution fails",
      async () => {
        configureAuthenticatedRequest();

        mocks
          .buildConnectionOperations
          .mockRejectedValue(
            new Error(
              "Connection operations unavailable.",
            ),
          );

        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await GET();

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Connection operations unavailable.",
        });

        expect(
          consoleError,
        ).toHaveBeenCalledWith(
          "Connection operations error",
          expect.any(Error),
        );

        consoleError.mockRestore();
      },
    );
  },
);

describe(
  "POST /api/connection/operations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.executeOperation.mockResolvedValue({
        type:
          "connection-operation-execution",
        status: "not_implemented",
        operation: "repair-connection",
        connectionId: "connection-1",
        ownerId: "owner-1",
        options: {},
        intelligence: {
          status: "successful",
          health: {
            state: "healthy",
            score: 100,
          },
        },
      });
    });

    function createPostRequest(
      body: Record<string, unknown>,
    ) {
      return new Request(
        "http://localhost/api/connection/operations",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    }

    it(
      "executes an authenticated connection operation",
      async () => {
        const {
          getConnectionPlatformSuite,
        } = configureAuthenticatedRequest();

        const request = createPostRequest({
          operation: "repair-connection",
          connectionId: "connection-1",
          options: {
            force: true,
          },
        });

        const response = await POST(request);

        expect(response.status).toBe(200);

        expect(
          getConnectionPlatformSuite,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.executeOperation,
        ).toHaveBeenCalledWith({
          operation: "repair-connection",
          connectionId: "connection-1",
          ownerId: "owner-1",
          options: {
            force: true,
          },
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            type:
              "connection-operation-execution",
            status: "not_implemented",
            operation:
              "repair-connection",
            connectionId:
              "connection-1",
            ownerId: "owner-1",
            options: {},
            intelligence: {
              status: "successful",
              health: {
                state: "healthy",
                score: 100,
              },
            },
          },
        });
      },
    );

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
          createPostRequest({
            operation:
              "repair-connection",
            connectionId:
              "connection-1",
          }),
        );

        expect(response.status).toBe(401);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Authenticated owner id is required.",
        });

        expect(
          mocks.executeOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns an error for an unsupported operation",
      async () => {
        configureAuthenticatedRequest();

        mocks.executeOperation.mockRejectedValue(
          new Error(
            "Unsupported connection operation: unsupported-operation",
          ),
        );

        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await POST(
          createPostRequest({
            operation:
              "unsupported-operation",
            connectionId:
              "connection-1",
          }),
        );

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Unsupported connection operation: unsupported-operation",
        });

        consoleError.mockRestore();
      },
    );

    it(
      "returns an error when operation is missing",
      async () => {
        configureAuthenticatedRequest();

        mocks.executeOperation.mockRejectedValue(
          new Error(
            "Connection operation is required.",
          ),
        );

        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await POST(
          createPostRequest({
            connectionId:
              "connection-1",
          }),
        );

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Connection operation is required.",
        });

        consoleError.mockRestore();
      },
    );

    it(
      "returns an error when connection id is missing",
      async () => {
        configureAuthenticatedRequest();

        mocks.executeOperation.mockRejectedValue(
          new Error(
            "Connection id is required.",
          ),
        );

        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const response = await POST(
          createPostRequest({
            operation:
              "repair-connection",
          }),
        );

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Connection id is required.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
