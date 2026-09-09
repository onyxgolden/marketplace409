import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CONNECTION_HEALTH_STATES,
  type ConnectionHealth,
} from "../connection-health.types";

describe("ConnectionHealth", () => {
  it("supports executive-readable connection health states", () => {
    expect(CONNECTION_HEALTH_STATES).toEqual([
      "healthy",
      "syncing",
      "stale",
      "needs_attention",
      "critical",
      "not_ready",
      "retired",
    ]);
  });

  it("represents a deliberately retired/historical connection as needing no action, distinct from needs_attention/critical", () => {
    const health: ConnectionHealth = {
      connectionId: "connection_004",
      state: "retired",
      severity: "neutral",
      label: "Disconnected (historical)",
      allowsImport: false,
      requiresUserAction: false,
      issueCount: 0,
      warningCount: 0,
      checkedAt: "2026-06-30T23:55:00.000Z",
    };

    expect(health.state).toBe("retired");
    expect(health.requiresUserAction).toBe(false);
    expect(health.allowsImport).toBe(false);
    expect(health.issueCount).toBe(0);
  });

  it("represents current connection health without provider adapter details", () => {
    const health: ConnectionHealth = {
      connectionId: "connection_001",
      state: "healthy",
      severity: "healthy",
      label: "Healthy",
      allowsImport: true,
      requiresUserAction: false,
      lastSuccessfulImportAt: "2026-06-30T23:30:00.000Z",
      issueCount: 0,
      warningCount: 0,
      checkedAt: "2026-06-30T23:35:00.000Z",
    };

    expect(health.connectionId).toBe("connection_001");
    expect(health.allowsImport).toBe(true);
    expect(health.requiresUserAction).toBe(false);
  });

  it("can represent failed import health", () => {
    const health: ConnectionHealth = {
      connectionId: "connection_002",
      state: "critical",
      severity: "critical",
      label: "Critical",
      allowsImport: false,
      requiresUserAction: true,
      lastFailedImportAt: "2026-06-30T23:40:00.000Z",
      issueCount: 1,
      warningCount: 0,
      checkedAt: "2026-06-30T23:45:00.000Z",
    };

    expect(health.state).toBe("critical");
    expect(health.issueCount).toBe(1);
    expect(health.lastFailedImportAt).toBe("2026-06-30T23:40:00.000Z");
  });

  it("keeps secrets, raw transactions, and provider implementation details out of health modeling", () => {
    const health: ConnectionHealth = {
      connectionId: "connection_003",
      state: "needs_attention",
      severity: "warning",
      label: "Needs Attention",
      allowsImport: false,
      requiresUserAction: true,
      issueCount: 1,
      warningCount: 2,
      checkedAt: "2026-06-30T23:50:00.000Z",
    };

    expect(Object.keys(health)).not.toContain("secret");
    expect(Object.keys(health)).not.toContain("accessToken");
    expect(Object.keys(health)).not.toContain("apiKey");
    expect(Object.keys(health)).not.toContain("transactions");
    expect(Object.keys(health)).not.toContain("provider");
    expect(Object.keys(health)).not.toContain("adapter");
  });
});
