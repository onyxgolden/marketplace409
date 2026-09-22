import { describe, expect, it } from "vitest";

import { loginSessionRecordKey } from "./useLoginSafety.js";

describe("loginSessionRecordKey", () => {
  it("is stable for the same session", () => {
    const session = { user: { id: "user-1" }, expires_at: 1234567890 };
    expect(loginSessionRecordKey(session)).toBe(loginSessionRecordKey(session));
  });

  it("differs across sessions and users", () => {
    const a = loginSessionRecordKey({ user: { id: "user-1" }, expires_at: 1 });
    const b = loginSessionRecordKey({ user: { id: "user-1" }, expires_at: 2 });
    const c = loginSessionRecordKey({ user: { id: "user-2" }, expires_at: 1 });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("stays within the 128-char session_id cap", () => {
    const key = loginSessionRecordKey({ user: { id: "e1b22131-9100-4a79-bbe2-b82d43af922e" }, expires_at: 9999999999 });
    expect(key.length).toBeLessThanOrEqual(128);
  });
});
