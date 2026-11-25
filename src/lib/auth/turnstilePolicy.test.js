// Tests for src/lib/auth/turnstilePolicy.js. Synthetic fixtures only.
import { describe, expect, it } from "vitest";

import {
  DUMMY_SECRET_FAIL,
  DUMMY_SECRET_PASS,
  DUMMY_SITE_KEY_PASS,
  TURNSTILE_CONFIG,
  getTurnstileSiteKey,
  isDummySecret,
  isTurnstileEnabled,
} from "./turnstilePolicy.js";

describe("TURNSTILE_CONFIG", () => {
  it("ships inert: disabled by default", () => {
    expect(TURNSTILE_CONFIG.enabled).toBe(false);
    expect(isTurnstileEnabled()).toBe(false);
  });

  it("honours an explicit config (tests pass their own; the frozen default never flips)", () => {
    expect(isTurnstileEnabled({ enabled: true })).toBe(true);
    expect(isTurnstileEnabled({ enabled: false })).toBe(false);
    expect(isTurnstileEnabled()).toBe(false);
  });
});

describe("getTurnstileSiteKey", () => {
  it("prefers the configured public site key", () => {
    expect(
      getTurnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: " 0xREALKEY ", NODE_ENV: "production" })
    ).toBe("0xREALKEY");
  });

  it("falls back to Cloudflare's always-pass dummy sitekey outside production", () => {
    expect(getTurnstileSiteKey({ NODE_ENV: "development" })).toBe(DUMMY_SITE_KEY_PASS);
    expect(getTurnstileSiteKey({ NODE_ENV: "test" })).toBe(DUMMY_SITE_KEY_PASS);
    expect(getTurnstileSiteKey({})).toBe(DUMMY_SITE_KEY_PASS);
  });

  it("returns null in production with no key configured (widget cannot render; fail closed)", () => {
    expect(getTurnstileSiteKey({ NODE_ENV: "production" })).toBeNull();
  });
});

describe("isDummySecret", () => {
  it("recognises Cloudflare's published dummy secrets", () => {
    expect(isDummySecret(DUMMY_SECRET_PASS)).toBe(true);
    expect(isDummySecret(DUMMY_SECRET_FAIL)).toBe(true);
    expect(isDummySecret("3x0000000000000000000000000000000AA")).toBe(true);
  });

  it("rejects a real-shaped secret", () => {
    expect(isDummySecret("0x4AAAAAAFakeRealSecretKey")).toBe(false);
    expect(isDummySecret("")).toBe(false);
    expect(isDummySecret(null)).toBe(false);
  });
});
