import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ForgeConnectionDashboardApplication,
} from "./ForgeConnectionDashboardApplication.js";

describe(
  "ForgeConnectionDashboardApplication",
  () => {
    it("builds a loading model", () => {
      const result =
        ForgeConnectionDashboardApplication
          .buildLoadingModel();

      expect(result.loadState).toBe(
        "loading",
      );

      expect(result.error).toBeNull();
      expect(result.summary).toEqual({});
      expect(result.connections).toEqual(
        [],
      );

      expect(
        result.statusItems[0],
      ).toEqual({
        label:
          "Connection Platform",
        detail:
          "Repository-backed connection read models are active.",
        value: "loading",
      });
    });

    it("builds a ready model", () => {
      const result =
        ForgeConnectionDashboardApplication
          .buildReadyModel({
            dashboard: {
              summary: {
                totalConnections: 3,
                healthyConnections: 2,
                needsAttentionConnections: 1,
              },
              connections: [
                {
                  connectionId:
                    "connection-1",
                  provider: "plaid",
                },
              ],
              metadata: {
                provider:
                  "connection-platform",
                snapshotStatus:
                  "repository-backed",
                phase: "20C",
              },
            },
            reports: {
              connections: [
                {
                  connectionId:
                    "connection-1",
                },
              ],
            },
          });

      expect(result.loadState).toBe(
        "ready",
      );

      expect(
        result.summary.totalConnections,
      ).toBe(3);

      expect(
        result.connections,
      ).toHaveLength(1);

      expect(result.metadata).toEqual({
        provider:
          "connection-platform",
        snapshotStatus:
          "repository-backed",
        phase: "20C",
      });

      expect(
        result.statusItems,
      ).toEqual([
        {
          label:
            "Connection Platform",
          detail:
            "Repository-backed connection read models are active.",
          value: "online",
        },
        {
          label: "Data Provider",
          detail:
            "Connection data is supplied through the platform provider boundary.",
          value:
            "connection-platform",
        },
        {
          label:
            "Snapshot Status",
          detail:
            "Connection state is projected from persistent repository data.",
          value:
            "repository-backed",
        },
      ]);

      expect(
        result.activities[1],
      ).toMatchObject({
        id:
          "connection-read-model-active",
        timestamp:
          "Phase 20C",
      });
    });

    it("loads dashboard and reports through an injected fetcher", async () => {
      const fetcher =
        vi.fn().mockResolvedValue({
          json: async () => ({
            success: true,
            data: {
              dashboard: {
                type:
                  "connection-dashboard",
                dashboard: {
                  summary: {
                    totalConnections: 2,
                    healthyConnections: 1,
                  },
                  connections: [
                    {
                      connectionId:
                        "connection-1",
                    },
                    {
                      connectionId:
                        "connection-2",
                    },
                  ],
                  metadata: {
                    provider:
                      "connection-platform",
                    snapshotStatus:
                      "repository-backed",
                    phase: "20C",
                  },
                },
              },
              reports: {
                type:
                  "connection-reports",
                reports: {
                  connections: [
                    {
                      connectionId:
                        "connection-1",
                    },
                    {
                      connectionId:
                        "connection-2",
                    },
                  ],
                },
              },
            },
          }),
        });

      const result =
        await ForgeConnectionDashboardApplication
          .load({
            fetcher,
          });

      expect(fetcher).toHaveBeenCalledWith(
        "/api/connection/read-models?dashboard=true&reports=true",
      );

      expect(result.loadState).toBe(
        "ready",
      );

      expect(
        result.summary.totalConnections,
      ).toBe(2);

      expect(
        result.connections,
      ).toHaveLength(2);
    });

    it("builds an error model when loading fails", async () => {
      const fetcher =
        vi.fn().mockResolvedValue({
          json: async () => ({
            error:
              "Connection read model unavailable.",
          }),
        });

      const result =
        await ForgeConnectionDashboardApplication
          .load({
            fetcher,
          });

      expect(result.loadState).toBe(
        "error",
      );

      expect(result.error).toBe(
        "Connection read model unavailable.",
      );

      expect(
        result.statusItems[0].value,
      ).toBe("error");
    });
  },
);
