import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ConnectionReadModelAdapter,
} from "./ConnectionReadModelAdapter.js";

function createCollection() {
  return Object.freeze({
    connections: Object.freeze([
      Object.freeze({
        connection: {
          id: "connection-1",
        },
      }),
    ]),
    totalConnections: 1,
    healthyConnections: 1,
    syncingConnections: 0,
    staleConnections: 0,
    needsAttentionConnections: 0,
    criticalConnections: 0,
    notReadyConnections: 0,
    lastUpdatedAt: "2026-07-23T01:00:00.000Z",
  });
}

describe("ConnectionReadModelAdapter", () => {
  it("requires a connection collection", () => {
    const adapter =
      new ConnectionReadModelAdapter();

    expect(() =>
      adapter.buildDashboard(),
    ).toThrow(
      "ConnectionReadModelAdapter requires a connection collection.",
    );

    expect(() =>
      adapter.buildReports(),
    ).toThrow(
      "ConnectionReadModelAdapter requires a connection collection.",
    );
  });

  it("builds a dashboard projection", () => {
    const adapter =
      new ConnectionReadModelAdapter();

    const dashboard =
      adapter.buildDashboard(
        createCollection(),
      );

    expect(
      dashboard.summary.totalConnections,
    ).toBe(1);

    expect(
      dashboard.summary.healthyConnections,
    ).toBe(1);

    expect(
      dashboard.connections,
    ).toHaveLength(1);

    expect(
      dashboard.metadata.provider,
    ).toBe("connection-platform");

    expect(Object.isFrozen(dashboard)).toBe(
      true,
    );
  });

  it("builds reports", () => {
    const adapter =
      new ConnectionReadModelAdapter();

    const reports =
      adapter.buildReports(
        createCollection(),
      );

    expect(
      reports.connections,
    ).toHaveLength(1);

    expect(Object.isFrozen(reports)).toBe(
      true,
    );
  });

  it("freezes the adapter", () => {
    const adapter =
      new ConnectionReadModelAdapter();

    expect(Object.isFrozen(adapter)).toBe(
      true,
    );
  });
});
