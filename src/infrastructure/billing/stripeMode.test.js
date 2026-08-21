import { describe, expect, it } from "vitest";
import { resolveStripeMode, validatePublishableKeyMode } from "./stripeMode.js";

describe("resolveStripeMode", () => {
  it("resolves test mode with a matching sk_test_ key", () => {
    expect(resolveStripeMode({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_abc123" }))
      .toEqual({ mode: "test", secretKey: "sk_test_abc123" });
  });
  it("resolves live mode with a matching sk_live_ key", () => {
    expect(resolveStripeMode({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_abc123" }))
      .toEqual({ mode: "live", secretKey: "sk_live_abc123" });
  });
  it("fails closed when STRIPE_MODE is missing", () => {
    expect(() => resolveStripeMode({ STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/STRIPE_MODE/);
  });
  it("fails closed on an invalid STRIPE_MODE value", () => {
    expect(() => resolveStripeMode({ STRIPE_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/STRIPE_MODE/);
  });
  it("fails closed when STRIPE_SECRET_KEY is missing", () => {
    expect(() => resolveStripeMode({ STRIPE_MODE: "test" })).toThrow(/STRIPE_SECRET_KEY/);
  });
  it("fails closed when mode is test but the key looks like a live key", () => {
    expect(() => resolveStripeMode({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_live_abc123" })).toThrow(/does not start with/);
  });
  it("fails closed when mode is live but the key looks like a test key", () => {
    expect(() => resolveStripeMode({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/does not start with/);
  });
  it("never includes the actual configured key in a thrown error message", () => {
    try {
      resolveStripeMode({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_test_super-secret-value" });
      throw new Error("expected resolveStripeMode to throw");
    } catch (error) {
      expect(error.message).not.toContain("super-secret-value");
      expect(error.message).not.toContain("sk_test_super-secret-value");
    }
  });
  it("ignores NEXT_PUBLIC_ variables entirely — only server-side STRIPE_MODE/STRIPE_SECRET_KEY are read", () => {
    expect(resolveStripeMode({
      STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_abc123",
      NEXT_PUBLIC_STRIPE_MODE: "live", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_xyz",
    })).toEqual({ mode: "test", secretKey: "sk_test_abc123" });
  });
});

describe("validatePublishableKeyMode", () => {
  it("passes silently when a test publishable key matches test mode", () => {
    expect(() => validatePublishableKeyMode("test", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc123" })).not.toThrow();
  });
  it("passes silently when a live publishable key matches live mode", () => {
    expect(() => validatePublishableKeyMode("live", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc123" })).not.toThrow();
  });
  it("fails closed when a live server would render a pk_test_ key", () => {
    expect(() => validatePublishableKeyMode("live", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc123" })).toThrow(/requires a publishable key/);
  });
  it("fails closed when a test server would render a pk_live_ key", () => {
    expect(() => validatePublishableKeyMode("test", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc123" })).toThrow(/requires a publishable key/);
  });
  it("fails closed when the publishable key is missing entirely", () => {
    expect(() => validatePublishableKeyMode("live", {})).toThrow(/NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required/);
  });
  it("never includes the actual configured publishable key value in a thrown error message", () => {
    try {
      validatePublishableKeyMode("live", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_super-secret-looking-suffix" });
      throw new Error("expected validatePublishableKeyMode to throw");
    } catch (error) {
      expect(error.message).not.toContain("super-secret-looking-suffix");
      expect(error.message).not.toContain("pk_test_super-secret-looking-suffix");
    }
  });
});

describe("mixed-key partial state — the app can never run with one variable stale relative to the others", () => {
  // Documents the rollout-order guarantee in docs/product/STRIPE_LIVE_MODE_ROLLOUT_RUNBOOK.md:
  // STRIPE_MODE, STRIPE_SECRET_KEY, and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must change together.
  // Every partial combination below must fail closed at either resolveStripeMode or
  // validatePublishableKeyMode — never silently proceed with a mismatched pair.
  const fullyLive = { STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x" };
  const fullyTest = { STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x" };

  function attemptServe(env) {
    const { mode } = resolveStripeMode(env);
    validatePublishableKeyMode(mode, env);
  }

  it("both fully-consistent configurations succeed", () => {
    expect(() => attemptServe(fullyLive)).not.toThrow();
    expect(() => attemptServe(fullyTest)).not.toThrow();
  });

  it("only STRIPE_MODE flipped to live (secret + publishable key still test) fails closed", () => {
    expect(() => attemptServe({ ...fullyTest, STRIPE_MODE: "live" })).toThrow();
  });

  it("only STRIPE_SECRET_KEY flipped to live (mode + publishable key still test) fails closed", () => {
    expect(() => attemptServe({ ...fullyTest, STRIPE_SECRET_KEY: "sk_live_x" })).toThrow();
  });

  it("only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY flipped to live (mode + secret still test) fails closed", () => {
    expect(() => attemptServe({ ...fullyTest, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x" })).toThrow();
  });

  it("mode+secret flipped to live but publishable key left on test fails closed (the exact step-8 hazard this runbook prevents)", () => {
    expect(() => attemptServe({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x" })).toThrow();
  });
});
