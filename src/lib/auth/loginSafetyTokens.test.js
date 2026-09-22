import { describe, expect, it } from "vitest";

import {
  createLocationActionToken,
  hashLocationActionToken,
  locationActionTokenExpiry,
  tokenHashEquals,
} from "./loginSafetyTokens.js";

describe("createLocationActionToken", () => {
  it("produces a 64-hex-char token and its SHA-256 hex hash", () => {
    const { token, tokenHash } = createLocationActionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashLocationActionToken(token));
  });

  it("produces unique tokens", () => {
    const a = createLocationActionToken();
    const b = createLocationActionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("hashLocationActionToken", () => {
  it("is deterministic", () => {
    expect(hashLocationActionToken("abc")).toBe(hashLocationActionToken("abc"));
  });

  it("rejects empty input", () => {
    expect(() => hashLocationActionToken("")).toThrow();
    expect(() => hashLocationActionToken(null)).toThrow();
  });
});

describe("tokenHashEquals", () => {
  it("matches equal hashes and rejects different ones", () => {
    const hash = hashLocationActionToken("some-token");
    expect(tokenHashEquals(hash, hash)).toBe(true);
    expect(tokenHashEquals(hash, hashLocationActionToken("other-token"))).toBe(false);
  });

  it("rejects malformed inputs", () => {
    expect(tokenHashEquals("not-hex", "also-not-hex")).toBe(false);
    expect(tokenHashEquals(null, "aa")).toBe(false);
  });
});

describe("locationActionTokenExpiry", () => {
  it("expires 24 hours after now", () => {
    const now = Date.now();
    const expiry = new Date(locationActionTokenExpiry(now)).getTime();
    expect(expiry - now).toBe(24 * 60 * 60 * 1000);
  });
});
