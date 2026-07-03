import {
  CONNECTION_CAPABILITY_KEYS,
  hasConnectionCapability,
  type ConnectionCapabilities,
} from "../connection-capabilities.types";

describe("ConnectionCapabilities", () => {
  it("supports provider-agnostic capability keys", () => {
    expect(CONNECTION_CAPABILITY_KEYS).toEqual([
      "import_accounts",
      "import_transactions",
      "import_balances",
      "import_invoices",
      "import_customers",
      "import_properties",
      "import_payouts",
      "export_data",
      "manual_sync",
      "scheduled_sync",
      "webhook_updates",
      "realtime_updates",
    ]);
  });

  it("represents what a connection can do", () => {
    const capabilities: ConnectionCapabilities = {
      connectionId: "connection_001",
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
      createdAt: "2026-06-30T22:30:00.000Z",
      updatedAt: "2026-06-30T22:30:00.000Z",
    };

    expect(capabilities.connectionId).toBe("connection_001");
    expect(capabilities.supportsAutomaticSync).toBe(true);
    expect(capabilities.capabilities).toContain("import_transactions");
  });

  it("checks whether a capability is supported", () => {
    const capabilities: ConnectionCapabilities = {
      connectionId: "connection_002",
      capabilities: [
        "import_payouts",
        "manual_sync",
        "webhook_updates",
      ],
      supportsAutomaticSync: false,
      supportsManualSync: true,
      supportsWebhooks: true,
      supportsRealtimeUpdates: false,
      createdAt: "2026-06-30T22:35:00.000Z",
      updatedAt: "2026-06-30T22:35:00.000Z",
    };

    expect(hasConnectionCapability(capabilities, "import_payouts")).toBe(true);
    expect(hasConnectionCapability(capabilities, "import_invoices")).toBe(false);
  });

  it("keeps provider identity out of capability modeling", () => {
    const capabilities: ConnectionCapabilities = {
      connectionId: "connection_003",
      capabilities: [
        "import_invoices",
        "import_customers",
        "export_data",
      ],
      supportsAutomaticSync: true,
      supportsManualSync: true,
      supportsWebhooks: false,
      supportsRealtimeUpdates: false,
      createdAt: "2026-06-30T22:40:00.000Z",
      updatedAt: "2026-06-30T22:40:00.000Z",
    };

    expect(Object.keys(capabilities)).not.toContain("provider");
    expect(Object.keys(capabilities)).not.toContain("plaid");
    expect(Object.keys(capabilities)).not.toContain("stripe");
    expect(Object.keys(capabilities)).not.toContain("quickbooks");
  });
});
