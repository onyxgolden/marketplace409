import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureDiagnosticsForPage, runDiagnosticsEvidenceCapture } from "../captureDiagnosticsEvidence.mjs";
import { HostNotPermittedError } from "../../screenshot-evidence/hostAllowlist.mjs";
import { PreviewAuthenticationUnavailableError, PREVIEW_SESSION_ENV_VAR } from "../../screenshot-evidence/previewSession.mjs";

const RAW_SNAPSHOT = {
  documentMetrics: { scrollWidth: 390, clientWidth: 390, scrollHeight: 800, clientHeight: 800, colorScheme: "light" },
  elements: [], statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
};

function mockChromium() {
  const contextCalls = [];
  const browser = {
    newContext: vi.fn(async (options) => {
      contextCalls.push(options);
      const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
          .mockResolvedValueOnce(undefined) // fonts wait
          .mockResolvedValueOnce(undefined) // redaction injection
          .mockResolvedValueOnce("true") // redaction verification
          .mockResolvedValueOnce(RAW_SNAPSHOT), // diagnostics capture
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
      };
      return { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, contextCalls };
}

describe("captureDiagnosticsForPage", () => {
  it("evaluates the diagnostics script and returns a validated snapshot", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(RAW_SNAPSHOT) };
    const snapshot = await captureDiagnosticsForPage(page);
    expect(snapshot.documentMetrics.colorScheme).toBe("light");
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining("documentMetrics"));
  });
});

let outputDir;
beforeEach(() => { outputDir = mkdtempSync(path.join(tmpdir(), "fb-ui-2-diag-")); });
afterEach(() => { rmSync(outputDir, { recursive: true, force: true }); });

describe("runDiagnosticsEvidenceCapture", () => {
  it("rejects the production host before launching a browser", async () => {
    const { browser } = mockChromium();
    const launchChromium = vi.fn().mockResolvedValue(browser);
    await expect(runDiagnosticsEvidenceCapture({ baseUrl: "https://marketplace409.vercel.app", routeIds: ["home"], launchChromium }))
      .rejects.toThrow(HostNotPermittedError);
    expect(launchChromium).not.toHaveBeenCalled();
  });

  it("captures a diagnostics snapshot for every viewport of a public route", async () => {
    const { browser } = mockChromium();
    const results = await runDiagnosticsEvidenceCapture({ baseUrl: "http://localhost:3000", routeIds: ["home"], launchChromium: async () => browser });
    expect(results).toHaveLength(1);
    expect(Object.keys(results[0].snapshots).sort()).toEqual(["desktop", "mobile", "tablet"]);
    expect(results[0].snapshots.desktop.documentMetrics.colorScheme).toBe("light");
  });

  it("fails closed for an auth-required route with no configured preview session", async () => {
    const { browser } = mockChromium();
    await expect(runDiagnosticsEvidenceCapture({ baseUrl: "http://localhost:3000", routeIds: ["forge-financial-overview"], launchChromium: async () => browser, env: {} }))
      .rejects.toThrow(PreviewAuthenticationUnavailableError);
  });

  it("uses the configured preview session for an auth-required route", async () => {
    const filePath = path.join(outputDir, "storageState.json");
    writeFileSync(filePath, JSON.stringify({ cookies: [], origins: [] }));
    const { browser, contextCalls } = mockChromium();
    const results = await runDiagnosticsEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["forge-financial-overview"], launchChromium: async () => browser,
      env: { [PREVIEW_SESSION_ENV_VAR]: filePath },
    });
    expect(results).toHaveLength(1);
    expect(contextCalls.every((call) => call.storageState === filePath)).toBe(true);
  });

  it("closes the browser even after a successful run", async () => {
    const { browser } = mockChromium();
    await runDiagnosticsEvidenceCapture({ baseUrl: "http://localhost:3000", routeIds: ["home"], launchChromium: async () => browser });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
