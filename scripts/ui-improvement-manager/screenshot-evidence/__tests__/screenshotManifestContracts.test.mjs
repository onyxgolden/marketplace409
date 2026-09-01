import { describe, expect, it } from "vitest";
import {
  MalformedScreenshotManifestEntryError, SCREENSHOT_MANIFEST_SCHEMA_VERSION,
  validateScreenshotManifest, validateScreenshotManifestEntry,
} from "../screenshotManifestContracts.mjs";

function validFullPageEntry(overrides = {}) {
  return {
    entryId: "entry_1", routeId: "home", routePath: "/", viewport: "desktop", kind: "full-page",
    componentName: null, environment: "local", commit: "e319c5e70abcdef0123456789abcdef01234567",
    capturedAt: "2026-09-01T12:00:00.000Z", browserVersion: "Chromium 130.0.6723.0",
    screenshotHash: `sha256:${"a".repeat(64)}`,
    readinessEvidence: [{ type: "fonts", description: "document.fonts.ready", satisfied: true, waitedMs: 12 }],
    redaction: { verified: true, rulesApplied: [] }, authMode: "none",
    ...overrides,
  };
}

describe("validateScreenshotManifestEntry", () => {
  it("accepts a valid full-page entry", () => {
    const entry = validateScreenshotManifestEntry(validFullPageEntry());
    expect(entry.routeId).toBe("home");
    expect(entry.kind).toBe("full-page");
    expect(entry.componentName).toBeNull();
  });

  it("accepts a valid component entry", () => {
    const entry = validateScreenshotManifestEntry(validFullPageEntry({ kind: "component", componentName: "account-balances-tree" }));
    expect(entry.componentName).toBe("account-balances-tree");
  });

  it("rejects a component entry with no componentName", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ kind: "component", componentName: null })))
      .toThrow(/componentName is required/);
  });

  it("rejects a full-page entry that supplies a componentName", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ componentName: "should-not-be-here" })))
      .toThrow(/must be null\/absent/);
  });

  it("rejects an unknown viewport name", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ viewport: "ultrawide" })))
      .toThrow(MalformedScreenshotManifestEntryError);
  });

  it("rejects a malformed screenshot hash", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ screenshotHash: "not-a-hash" })))
      .toThrow(/screenshotHash/);
  });

  it("rejects a non-commit-shaped commit value", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ commit: "not-a-sha" })))
      .toThrow(/commit must look like/);
  });

  it("rejects an invalid capturedAt timestamp", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ capturedAt: "not-a-date" })))
      .toThrow(/capturedAt/);
  });

  it("rejects readiness evidence marked satisfied: false", () => {
    const entry = validFullPageEntry({ readinessEvidence: [{ type: "fonts", description: "x", satisfied: false, waitedMs: 1 }] });
    expect(() => validateScreenshotManifestEntry(entry)).toThrow(/satisfied must be true/);
  });

  it("rejects an entry whose redaction was not verified", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ redaction: { verified: false, rulesApplied: [] } })))
      .toThrow(/redaction.verified must be true/);
  });

  it("rejects an unknown authMode", () => {
    expect(() => validateScreenshotManifestEntry(validFullPageEntry({ authMode: "password" })))
      .toThrow(/authMode/);
  });

  it("returns a frozen object", () => {
    const entry = validateScreenshotManifestEntry(validFullPageEntry());
    expect(() => { entry.routeId = "hacked"; }).toThrow();
  });
});

describe("validateScreenshotManifest", () => {
  it("accepts an empty entries array", () => {
    const manifest = validateScreenshotManifest({ schemaVersion: SCREENSHOT_MANIFEST_SCHEMA_VERSION, entries: [] });
    expect(manifest.entries).toEqual([]);
  });

  it("rejects the wrong schema version", () => {
    expect(() => validateScreenshotManifest({ schemaVersion: "0.9", entries: [] })).toThrow(/schemaVersion/);
  });

  it("is deterministic: the same entries in a different insertion order sort identically", () => {
    const a = validFullPageEntry({ entryId: "a", routeId: "zzz-route" });
    const b = validFullPageEntry({ entryId: "b", routeId: "aaa-route" });
    const manifestOne = validateScreenshotManifest({ schemaVersion: SCREENSHOT_MANIFEST_SCHEMA_VERSION, entries: [a, b] });
    const manifestTwo = validateScreenshotManifest({ schemaVersion: SCREENSHOT_MANIFEST_SCHEMA_VERSION, entries: [b, a] });
    expect(manifestOne.entries.map((e) => e.entryId)).toEqual(manifestTwo.entries.map((e) => e.entryId));
    expect(manifestOne.entries[0].routeId).toBe("aaa-route");
  });

  it("propagates a per-entry validation failure for the whole manifest", () => {
    expect(() => validateScreenshotManifest({ schemaVersion: SCREENSHOT_MANIFEST_SCHEMA_VERSION, entries: [{}] }))
      .toThrow(MalformedScreenshotManifestEntryError);
  });
});
