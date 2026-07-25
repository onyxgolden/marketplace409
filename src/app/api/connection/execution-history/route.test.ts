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
  getExecutionHistoryIntelligence:
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

function configureAuthenticatedRequest() {
  const getConnectionPlatformSuite =
    vi.fn().mockResolvedValue({
      connectionOperationsApplication: {
        getExecutionHistoryIntelligence:
          mocks.getExecutionHistoryIntelligence,
      },
    });

  mocks
    .createAuthenticatedConnectionApplication
    .mockResolvedValue({
      user: {
        id: "owner-1",
      },
      getConnectionPlatformSuite,
    });

  return {
    getConnectionPlatformSuite,
  };
}

describe(
  "GET /api/connection/execution-history",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks
        .getExecutionHistoryIntelligence
        .mockResolvedValue({
          totalExecutions: 3,
          successfulExecutions: 2,
        });
    });

    it(
      "returns authenticated execution history intelligence",
      async () => {
        const {
          getConnectionPlatformSuite,
        } =
          configureAuthenticatedRequest();

        const response =
          await GET(
            new Request(
              "http://localhost/api/connection/execution-history?connectionId=connection-1",
            ),
          );

        expect(response.status)
          .toBe(200);

        expect(
          getConnectionPlatformSuite,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.getExecutionHistoryIntelligence,
        ).toHaveBeenCalledWith({
          ownerId:
            "owner-1",
          connectionId:
            "connection-1",
        });

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            totalExecutions: 3,
            successfulExecutions: 2,
          },
        });
      },
    );

    it(
      "requires connection id",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await GET(
            new Request(
              "http://localhost/api/connection/execution-history",
            ),
          );

        expect(response.status)
          .toBe(400);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Connection id is required",
        });
      },
    );

    it(
      "returns authentication response when unavailable",
      async () => {
        mocks
          .createAuthenticatedConnectionApplication
          .mockResolvedValue({
            response:
              new Response(
                JSON.stringify({
                  error:
                    "Authenticated owner id is required.",
                }),
                {
                  status: 401,
                },
              ),
          });

        const response =
          await GET(
            new Request(
              "http://localhost/api/connection/execution-history?connectionId=connection-1",
            ),
          );

        expect(response.status)
          .toBe(401);
      },
    );
  },
);
