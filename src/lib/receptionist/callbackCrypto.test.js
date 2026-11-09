import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptCallbackE164,
  encryptCallbackE164,
  maskCallbackE164,
} from "./callbackCrypto";

function keyEnv(keys, current = "1") {
  return {
    RECEPTIONIST_CALLBACK_ENCRYPTION_KEYS: JSON.stringify(keys),
    RECEPTIONIST_CALLBACK_ENCRYPTION_CURRENT_KEY_ID: current,
  };
}

const KEY_1 = crypto.randomBytes(32).toString("base64");
const KEY_2 = crypto.randomBytes(32).toString("base64");

describe("receptionist callback encryption (P1-6)", () => {
  it("round-trips a callback number and stores ciphertext, never plaintext", () => {
    const env = keyEnv({ 1: KEY_1 });
    const stored = encryptCallbackE164("+15552345678", env);
    expect(stored.startsWith("v1.1.")).toBe(true);
    expect(stored).not.toContain("5552345678");
    expect(decryptCallbackE164(stored, env)).toBe("+15552345678");
  });

  it("produces different ciphertext for the same number (random IV)", () => {
    const env = keyEnv({ 1: KEY_1 });
    const a = encryptCallbackE164("+15552345678", env);
    const b = encryptCallbackE164("+15552345678", env);
    expect(a).not.toBe(b);
    expect(decryptCallbackE164(a, env)).toBe("+15552345678");
    expect(decryptCallbackE164(b, env)).toBe("+15552345678");
  });

  it("fails closed on tampered ciphertext (GCM authentication)", () => {
    const env = keyEnv({ 1: KEY_1 });
    const stored = encryptCallbackE164("+15552345678", env);
    const parts = stored.split(".");
    const raw = Buffer.from(parts[2], "base64");
    raw[raw.length - 1] ^= 0x01; // flip one ciphertext bit
    const tampered = `v1.1.${raw.toString("base64")}`;
    expect(() => decryptCallbackE164(tampered, env)).toThrow();
  });

  it("fails closed with the wrong key", () => {
    const env = keyEnv({ 1: KEY_1 });
    const stored = encryptCallbackE164("+15552345678", env);
    const otherEnv = keyEnv({ 1: KEY_2 });
    expect(() => decryptCallbackE164(stored, otherEnv)).toThrow();
  });

  it("fails closed when no key is configured (never stores plaintext)", () => {
    expect(() => encryptCallbackE164("+15552345678", {})).toThrow(
      /No callback encryption key/,
    );
    expect(() => encryptCallbackE164("+15552345678", { RECEPTIONIST_CALLBACK_ENCRYPTION_KEYS: "{}" })).toThrow(
      /No callback encryption key/,
    );
  });

  it("rejects values that are not v1 ciphertext", () => {
    const env = keyEnv({ 1: KEY_1 });
    expect(() => decryptCallbackE164("+15552345678", env)).toThrow(/not a v1 encrypted value/);
    expect(() => decryptCallbackE164("v2.1.aaaa", env)).toThrow(/not a v1 encrypted value/);
    expect(decryptCallbackE164(null, env)).toBeNull();
    expect(decryptCallbackE164("", env)).toBeNull();
  });

  it("survives key rotation: old rows still decrypt, new rows use the new key", () => {
    const before = keyEnv({ 1: KEY_1 }, "1");
    const oldStored = encryptCallbackE164("+15552345678", before);
    // Rotate: key 2 becomes current; key 1 stays available for decryption.
    const after = keyEnv({ 1: KEY_1, 2: KEY_2 }, "2");
    expect(decryptCallbackE164(oldStored, after)).toBe("+15552345678");
    const newStored = encryptCallbackE164("+15552345678", after);
    expect(newStored.startsWith("v1.2.")).toBe(true);
    expect(decryptCallbackE164(newStored, after)).toBe("+15552345678");
    // Dropping the old key orphans old rows loudly instead of silently.
    const rotatedAway = keyEnv({ 2: KEY_2 }, "2");
    expect(() => decryptCallbackE164(oldStored, rotatedAway)).toThrow(/stored key id/);
  });

  it("masks numbers for logs (last 4 only)", () => {
    expect(maskCallbackE164("+15552345678")).toBe("+1-***-***-5678");
    expect(maskCallbackE164(null)).toBeNull();
    expect(maskCallbackE164("")).toBeNull();
  });
});
