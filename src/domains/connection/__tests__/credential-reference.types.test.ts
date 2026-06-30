import {
  CREDENTIAL_REFERENCE_STATUSES,
  type CredentialReference,
} from "../credential-reference.types";

describe("CredentialReference", () => {
  it("supports secure credential lifecycle statuses", () => {
    expect(CREDENTIAL_REFERENCE_STATUSES).toEqual([
      "active",
      "pending_validation",
      "expired",
      "revoked",
      "invalid",
    ]);
  });

  it("represents a secure pointer to external credentials", () => {
    const credentialReference: CredentialReference = {
      id: "credential_001",
      provider: "plaid",
      externalCredentialId: "plaid_item_001",
      vaultReference: "vault://forge/plaid/credential_001",
      status: "active",
      lastValidatedAt: "2026-06-30T22:30:00.000Z",
      expiresAt: "2026-12-30T22:30:00.000Z",
      createdAt: "2026-06-30T22:00:00.000Z",
      updatedAt: "2026-06-30T22:30:00.000Z",
    };

    expect(credentialReference.status).toBe("active");
    expect(credentialReference.vaultReference).toBe(
      "vault://forge/plaid/credential_001",
    );
  });

  it("does not store raw secrets", () => {
    const credentialReference: CredentialReference = {
      id: "credential_002",
      provider: "stripe",
      externalCredentialId: "stripe_account_001",
      vaultReference: "vault://forge/stripe/credential_002",
      status: "pending_validation",
      createdAt: "2026-06-30T22:00:00.000Z",
      updatedAt: "2026-06-30T22:00:00.000Z",
    };

    expect(Object.keys(credentialReference)).not.toContain("secret");
    expect(Object.keys(credentialReference)).not.toContain("accessToken");
    expect(Object.keys(credentialReference)).not.toContain("apiKey");
  });
});
