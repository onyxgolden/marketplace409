import {
  IMPORT_HISTORY_STATUSES,
  IMPORT_HISTORY_TYPES,
  type ImportHistory,
} from "../import-history.types";

describe("ImportHistory", () => {
  it("supports provider-agnostic import types", () => {
    expect(IMPORT_HISTORY_TYPES).toEqual([
      "manual",
      "scheduled",
      "webhook",
      "csv_upload",
      "initial_sync",
      "refresh",
    ]);
  });

  it("supports import lifecycle statuses", () => {
    expect(IMPORT_HISTORY_STATUSES).toEqual([
      "pending",
      "running",
      "completed",
      "completed_with_warnings",
      "failed",
      "cancelled",
    ]);
  });

  it("represents a completed import event", () => {
    const importHistory: ImportHistory = {
      id: "import_001",
      connectionId: "connection_001",
      type: "initial_sync",
      status: "completed",
      provider: "plaid",
      recordsProcessed: 523,
      recordsImported: 520,
      recordsSkipped: 3,
      recordsFailed: 0,
      startedAt: "2026-06-30T22:00:00.000Z",
      completedAt: "2026-06-30T22:00:12.000Z",
      durationMs: 12000,
      createdAt: "2026-06-30T22:00:00.000Z",
      updatedAt: "2026-06-30T22:00:12.000Z",
    };

    expect(importHistory.connectionId).toBe("connection_001");
    expect(importHistory.status).toBe("completed");
    expect(importHistory.recordsImported).toBe(520);
  });

  it("represents failed imports without storing provider-specific secrets", () => {
    const importHistory: ImportHistory = {
      id: "import_002",
      connectionId: "connection_002",
      type: "refresh",
      status: "failed",
      provider: "stripe",
      recordsProcessed: 0,
      recordsImported: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      startedAt: "2026-06-30T22:10:00.000Z",
      completedAt: "2026-06-30T22:10:01.000Z",
      durationMs: 1000,
      errorMessage: "Provider authentication failed.",
      createdAt: "2026-06-30T22:10:00.000Z",
      updatedAt: "2026-06-30T22:10:01.000Z",
    };

    expect(importHistory.status).toBe("failed");
    expect(Object.keys(importHistory)).not.toContain("accessToken");
    expect(Object.keys(importHistory)).not.toContain("apiKey");
    expect(Object.keys(importHistory)).not.toContain("secret");
  });

  it("supports warning messages for partial imports", () => {
    const importHistory: ImportHistory = {
      id: "import_003",
      connectionId: "connection_003",
      type: "csv_upload",
      status: "completed_with_warnings",
      provider: "csv",
      recordsProcessed: 100,
      recordsImported: 92,
      recordsSkipped: 8,
      recordsFailed: 0,
      startedAt: "2026-06-30T22:15:00.000Z",
      completedAt: "2026-06-30T22:15:04.000Z",
      durationMs: 4000,
      warningMessages: [
        "Eight duplicate records were skipped.",
      ],
      createdAt: "2026-06-30T22:15:00.000Z",
      updatedAt: "2026-06-30T22:15:04.000Z",
    };

    expect(importHistory.warningMessages).toEqual([
      "Eight duplicate records were skipped.",
    ]);
  });
});
