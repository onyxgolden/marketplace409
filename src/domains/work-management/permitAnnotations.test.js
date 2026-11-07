// Slice 3 — permit link URL validation (syntax-only, no network).
import { describe, expect, it } from "vitest";
import {
  normalizePermitAnnotationUrl,
  validatePermitAnnotationInput,
  validatePermitAnnotationUpdateInput,
  validatePermitAnnotationRetireInput,
} from "./permitAnnotations.js";

describe("normalizePermitAnnotationUrl", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["https://example.com/permit/123", "https://example.com/permit/123"],
    ["https://example.com/permit/123?ref=abc&x=1", "https://example.com/permit/123?ref=abc&x=1"],
    ["https://sub.domain.co.uk/a/b", "https://sub.domain.co.uk/a/b"],
    ["https://example.com:8443/x", "https://example.com:8443/x"],
    ["https://EXAMPLE.com/Path", "https://example.com/Path"],
    ["  https://example.com/pad  ", "https://example.com/pad"],
    ["https://example.com/path@name", "https://example.com/path@name"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePermitAnnotationUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ["http://example.com/x", /secure \(https\)/],
    ["ftp://example.com/x", /secure \(https\)/],
    ["javascript:alert(1)", /secure \(https\)/],
    ["data:text/html,hi", /secure \(https\)/],
    ["//example.com/x", /valid secure/],
    ["example.com/x", /valid secure/],
    ["https://", /valid secure/],
    ["https://localhost/x", /localhost/],
    ["https://app.localhost/x", /localhost/],
    ["https://127.0.0.1/x", /private or loopback/],
    ["https://127.0.0.2/x", /private or loopback/],
    ["https://10.0.0.5/x", /private or loopback/],
    ["https://192.168.1.1/x", /private or loopback/],
    ["https://172.16.0.1/x", /private or loopback/],
    ["https://172.31.255.255/x", /private or loopback/],
    ["https://0.0.0.0/x", /private or loopback/],
    ["https://[::1]/x", /private or loopback/],
    ["https://[fe80::1]/x", /private or loopback/],
    ["https://[fc00::1]/x", /private or loopback/],
    ["https://user:pass@example.com/x", /username or password/],
    ["https://user@example.com/x", /username or password/],
    ["https://example.com/pa th", /spaces/],
    ["https://exam ple.com/x", /spaces/],
    ["", /web address/],
    ["   ", /web address/],
    [null, /web address/],
    [123, /web address/],
    [`https://example.com/${"a".repeat(2040)}`, /at most 2048/],
  ])("rejects %s", (input, pattern) => {
    const result = normalizePermitAnnotationUrl(input);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(pattern);
  });

  it("never performs a network call: validation is synchronous and pure", () => {
    // A URL that only resolves over the network must still validate
    // purely on syntax — and an unresolvable host is accepted, because
    // dead links stay saved and editable.
    expect(normalizePermitAnnotationUrl("https://no-such-host.invalid/permit")).toEqual({
      ok: true,
      url: "https://no-such-host.invalid/permit",
    });
    expect(normalizePermitAnnotationUrl("https://example.com/dead-link-404")).toEqual({
      ok: true,
      url: "https://example.com/dead-link-404",
    });
  });
});

describe("validatePermitAnnotationInput", () => {
  it("accepts a minimal label + URL and normalizes optionals to null", () => {
    const result = validatePermitAnnotationInput({
      targetKind: "package",
      label: "  City permit portal  ",
      url: "https://EXAMPLE.com/permits/9",
    });
    expect(result).toEqual({
      ok: true,
      errors: [],
      values: {
        label: "City permit portal",
        url: "https://example.com/permits/9",
        permitReference: null,
        note: null,
      },
    });
  });

  it("trims optionals and turns blank optionals into null", () => {
    const result = validatePermitAnnotationInput({
      targetKind: "drawing",
      label: "Permit",
      url: "https://example.com/x",
      permitReference: "  PERMIT-42  ",
      note: "   ",
    });
    expect(result.ok).toBe(true);
    expect(result.values).toMatchObject({ permitReference: "PERMIT-42", note: null });
  });

  it("rejects a missing label, a non-HTTPS URL, and an unknown target together", () => {
    const result = validatePermitAnnotationInput({
      targetKind: "line",
      label: "   ",
      url: "http://example.com/x",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.values).toBeNull();
  });

  it("rejects over-long label, reference, and note", () => {
    const result = validatePermitAnnotationInput({
      targetKind: "package",
      label: "x".repeat(161),
      url: "https://example.com/x",
      permitReference: "x".repeat(121),
      note: "x".repeat(1001),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});

describe("validatePermitAnnotationUpdateInput", () => {
  it("requires expectedVersion and at least one change", () => {
    expect(validatePermitAnnotationUpdateInput({}).ok).toBe(false);
    expect(validatePermitAnnotationUpdateInput({ label: "New" }).ok).toBe(false);
    expect(validatePermitAnnotationUpdateInput({ expectedVersion: 2 }).ok).toBe(false);
    expect(validatePermitAnnotationUpdateInput({ expectedVersion: 2, label: "New" }).ok).toBe(true);
  });

  it("accepts null to clear an optional field and keeps absent fields undefined", () => {
    const result = validatePermitAnnotationUpdateInput({
      expectedVersion: 2,
      note: null,
      label: "Renamed",
    });
    expect(result.ok).toBe(true);
    expect(result.values.note).toBeNull();
    expect(result.values.url).toBeUndefined();
    expect(result.values.permitReference).toBeUndefined();
  });

  it("rejects a bad URL in a patch without touching other fields", () => {
    const result = validatePermitAnnotationUpdateInput({
      expectedVersion: 2,
      url: "https://192.168.0.1/x",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/private or loopback/);
  });
});

describe("validatePermitAnnotationRetireInput", () => {
  it("requires expectedVersion and caps the reason", () => {
    expect(validatePermitAnnotationRetireInput({}).ok).toBe(false);
    expect(validatePermitAnnotationRetireInput({ expectedVersion: 1 }).ok).toBe(true);
    expect(validatePermitAnnotationRetireInput({ expectedVersion: 1, reason: "x".repeat(2001) }).ok).toBe(false);
    expect(validatePermitAnnotationRetireInput({ expectedVersion: 1, reason: "Superseded" }).values)
      .toEqual({ reason: "Superseded" });
  });
});
