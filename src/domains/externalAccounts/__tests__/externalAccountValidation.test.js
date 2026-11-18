// Domain validation for the External Accounts Register.
// Test values are obviously-fake shapes (short, patterned, example
// domains) — never live credentials.
import { describe, expect, it } from "vitest";
import {
  containsSecretLikeValue,
  findSecretLikeFields,
  isValidAccountEmail,
  seedKeyForSlug,
  slugifyProviderName,
  validateExternalAccountPayload,
  validateExternalAccountThreadPayload,
  EXTERNAL_ACCOUNT_SEED_VERSION,
} from "../externalAccountValidation";

describe("containsSecretLikeValue", () => {
  it("rejects representative pasted secrets", () => {
    expect(containsSecretLikeValue("sk-abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(containsSecretLikeValue("sk-ant-api03-abcdefghij1234")).toBe(true);
    expect(containsSecretLikeValue("ghp_abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(containsSecretLikeValue("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(containsSecretLikeValue("xoxb-123456789012-abcdefghij")).toBe(true);
    expect(containsSecretLikeValue("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(containsSecretLikeValue("api_key=abc123def456")).toBe(true);
    expect(containsSecretLikeValue("password: hunter2-hunter2")).toBe(true);
    expect(containsSecretLikeValue("https://user:hunter2@example.test/x")).toBe(true);
    expect(containsSecretLikeValue("aB3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zA7bC0d")).toBe(true);
  });

  it("accepts human-readable locators and plain prose", () => {
    expect(containsSecretLikeValue("1Password → FORGE")).toBe(false);
    expect(containsSecretLikeValue("Secure Vault")).toBe(false);
    expect(containsSecretLikeValue("Transactional email for tenant invites")).toBe(false);
    expect(containsSecretLikeValue("https://github.com/onyxgolden/marketplace409")).toBe(false);
    expect(containsSecretLikeValue("")).toBe(false);
    expect(containsSecretLikeValue(null)).toBe(false);
  });

  it("findSecretLikeFields names the field, never the value", () => {
    const hits = findSecretLikeFields(
      { provider_name: "Co", notes: "key is sk-abcdefghijklmnopqrstuvwx" },
      ["provider_name", "notes"],
    );
    expect(hits).toEqual(["notes"]);
    expect(JSON.stringify(hits)).not.toContain("sk-");
  });
});

describe("validateExternalAccountPayload", () => {
  const good = {
    provider_name: "Stripe",
    purpose: "Payments",
    associated_app: "Rental Manager",
    account_email: "jasonmorgan99@gmail.com",
    plan_status: "unknown",
    api_integration_status: "integrated",
    record_status: "confirmed_account",
    setup_status: "ready",
    source_kind: "manual",
  };

  it("accepts a complete valid payload", () => {
    expect(validateExternalAccountPayload(good)).toEqual({ ok: true, errors: [] });
  });

  it("requires provider, purpose, and app on create", () => {
    const { ok, errors } = validateExternalAccountPayload({ provider_name: "  " });
    expect(ok).toBe(false);
    expect(errors).toContain("Provider name is required.");
    expect(errors).toContain("Purpose is required.");
    expect(errors).toContain("Associated app is required.");
  });

  it("allows a partial update payload", () => {
    expect(validateExternalAccountPayload({ notes: "Owner note" }, { forUpdate: true })).toEqual({ ok: true, errors: [] });
    const blank = validateExternalAccountPayload({ provider_name: " " }, { forUpdate: true });
    expect(blank.ok).toBe(false);
  });

  it("rejects bad enums, bad email, and overlong fields", () => {
    const { ok, errors } = validateExternalAccountPayload({
      ...good,
      plan_status: "solid-gold",
      account_email: "not-an-email",
      notes: "x".repeat(2001),
    });
    expect(ok).toBe(false);
    expect(errors).toContain("plan_status is not a recognized value.");
    expect(errors).toContain("Account email does not look like an email address.");
    expect(errors.some((e) => e.startsWith("notes is too long"))).toBe(true);
  });

  it("rejects a secret pasted into a free-text field, naming the field only", () => {
    const { ok, errors } = validateExternalAccountPayload({
      ...good,
      credential_location: "sk-abcdefghijklmnopqrstuvwx",
    });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("credential_location");
    expect(errors[0]).not.toContain("sk-");
  });

  it("accepts a null email and a null still_needed (undecided)", () => {
    expect(validateExternalAccountPayload({ ...good, account_email: null, still_needed: null }).ok).toBe(true);
    expect(validateExternalAccountPayload({ ...good, still_needed: "maybe" }).ok).toBe(false);
  });
});

describe("validateExternalAccountThreadPayload", () => {
  it("requires a title and rejects bad states and secrets", () => {
    expect(validateExternalAccountThreadPayload({}).ok).toBe(false);
    expect(validateExternalAccountThreadPayload({ title: "Radar scope", state: "done" }).ok).toBe(false);
    expect(validateExternalAccountThreadPayload({ title: "Radar scope", state: "open" }).ok).toBe(true);
    const secret = validateExternalAccountThreadPayload({ title: "x", next_action: "token=abc123" });
    expect(secret.ok).toBe(false);
  });
});

describe("seed keys", () => {
  it("builds stable, URL-safe keys", () => {
    expect(EXTERNAL_ACCOUNT_SEED_VERSION).toBe("external_accounts_seed_v1");
    expect(slugifyProviderName("Google Cloud / Cloud Vision")).toBe("google-cloud-cloud-vision");
    expect(seedKeyForSlug("github")).toBe("external_accounts_seed_v1:github");
  });
});

describe("isValidAccountEmail", () => {
  it("accepts null/empty and real shapes, rejects junk", () => {
    expect(isValidAccountEmail(null)).toBe(true);
    expect(isValidAccountEmail("")).toBe(true);
    expect(isValidAccountEmail("jasonmorgan99@gmail.com")).toBe(true);
    expect(isValidAccountEmail("not-an-email")).toBe(false);
    expect(isValidAccountEmail("a@b")).toBe(false);
  });
});
