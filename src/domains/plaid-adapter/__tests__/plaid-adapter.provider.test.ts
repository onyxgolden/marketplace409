import { describe, expect, it } from "vitest";

import {
  createPlaidAdapter,
} from "../plaid-adapter.provider";

describe("createPlaidAdapter", () => {
  it("creates a Plaid connection provider", () => {
    const adapter = createPlaidAdapter();

    expect(adapter.provider).toBe("plaid");
    expect(adapter.displayName).toBe("Plaid");
  });

  it("declares Plaid-supported capabilities", () => {
    const adapter = createPlaidAdapter();
    const capabilities = adapter.capabilities();

    expect(capabilities.capabilities).toContain("import_transactions");
    expect(capabilities.capabilities).toContain("import_balances");
    expect(capabilities.supportsManualSync).toBe(true);
    expect(capabilities.supportsWebhooks).toBe(true);
  });

  it("rejects credentials for a different provider", async () => {
    const adapter = createPlaidAdapter();

    const result = await adapter.validateCredentials({
      id: "credential_1",
      provider: "stripe",
      externalCredentialId: "external_1",
      vaultReference: "vault_1",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.operation).toBe("validate_credentials");
  });

  it("reports healthy for Plaid connections", async () => {
    const adapter = createPlaidAdapter();

    const health = await adapter.reportHealth({
      id: "connection_1",
      userId: "user_1",
      name: "Checking",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(health.state).toBe("healthy");
    expect(health.allowsImport).toBe(true);
  });
});
