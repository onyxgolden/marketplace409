import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionReadModelApplication,
} from "./ConnectionReadModelApplication.js";

function buildCollection() {
  return Object.freeze({
    connections: Object.freeze([]),
    totalConnections: 0,
    healthyConnections: 0,
    syncingConnections: 0,
    staleConnections: 0,
    needsAttentionConnections: 0,
    criticalConnections: 0,
    notReadyConnections: 0,
    lastUpdatedAt: null,
  });
}

function buildApplication(
  overrides = {},
) {
  const collection =
    buildCollection();

  const connectionSummaryQueryService =
    overrides.connectionSummaryQueryService || {
      getConnectionCollection:
        vi.fn(async () => collection),
    };

  const readModelAdapter =
    overrides.readModelAdapter || {
      buildDashboard: vi.fn(() => ({
        dashboard: true,
      })),
      buildReports: vi.fn(() => ({
        reports: true,
      })),
    };

  const currentOwnerId =
    overrides.currentOwnerId ||
    vi.fn(async () => "owner-1");

  return {
    application:
      new ConnectionReadModelApplication({
        connectionSummaryQueryService,
        readModelAdapter,
        currentOwnerId,
      }),
    connectionSummaryQueryService,
    readModelAdapter,
    currentOwnerId,
    collection,
  };
}

describe(
  "ConnectionReadModelApplication",
  () => {
    it(
      "requires a connection summary query service",
      () => {
        expect(
          () =>
            new ConnectionReadModelApplication(
              {
                readModelAdapter: {
                  buildDashboard:
                    vi.fn(),
                  buildReports:
                    vi.fn(),
                },
                currentOwnerId:
                  vi.fn(),
              },
            ),
        ).toThrow(
          "ConnectionReadModelApplication requires a connection summary query service.",
        );
      },
    );

    it(
      "requires a connection read model adapter",
      () => {
        expect(
          () =>
            new ConnectionReadModelApplication(
              {
                connectionSummaryQueryService:
                  {
                    getConnectionCollection:
                      vi.fn(),
                  },
                currentOwnerId:
                  vi.fn(),
              },
            ),
        ).toThrow(
          "ConnectionReadModelApplication requires a connection read model adapter.",
        );
      },
    );

    it(
      "requires a current owner id resolver",
      () => {
        expect(
          () =>
            new ConnectionReadModelApplication(
              {
                connectionSummaryQueryService:
                  {
                    getConnectionCollection:
                      vi.fn(),
                  },
                readModelAdapter: {
                  buildDashboard:
                    vi.fn(),
                  buildReports:
                    vi.fn(),
                },
                currentOwnerId:
                  null,
              },
            ),
        ).toThrow(
          "ConnectionReadModelApplication requires a current owner id resolver.",
        );
      },
    );

    it(
      "builds a connection dashboard",
      async () => {
        const {
          application,
          currentOwnerId,
          connectionSummaryQueryService,
          readModelAdapter,
          collection,
        } = buildApplication();

        const result =
          await application.buildConnectionDashboard();

        expect(
          currentOwnerId,
        ).toHaveBeenCalledOnce();

        expect(
          connectionSummaryQueryService.getConnectionCollection,
        ).toHaveBeenCalledWith(
          "owner-1",
        );

        expect(
          readModelAdapter.buildDashboard,
        ).toHaveBeenCalledWith(
          collection,
        );

        expect(result).toEqual({
          type:
            "connection-dashboard",
          dashboard: {
            dashboard: true,
          },
        });
      },
    );

    it(
      "rejects an unauthenticated owner",
      async () => {
        const {
          application,
          connectionSummaryQueryService,
        } = buildApplication({
          currentOwnerId:
            vi.fn(async () => null),
        });

        await expect(
          application.buildConnectionDashboard(),
        ).rejects.toThrow(
          "Authenticated owner id is required.",
        );

        expect(
          connectionSummaryQueryService.getConnectionCollection,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "builds connection reports",
      async () => {
        const {
          application,
          readModelAdapter,
          collection,
        } = buildApplication();

        const result =
          await application.buildConnectionReports();

        expect(
          readModelAdapter.buildReports,
        ).toHaveBeenCalledWith(
          collection,
        );

        expect(result).toEqual({
          type:
            "connection-reports",
          reports: {
            reports: true,
          },
          dashboard: {
            dashboard: true,
          },
        });
      },
    );
  },
);
