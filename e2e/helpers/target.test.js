// Unit tests for the smoke suite's target gates (pure functions, no I/O).
// These run in the repo's vitest job; the Playwright specs themselves are
// named *.e2e.js so vitest never picks them up.
import { describe, expect, it } from "vitest";
import {
  assertAllowedBaseUrl,
  assertScratchSupabaseUrl,
  assertTestStripeKeys,
  isTestPublishableKey,
  isTestSecretKey,
  makeRunId,
  readTargetEnv,
  syntheticEmail,
  syntheticId,
} from "./target.js";

describe("assertAllowedBaseUrl", () => {
  it("accepts localhost and preview deployments", () => {
    expect(assertAllowedBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(assertAllowedBaseUrl("https://marketplace409-git-smoke-onyxgolden.vercel.app/")).toBe(
      "https://marketplace409-git-smoke-onyxgolden.vercel.app",
    );
  });

  it("refuses production hosts", () => {
    for (const host of ["https://409marketplace.online", "https://www.409marketplace.online", "https://marketplace409.vercel.app"]) {
      expect(() => assertAllowedBaseUrl(host)).toThrow(/production/i);
    }
  });

  it("refuses non-preview, non-local hosts and non-http(s) URLs", () => {
    expect(() => assertAllowedBaseUrl("https://staging.example.com")).toThrow(/not an allowed test target/i);
    expect(() => assertAllowedBaseUrl("ftp://localhost:3000")).toThrow(/http\(s\)/i);
    expect(() => assertAllowedBaseUrl("not a url")).toThrow(/valid URL/i);
    expect(() => assertAllowedBaseUrl("")).toThrow(/required/i);
  });
});

describe("assertScratchSupabaseUrl", () => {
  it("refuses the production project ref", () => {
    expect(() => assertScratchSupabaseUrl("https://bzqvenxjlstinmgbuvvg.supabase.co")).toThrow(/production/i);
  });

  it("accepts other https project URLs", () => {
    expect(assertScratchSupabaseUrl("https://abcdefghijklm.supabase.co")).toBe("https://abcdefghijklm.supabase.co");
  });
});

describe("stripe test-mode keys", () => {
  it("accepts test keys and rejects live keys", () => {
    expect(isTestSecretKey("sk_test_abc")).toBe(true);
    expect(isTestSecretKey("sk_live_abc")).toBe(false);
    expect(isTestPublishableKey("pk_test_abc")).toBe(true);
    expect(isTestPublishableKey("pk_live_abc")).toBe(false);
    expect(() => assertTestStripeKeys("sk_live_x", "pk_test_x")).toThrow(/sk_test_/i);
    expect(() => assertTestStripeKeys("sk_test_x", "pk_live_x")).toThrow(/pk_test_/i);
  });
});

describe("run ids and synthetic identifiers", () => {
  it("makes unique, safe run ids and run-prefixed identifiers", () => {
    const a = makeRunId();
    const b = makeRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^e2e-\d{8}-[a-z0-9]+$/);
    expect(syntheticEmail(a, "tenant")).toBe(`smoke-tenant-${a}@e2e.invalid`);
    expect(syntheticId(a, "tenant", 1)).toContain("tenant_1");
    expect(syntheticId(a, "tenant", 1)).toMatch(/^e2e_[A-Za-z0-9_]+$/);
  });
});

describe("readTargetEnv", () => {
  it("names every missing piece instead of running half-provisioned", () => {
    expect(() => readTargetEnv({})).toThrow(/E2E_BASE_URL.*E2E_SUPABASE_URL.*E2E_STRIPE_WEBHOOK_SECRET/s);
  });

  it("validates a complete test target", () => {
    const config = readTargetEnv({
      E2E_BASE_URL: "https://marketplace409-git-smoke-onyxgolden.vercel.app",
      E2E_SUPABASE_URL: "https://scratchproj.supabase.co",
      E2E_SUPABASE_SERVICE_ROLE_KEY: "service-key",
      E2E_STRIPE_SECRET_KEY: "sk_test_x",
      E2E_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
      E2E_STRIPE_CONNECTED_ACCOUNT_ID: "acct_test",
      E2E_STRIPE_WEBHOOK_SECRET: "whsec_test",
    });
    expect(config.baseUrl).toBe("https://marketplace409-git-smoke-onyxgolden.vercel.app");
  });
});
