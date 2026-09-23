// Tests for src/lib/capture/downloads.js — download page manifest and
// versioned redirect resolution. Pure logic; no network.
import { describe, expect, it } from "vitest";

import {
  CAPTURE_DOWNLOAD_MANIFEST,
  LATEST_CAPTURE_VERSION,
  getCaptureRelease,
  getCaptureReleases,
  resolveCaptureDownloadUrl,
} from "./downloads";

describe("capture download manifest", () => {
  it("has a latest version that resolves to a real release entry", () => {
    expect(getCaptureRelease(LATEST_CAPTURE_VERSION)).not.toBeNull();
    expect(getCaptureReleases().length).toBeGreaterThan(0);
  });

  it("points every published asset at the GitHub releases download path", () => {
    for (const release of getCaptureReleases()) {
      for (const asset of release.assets) {
        if (asset.url === null) continue; // unpublished: coming soon
        expect(asset.url).toMatch(
          /^https:\/\/github\.com\/onyxgolden\/marketplace409\/releases\/download\//,
        );
      }
    }
  });

  it("leaves the Windows installer unpublished for v0.2.0 (no binary yet)", () => {
    const release = getCaptureRelease("v0.2.0");
    const windows = release.assets.find((a) => a.platform === "windows");
    expect(windows).toBeDefined();
    expect(windows.url).toBeNull();
  });

  it("trims whitespace on the version lookup", () => {
    expect(getCaptureRelease("  v0.2.0  ")).not.toBeNull();
  });
});

describe("resolveCaptureDownloadUrl", () => {
  it("resolves the published Linux .deb", () => {
    expect(
      resolveCaptureDownloadUrl({
        version: "v0.2.0",
        filename: "FORGE Capture_0.2.0_amd64.deb",
      }),
    ).toBe(
      "https://github.com/onyxgolden/marketplace409/releases/download/forge-capture-v0.2.0/FORGE%20Capture_0.2.0_amd64.deb",
    );
  });

  it("resolves the published Linux AppImage", () => {
    expect(
      resolveCaptureDownloadUrl({
        version: "v0.2.0",
        filename: "FORGE Capture_0.2.0_amd64.AppImage",
      }),
    ).toContain("forge-capture-v0.2.0/FORGE%20Capture_0.2.0_amd64.AppImage");
  });

  it("returns null for the unpublished Windows installer (never a dead link)", () => {
    expect(
      resolveCaptureDownloadUrl({
        version: "v0.2.0",
        filename: "FORGE-Capture_0.2.0_x64-setup.exe",
      }),
    ).toBeNull();
  });

  it("returns null for an unknown version", () => {
    expect(
      resolveCaptureDownloadUrl({
        version: "v9.9.9",
        filename: "FORGE Capture_0.2.0_amd64.deb",
      }),
    ).toBeNull();
  });

  it("returns null for an unknown filename on a known version", () => {
    expect(
      resolveCaptureDownloadUrl({ version: "v0.2.0", filename: "malware.exe" }),
    ).toBeNull();
  });

  it("returns null for path traversal attempts", () => {
    expect(
      resolveCaptureDownloadUrl({
        version: "v0.2.0",
        filename: "../secret.txt",
      }),
    ).toBeNull();
    expect(
      resolveCaptureDownloadUrl({
        version: "v0.2.0",
        filename: "..%2F..%2Fetc%2Fpasswd",
      }),
    ).toBeNull();
    expect(
      resolveCaptureDownloadUrl({
        version: "../v0.2.0",
        filename: "FORGE Capture_0.2.0_amd64.deb",
      }),
    ).toBeNull();
  });

  it("returns null for empty inputs", () => {
    expect(resolveCaptureDownloadUrl({ version: "", filename: "" })).toBeNull();
    expect(
      resolveCaptureDownloadUrl({ version: null, filename: null }),
    ).toBeNull();
  });
});
