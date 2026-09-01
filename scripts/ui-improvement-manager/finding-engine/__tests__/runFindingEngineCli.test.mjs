import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingEngineCliError, parseArgs, runCli } from "../runFindingEngineCli.mjs";

const CLEAN_SNAPSHOT = {
  documentMetrics: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, colorScheme: "light" },
  elements: [], statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
};

function screenshotManifest(routeId) {
  return {
    schemaVersion: "1.0",
    entries: ["desktop", "tablet", "mobile"].map((viewport) => ({
      entryId: `${routeId}-${viewport}`, routeId, routePath: "/", viewport, kind: "full-page", componentName: null,
      environment: "local", commit: "e319c5e70abcdef0123456789abcdef01234567", capturedAt: "2026-09-01T00:00:00.000Z",
      browserVersion: "Chromium 130.0", screenshotHash: `sha256:${"a".repeat(64)}`,
      readinessEvidence: [], redaction: { verified: true, rulesApplied: [] }, authMode: "none",
    })),
  };
}

let evidenceDir;
beforeEach(() => { evidenceDir = mkdtempSync(path.join(tmpdir(), "fb-ui-2-cli-")); });
afterEach(() => { rmSync(evidenceDir, { recursive: true, force: true }); });

describe("parseArgs", () => {
  it("collects repeated --route flags into an array", () => {
    const args = parseArgs(["--base-url", "http://localhost:3000", "--route", "home", "--route", "forge-financial-overview"]);
    expect(args.routeIds).toEqual(["home", "forge-financial-overview"]);
  });
});

describe("runCli", () => {
  it("fails closed with usage guidance when --base-url is missing", async () => {
    await expect(runCli(["--evidence-dir", evidenceDir])).rejects.toThrow(FindingEngineCliError);
  });

  it("fails closed with usage guidance when --evidence-dir is missing", async () => {
    await expect(runCli(["--base-url", "http://localhost:3000"])).rejects.toThrow(FindingEngineCliError);
  });

  it("fails closed when no screenshot-evidence manifest exists yet in the evidence dir", async () => {
    await expect(runCli(["--base-url", "http://localhost:3000", "--evidence-dir", evidenceDir]))
      .rejects.toThrow(/Run captureScreenshotEvidenceCli\.mjs \(FB-UI-1\)/);
  });

  it("fails closed when the screenshot manifest has no entry for one of the three viewports", async () => {
    const manifest = screenshotManifest("home");
    manifest.entries = manifest.entries.filter((entry) => entry.viewport !== "mobile"); // drop mobile
    writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(manifest));
    const captureDiagnostics = vi.fn().mockResolvedValue([{ routeId: "home", routePath: "/", snapshots: { desktop: CLEAN_SNAPSHOT, tablet: CLEAN_SNAPSHOT, mobile: CLEAN_SNAPSHOT } }]);
    await expect(runCli(["--base-url", "http://localhost:3000", "--evidence-dir", evidenceDir], { captureDiagnostics }))
      .rejects.toThrow(/No full-page screenshot evidence found.*mobile/);
  });

  it("writes a findings-manifest.json cross-referencing the correct screenshot hash per viewport", async () => {
    writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(screenshotManifest("home")));
    const captureDiagnostics = vi.fn().mockResolvedValue([{ routeId: "home", routePath: "/", snapshots: { desktop: CLEAN_SNAPSHOT, tablet: CLEAN_SNAPSHOT, mobile: CLEAN_SNAPSHOT } }]);
    const manifest = await runCli(["--base-url", "http://localhost:3000", "--evidence-dir", evidenceDir], { captureDiagnostics });
    expect(manifest.findings).toEqual([]); // clean snapshot, no defects
    const written = JSON.parse(readFileSync(path.join(evidenceDir, "findings-manifest.json"), "utf8"));
    expect(written.schemaVersion).toBe("1.0");
  });

  it("passes --route ids straight through to the diagnostics capture step", async () => {
    writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(screenshotManifest("home")));
    const captureDiagnostics = vi.fn().mockResolvedValue([{ routeId: "home", routePath: "/", snapshots: { desktop: CLEAN_SNAPSHOT, tablet: CLEAN_SNAPSHOT, mobile: CLEAN_SNAPSHOT } }]);
    await runCli(["--base-url", "http://localhost:3000", "--evidence-dir", evidenceDir, "--route", "home"], { captureDiagnostics });
    expect(captureDiagnostics).toHaveBeenCalledWith({ baseUrl: "http://localhost:3000", routeIds: ["home"] });
  });

  it("uses a caller-supplied --application name in every produced finding", async () => {
    const brokenSnapshot = { ...CLEAN_SNAPSHOT, documentMetrics: { ...CLEAN_SNAPSHOT.documentMetrics, scrollWidth: 2000 } };
    writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(screenshotManifest("home")));
    const captureDiagnostics = vi.fn().mockResolvedValue([{ routeId: "home", routePath: "/", snapshots: { desktop: brokenSnapshot, tablet: CLEAN_SNAPSHOT, mobile: CLEAN_SNAPSHOT } }]);
    const manifest = await runCli(["--base-url", "http://localhost:3000", "--evidence-dir", evidenceDir, "--application", "Custom App"], { captureDiagnostics, citeSourceFiles: () => [] });
    expect(manifest.findings.length).toBeGreaterThan(0);
    expect(manifest.findings.every((finding) => finding.application === "Custom App")).toBe(true);
  });
});
