import { describe, expect, it } from "vitest";

import {
  toConnectionImportOrchestratorResult,
} from "../connection-import-orchestrator.types";

describe("ConnectionImportOrchestratorResult", () => {
  it("converts provider import results into orchestrator results", () => {
    const result = toConnectionImportOrchestratorResult({
      provider: "plaid",
      connectionId: "connection_1",
      importedRecordCount: 10,
      skippedRecordCount: 2,
      failedRecordCount: 0,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({
      provider: "plaid",
      connectionId: "connection_1",
      success: true,
      importedRecordCount: 10,
      skippedRecordCount: 2,
      failedRecordCount: 0,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("marks results unsuccessful when provider reports failed records", () => {
    const result = toConnectionImportOrchestratorResult({
      provider: "plaid",
      connectionId: "connection_1",
      importedRecordCount: 10,
      skippedRecordCount: 2,
      failedRecordCount: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
