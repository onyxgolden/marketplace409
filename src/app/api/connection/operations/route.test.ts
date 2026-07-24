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
} from "./route";

function configureAuthenticatedRequest({
  ownerId = "owner-1",
} = {}) {
  const getConnectionPlatformSuite =
    vi.fn().mockResolvedValue({
      connectionOperationsApplication: {
        buildConnectionOperations:
          mocks.buildConnectionOperations,
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
