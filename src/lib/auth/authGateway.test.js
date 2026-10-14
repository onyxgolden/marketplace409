// Tests for the Layer 2 auth gateway transport: UUID-shaped operation ids
// (the gateway 400s on malformed ids) and response normalization.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gatewayErrorMessage,
  gatewayMfaEnroll,
  gatewaySignIn,
  getBrowserAccessToken,
  newOperationId,
} from "./authGateway.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("newOperationId", () => {
  it("produces UUID-shaped ids (crypto.randomUUID path)", () => {
    expect(newOperationId()).toMatch(UUID_RE);
  });

  it("falls back to a UUIDv4-shaped id without crypto.randomUUID", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const id = newOperationId();
      expect(id).toMatch(UUID_RE);
      expect(id[14]).toBe("4");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newOperationId()));
    expect(ids.size).toBe(50);
  });
});

describe("gateway response normalization", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(payload, { status = 200, ok = true } = {}) {
    globalThis.fetch = vi.fn(async () => ({
      ok,
      status,
      headers: { get: () => null },
      json: async () => payload,
    }));
  }

  it("passes the route's status/session/next fields through untouched", async () => {
    stubFetch({ status: "mfa_required", next: "enroll" }, { status: 403, ok: false });
    const result = await gatewaySignIn({ operationId: newOperationId(), email: "a@b.c", password: "x" });
    expect(result.httpStatus).toBe(403);
    expect(result.status).toBe("mfa_required");
    expect(result.next).toBe("enroll");
  });

  it("maps transport failures to the generic connectivity message", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("down"); });
    const result = await gatewayMfaEnroll({ operationId: newOperationId(), accessToken: "tok" });
    expect(result.transportError).toMatch(/couldn't reach the sign-in service/i);
    expect(gatewayErrorMessage(result)).toBe(result.transportError);
  });

  it("prefers the route's error text when present", () => {
    expect(gatewayErrorMessage({ error: "Too many attempts. Please wait and try again." }))
      .toBe("Too many attempts. Please wait and try again.");
  });

  it("reads the access token from the browser session, or null without one", async () => {
    const withSession = { auth: { getSession: async () => ({ data: { session: { access_token: "atk" } } }) } };
    expect(await getBrowserAccessToken(withSession)).toBe("atk");
    const without = { auth: { getSession: async () => ({ data: { session: null } }) } };
    expect(await getBrowserAccessToken(without)).toBeNull();
    const throwing = { auth: { getSession: async () => { throw new Error("x"); } } };
    expect(await getBrowserAccessToken(throwing)).toBeNull();
  });
});
