import {
  describe,
  expect,
  it,
} from "vitest";

import type { Connection } from "../connection.types";
import type { ConnectionCapabilities } from "../connection-capabilities.types";
import type { ConnectionHealth } from "../connection-health.types";
import type { InstitutionReference } from "../institution-reference.types";
import {
  getConnectionStatusDetails,
  type ConnectionStatusDetails,
} from "../connection-status.types";
import type { ConnectionSummary } from "../connection-summary.types";

describe("ConnectionSummary", () => {
  it("composes one executive-readable connection view from stable domain objects", () => {
    const connection: Connection = {
      id: "connection_001",
      userId: "user_001",
      name: "Operating Account",
      type: "bank",
      status: "connected",
      provider: "adapter-placeholder",
      credentialReferenceId: "credential_001",
      lastImportedAt: "2026-06-30T23:30:00.000Z",
      createdAt: "2026-06-30T22:00:00.000Z",
      updatedAt: "2026-06-30T23:30:00.000Z",
    };

    const statusDetails: ConnectionStatusDetails =
      getConnectionStatusDetails(connection.status);

    const capabilities: ConnectionCapabilities = {
      connectionId: connection.id,
      capabilities: [
        "import_transactions",
        "import_balances",
        "manual_sync",
        "scheduled_sync",
      ],
      supportsAutomaticSync: true,
      supportsManualSync: true,
      supportsWebhooks: false,
      supportsRealtimeUpdates: false,
      createdAt: "2026-06-30T22:05:00.000Z",
      updatedAt: "2026-06-30T22:05:00.000Z",
    };

    const institution: InstitutionReference = {
      id: "institution_001",
      connectionId: connection.id,
      name: "409 Community Bank",
      type: "bank",
      provider: "adapter-placeholder",
      externalInstitutionId: "external_institution_001",
      websiteUrl: "https://example.com",
      createdAt: "2026-06-30T22:10:00.000Z",
      updatedAt: "2026-06-30T22:10:00.000Z",
    };

    const health: ConnectionHealth = {
      connectionId: connection.id,
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

    const summary: ConnectionSummary = {
      connection,
      statusDetails,
      capabilities,
      institution,
      health,
      createdAt: "2026-06-30T23:40:00.000Z",
      updatedAt: "2026-06-30T23:40:00.000Z",
    };

    expect(summary.connection.id).toBe("connection_001");
    expect(summary.statusDetails.label).toBe("Connected");
    expect(summary.capabilities.supportsAutomaticSync).toBe(true);
    expect(summary.institution.name).toBe("409 Community Bank");
    expect(summary.health.state).toBe("healthy");
  });

  it("keeps secrets, raw provider payloads, and transactions out of summary modeling", () => {
    const summaryKeys = [
      "connection",
      "statusDetails",
      "capabilities",
      "institution",
      "health",
      "createdAt",
      "updatedAt",
    ];

    expect(summaryKeys).not.toContain("secret");
    expect(summaryKeys).not.toContain("accessToken");
    expect(summaryKeys).not.toContain("apiKey");
    expect(summaryKeys).not.toContain("rawProviderPayload");
    expect(summaryKeys).not.toContain("transactions");
    expect(summaryKeys).not.toContain("adapter");
  });
});
