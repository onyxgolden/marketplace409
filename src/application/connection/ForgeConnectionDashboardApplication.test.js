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

    it("loads the dashboard through the authenticated operations endpoint", async () => {
      const fetcher =
        vi.fn().mockResolvedValue({
          json: async () => ({
            success: true,
            data: {
              type:
                "connection-operations",
              status: "ready",
              summary: {
                totalConnections: 2,
                readyForImportConnections: 1,
              },
              health: {
                overall: "needs_attention",
                score: 70,
                issueCount: 1,
                warningCount: 0,
              },
              recommendations: [
                {
                  type: "repair-connection",
                  priority: "high",
                  connectionId: "connection-1",
                  message:
                    "Repair this connection before attempting another import.",
                },
              ],
              intelligence: {
                readyConnectionIds: [
                  "connection-2",
                ],
                attentionConnectionIds: [
                  "connection-1",
                ],
                degradedConnectionIds: [
                  "connection-1",
                ],
                lastUpdatedAt:
                  "2026-07-23T21:00:00.000Z",
              },
              workflow: {
                queue: [
                  {
                    id:
                      "repair-connection:connection-1",
                    type:
                      "repair-connection",
                    priority: "high",
                    priorityRank: 1,
                    connectionId:
                      "connection-1",
                    stage: "attention",
                    readiness: "ready",
                    message:
                      "Repair this connection before attempting another import.",
                  },
                ],
                stages: [
                  {
                    id: "attention",
                    label: "Attention",
                    status: "ready",
                    operationCount: 1,
                  },
                ],
                cards: [
                  {
                    id:
                      "repair-connection:connection-1",
                    title:
                      "Repair connection",
                    detail:
                      "Repair this connection before attempting another import.",
                    action:
                      "repair-connection",
                    priority: "high",
                    stage: "attention",
                    connectionId:
                      "connection-1",
                    readiness: "ready",
                  },
                ],
                executionReadiness: {
                  status: "ready",
                  totalOperations: 1,
                  readyOperations: 1,
                  blockedOperations: 0,
                  nextOperationId:
                    "repair-connection:connection-1",
                },
                metadata: {
                  generatedAt:
                    "2026-07-23T21:00:00.000Z",
                  readOnly: true,
                  deterministic: true,
                  highestPriority: "high",
                },
              },
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
                    phase: "20G",
                  },
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
        "/api/connection/operations",
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

      expect(result.health).toEqual({
        overall: "needs_attention",
        score: 70,
        issueCount: 1,
        warningCount: 0,
      });

      expect(
        result.recommendations,
      ).toHaveLength(1);

      expect(
        result.intelligence
          .attentionConnectionIds,
      ).toEqual([
        "connection-1",
      ]);

      expect(
        result.workflow
          .executionReadiness,
      ).toEqual({
        status: "ready",
        totalOperations: 1,
        readyOperations: 1,
        blockedOperations: 0,
        nextOperationId:
          "repair-connection:connection-1",
      });

      expect(
        result.workflow.cards[0],
      ).toMatchObject({
        title: "Repair connection",
        priority: "high",
        stage: "attention",
        readiness: "ready",
      });
    });

    it("builds an error model when loading fails", async () => {
      const fetcher =
        vi.fn().mockResolvedValue({
          json: async () => ({
            error:
              "Connection operations unavailable.",
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
        "Connection operations unavailable.",
      );

      expect(
        result.statusItems[0].value,
      ).toBe("error");
    });
  },
);
