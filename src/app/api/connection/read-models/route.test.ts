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
  buildConnectionDashboard:
    vi.fn(),
  buildConnectionReports:
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

function createRequest(query = "") {
  return new Request(
    `http://localhost/api/connection/read-models${query}`,
  );
}

function configureAuthenticatedRequest({
  ownerId = "owner-1",
} = {}) {
  const supabaseClient = {};

  const currentOwnerId =
    vi.fn(async () => ownerId);

  const getConnectionPlatformSuite =
    vi.fn().mockResolvedValue({
      connectionReadModelApplication: {
        buildConnectionDashboard:
          mocks.buildConnectionDashboard,
        buildConnectionReports:
          mocks.buildConnectionReports,
      },
    });

  mocks
    .createAuthenticatedConnectionApplication
    .mockResolvedValue({
      supabaseClient,
      user: {
        id: ownerId,
      },
      currentOwnerId,
      getConnectionPlatformSuite,
    });

  return {
    supabaseClient,
    currentOwnerId,
    getConnectionPlatformSuite,
  };
}

describe(
  "GET /api/connection/read-models",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks
        .buildConnectionDashboard
        .mockResolvedValue(null);

      mocks
        .buildConnectionReports
        .mockResolvedValue(null);
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

        const response =
          await GET(
            createRequest(
              "?dashboard=true",
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
          mocks.buildConnectionDashboard,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns an authenticated connection dashboard",
      async () => {
        const {
          getConnectionPlatformSuite,
        } = configureAuthenticatedRequest();

        const dashboard = {
          type:
            "connection-dashboard",
          dashboard: {
            summary: {
              totalConnections: 2,
            },
          },
        };

        mocks
          .buildConnectionDashboard
          .mockResolvedValue(
            dashboard,
          );

        const response =
          await GET(
            createRequest(
              "?dashboard=true",
            ),
          );

        expect(response.status).toBe(200);

        expect(
          getConnectionPlatformSuite,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.buildConnectionDashboard,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.buildConnectionReports,
        ).not.toHaveBeenCalled();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            dashboard,
            reports: null,
          },
        });
      },
    );

    it(
      "returns authenticated connection reports",
      async () => {
        configureAuthenticatedRequest();

        const reports = {
          type:
            "connection-reports",
          reports: {
            connections: [],
          },
          dashboard: {
            summary: {
              totalConnections: 0,
            },
          },
        };

        mocks
          .buildConnectionReports
          .mockResolvedValue(
            reports,
          );

        const response =
          await GET(
            createRequest(
              "?reports=true",
            ),
          );

        expect(response.status).toBe(200);

        expect(
          mocks.buildConnectionDashboard,
        ).not.toHaveBeenCalled();

        expect(
          mocks.buildConnectionReports,
        ).toHaveBeenCalledOnce();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            dashboard: null,
            reports,
          },
        });
      },
    );

    it(
      "returns both requested connection projections",
      async () => {
        configureAuthenticatedRequest();

        const dashboard = {
          type:
            "connection-dashboard",
        };

        const reports = {
          type:
            "connection-reports",
        };

        mocks
          .buildConnectionDashboard
          .mockResolvedValue(
            dashboard,
          );

        mocks
          .buildConnectionReports
          .mockResolvedValue(
            reports,
          );

        const response =
          await GET(
            createRequest(
              "?dashboard=true&reports=true",
            ),
          );

        expect(response.status).toBe(200);

        expect(
          mocks.buildConnectionDashboard,
        ).toHaveBeenCalledOnce();

        expect(
          mocks.buildConnectionReports,
        ).toHaveBeenCalledOnce();

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            dashboard,
            reports,
          },
        });
      },
    );

    it(
      "returns null projections when none are requested",
      async () => {
        configureAuthenticatedRequest();

        const response =
          await GET(
            createRequest(),
          );

        expect(response.status).toBe(200);

        await expect(
          response.json(),
        ).resolves.toEqual({
          success: true,
          data: {
            dashboard: null,
            reports: null,
          },
        });

        expect(
          mocks.buildConnectionDashboard,
        ).not.toHaveBeenCalled();

        expect(
          mocks.buildConnectionReports,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns a server error when projection fails",
      async () => {
        configureAuthenticatedRequest();

        mocks
          .buildConnectionDashboard
          .mockRejectedValue(
            new Error(
              "Connection projection failed.",
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
          await GET(
            createRequest(
              "?dashboard=true",
            ),
          );

        expect(response.status).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Connection projection failed.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
