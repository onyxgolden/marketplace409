// Tests for src/lib/auth/turnstileVerify.js (server-side Siteverify).
// Synthetic fixtures only; Cloudflare is never called — fetch is injected.
// Secrets are never asserted on or logged.
import { describe, expect, it, vi } from "vitest";

import { DUMMY_SECRET_FAIL, DUMMY_SECRET_PASS, TURNSTILE_SITEVERIFY_URL } from "./turnstilePolicy.js";
import { getTurnstileSecret, verifyTurnstileToken } from "./turnstileVerify.js";

const DEV_ENV = { NODE_ENV: "development", TURNSTILE_SECRET_KEY: "test-secret-not-a-dummy" };
const PROD_ENV = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "0x4AAAAAAFakeRealSecretKey" };

function siteverifyResponse(overrides = {}) {
  return {
    success: true,
    hostname: "409marketplace.online",
    action: "contact",
    ...overrides,
  };
}

function fetchJson(payload, { status = 200 } = {}) {
  return vi.fn(async () => ({
    status,
    json: async () => payload,
  }));
}

describe("getTurnstileSecret", () => {
  it("prefers the configured secret", () => {
    expect(getTurnstileSecret({ TURNSTILE_SECRET_KEY: " 0xREAL ", NODE_ENV: "production" })).toBe("0xREAL");
  });

  it("falls back to Cloudflare's always-pass dummy secret outside production", () => {
    expect(getTurnstileSecret({ NODE_ENV: "development" })).toBe(DUMMY_SECRET_PASS);
    expect(getTurnstileSecret({ NODE_ENV: "test" })).toBe(DUMMY_SECRET_PASS);
  });

  it("returns null in production with no secret configured (fail closed)", () => {
    expect(getTurnstileSecret({ NODE_ENV: "production" })).toBeNull();
  });
});

describe("verifyTurnstileToken", () => {
  it("accepts a valid token and posts the secret + token to Siteverify", async () => {
    const fetchImpl = fetchJson(siteverifyResponse());
    const result = await verifyTurnstileToken({
      token: "0.AQFakeToken",
      action: "contact",
      expectedHostname: "409marketplace.online",
      remoteIp: "203.0.113.7",
      env: DEV_ENV,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("secret")).toBe("test-secret-not-a-dummy");
    expect(body.get("response")).toBe("0.AQFakeToken");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("refuses a missing or empty token without calling Cloudflare", async () => {
    const fetchImpl = fetchJson(siteverifyResponse());
    for (const token of [null, undefined, "", "   "]) {
      expect(
        await verifyTurnstileToken({ token, env: DEV_ENV, fetchImpl })
      ).toEqual({ ok: false, reason: "missing-token" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an over-long token without calling Cloudflare", async () => {
    const fetchImpl = fetchJson(siteverifyResponse());
    const result = await verifyTurnstileToken({
      token: "x".repeat(2049),
      env: DEV_ENV,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: "missing-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed with no secret in production (missing-secret, zero Cloudflare calls)", async () => {
    const fetchImpl = fetchJson(siteverifyResponse());
    const result = await verifyTurnstileToken({
      token: "0.AQFakeToken",
      env: { NODE_ENV: "production" },
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: "missing-secret" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a dummy secret in production (never silently switch verification off)", async () => {
    const fetchImpl = fetchJson(siteverifyResponse());
    const result = await verifyTurnstileToken({
      token: "0.AQFakeToken",
      env: { NODE_ENV: "production", TURNSTILE_SECRET_KEY: DUMMY_SECRET_PASS },
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: "missing-secret" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an invalid token (Cloudflare success:false)", async () => {
    const fetchImpl = fetchJson({ success: false, "error-codes": ["invalid-input-response"] });
    const result = await verifyTurnstileToken({ token: "0.AQFakeToken", env: DEV_ENV, fetchImpl });
    expect(result).toEqual({ ok: false, reason: "invalid-token" });
  });

  it("refuses a token minted for another hostname", async () => {
    const fetchImpl = fetchJson(siteverifyResponse({ hostname: "evil.example" }));
    const result = await verifyTurnstileToken({
      token: "0.AQFakeToken",
      expectedHostname: "409marketplace.online",
      env: DEV_ENV,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: "wrong-hostname" });
  });

  it("refuses a token minted for another action", async () => {
    const fetchImpl = fetchJson(siteverifyResponse({ action: "signup" }));
    const result = await verifyTurnstileToken({
      token: "0.AQFakeToken",
      action: "contact",
      env: DEV_ENV,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: "wrong-action" });
  });

  it("fails closed on a Cloudflare outage (fetch throws) and on an unreadable response", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(
      await verifyTurnstileToken({ token: "0.AQFakeToken", env: DEV_ENV, fetchImpl: throwing })
    ).toEqual({ ok: false, reason: "unavailable" });

    const badJson = vi.fn(async () => ({ json: async () => { throw new Error("not json"); } }));
    expect(
      await verifyTurnstileToken({ token: "0.AQFakeToken", env: DEV_ENV, fetchImpl: badJson })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("skips hostname/action matching while a dummy secret is in use (Cloudflare test answers carry neither reliably)", async () => {
    const fetchImpl = fetchJson({ success: true, hostname: "localhost" });
    const result = await verifyTurnstileToken({
      token: "XXXX.DUMMY.TOKEN.XXXX",
      action: "contact",
      expectedHostname: "409marketplace.online",
      env: { NODE_ENV: "development", TURNSTILE_SECRET_KEY: DUMMY_SECRET_PASS },
      fetchImpl,
    });
    // The test answer carries hostname "localhost" and no action at all —
    // with a real secret that would be wrong-hostname / wrong-action. With a
    // dummy secret the match is skipped and the success stands.
    expect(result).toEqual({ ok: true });
  });
});
