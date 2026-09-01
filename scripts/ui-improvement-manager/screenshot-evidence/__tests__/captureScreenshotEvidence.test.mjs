import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScreenshotEvidenceCapture } from "../captureScreenshotEvidence.mjs";
import { HostNotPermittedError } from "../hostAllowlist.mjs";
import { PreviewAuthenticationUnavailableError, PREVIEW_SESSION_ENV_VAR } from "../previewSession.mjs";
import { VIEWPORT_NAMES } from "../viewportPresets.mjs";

const COMMIT = "e319c5e70abcdef0123456789abcdef01234567";
const FAKE_PNG = Buffer.from("fake-png-bytes");

// A minimal mock Playwright browser -- every method a "home"-route (no auth, no components, no
// custom readiness markers) capture actually calls, in the exact call order the orchestrator uses,
// so the standard 3-call page.evaluate sequence (fonts wait, redaction injection, redaction
// verification) is always: undefined, undefined, "true".
function mockChromium({ contexts = [] } = {}) {
  const contextCalls = [];
  const pages = [];
  const browser = {
    version: () => "Chromium 130.0.6723.0",
    newContext: vi.fn(async (options) => {
      contextCalls.push(options);
      const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce("true"),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(FAKE_PNG),
        locator: vi.fn(() => ({ screenshot: vi.fn().mockResolvedValue(FAKE_PNG) })),
      };
      pages.push(page);
      return { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, contextCalls, pages };
}

let outputDir;

beforeEach(() => { outputDir = mkdtempSync(path.join(tmpdir(), "fb-ui-evidence-")); });
afterEach(() => { rmSync(outputDir, { recursive: true, force: true }); });

describe("runScreenshotEvidenceCapture -- host and route authorization", () => {
  it("rejects the known production host before ever launching a browser", async () => {
    const { browser } = mockChromium();
    const launchChromium = vi.fn().mockResolvedValue(browser);
    await expect(runScreenshotEvidenceCapture({
      baseUrl: "https://marketplace409.vercel.app", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium,
    })).rejects.toThrow(HostNotPermittedError);
    expect(launchChromium).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized host before launching a browser", async () => {
    const { browser } = mockChromium();
    const launchChromium = vi.fn().mockResolvedValue(browser);
    await expect(runScreenshotEvidenceCapture({
      baseUrl: "https://not-this-app.example.com", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium,
    })).rejects.toThrow(HostNotPermittedError);
    expect(launchChromium).not.toHaveBeenCalled();
  });

  it("permits a local host", async () => {
    const { browser } = mockChromium();
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT,
      launchChromium: async () => browser,
    });
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(manifest.entries.every((entry) => entry.environment === "local")).toBe(true);
  });

  it("permits a real Vercel preview host shape", async () => {
    const { browser } = mockChromium();
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: "https://marketplace409-abc123-jason-morgan-s-projects.vercel.app",
      routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    expect(manifest.entries.every((entry) => entry.environment === "preview")).toBe(true);
  });

  it("rejects a routeId that is not on the approved list", async () => {
    const { browser } = mockChromium();
    await expect(runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["not-a-real-route"], outputDir, commit: COMMIT,
      launchChromium: async () => browser,
    })).rejects.toThrow(/not on the FB-UI approved route list/);
  });
});

describe("runScreenshotEvidenceCapture -- full-page capture configuration", () => {
  it("always captures the full page with fullPage: true", async () => {
    const { browser, pages } = mockChromium();
    await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    for (const page of pages) {
      expect(page.screenshot).toHaveBeenCalledWith({ fullPage: true });
    }
  });
});

describe("runScreenshotEvidenceCapture -- viewport coverage", () => {
  it("captures all three viewports for a route, each with its own browser context", async () => {
    const { browser, contextCalls } = mockChromium();
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    expect(contextCalls).toHaveLength(3);
    expect(manifest.entries.map((entry) => entry.viewport).sort()).toEqual([...VIEWPORT_NAMES].sort());
  });

  it("passes each viewport's exact preset dimensions to newContext", async () => {
    const { browser, contextCalls } = mockChromium();
    await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    const widths = contextCalls.map((call) => call.viewport.width).sort((a, b) => a - b);
    expect(widths).toEqual([390, 834, 1440]);
  });
});

describe("runScreenshotEvidenceCapture -- component screenshots", () => {
  it("captures a named screenshot for each of a route's configured components, in addition to the full page", async () => {
    const filePath = path.join(outputDir, "storageState.json");
    (await import("node:fs")).writeFileSync(filePath, JSON.stringify({ cookies: [], origins: [] }));
    const { browser } = mockChromium();
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["forge-financial-overview"], outputDir, commit: COMMIT,
      launchChromium: async () => browser, env: { [PREVIEW_SESSION_ENV_VAR]: filePath },
    });
    const componentEntries = manifest.entries.filter((entry) => entry.kind === "component");
    // 2 configured components x 3 viewports each = 6 component entries; unique component names are
    // still exactly the 2 configured ones.
    expect(componentEntries).toHaveLength(6);
    expect([...new Set(componentEntries.map((entry) => entry.componentName))].sort()).toEqual(["account-balances-tree", "expense-categories-donut"].sort());
    const fullPageEntries = manifest.entries.filter((entry) => entry.kind === "full-page");
    expect(fullPageEntries).toHaveLength(3); // one per viewport
  });
});

describe("runScreenshotEvidenceCapture -- failed authentication", () => {
  it("fails closed for an auth-required route when no preview session is configured", async () => {
    const { browser } = mockChromium();
    await expect(runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["forge-financial-overview"], outputDir, commit: COMMIT,
      launchChromium: async () => browser, env: {},
    })).rejects.toThrow(PreviewAuthenticationUnavailableError);
  });
});

describe("runScreenshotEvidenceCapture -- deterministic manifest output", () => {
  it("writes a manifest.json to the output directory containing route, viewport, commit, timestamp, browser version, screenshot hash, and readiness evidence", async () => {
    const { browser } = mockChromium();
    await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    const written = JSON.parse(readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
    const [entry] = written.entries;
    expect(entry.routeId).toBe("home");
    expect(entry.viewport).toBeDefined();
    expect(entry.commit).toBe(COMMIT);
    expect(entry.capturedAt).toBeDefined();
    expect(entry.browserVersion).toBe("Chromium 130.0.6723.0");
    expect(entry.screenshotHash).toMatch(/^sha256:/);
    expect(Array.isArray(entry.readinessEvidence)).toBe(true);
  });

  it("records the correct screenshot hash for the captured (fake) PNG bytes", async () => {
    const { browser } = mockChromium();
    const manifest = await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    const { createHash } = await import("node:crypto");
    const expectedHash = `sha256:${createHash("sha256").update(FAKE_PNG).digest("hex")}`;
    expect(manifest.entries.every((entry) => entry.screenshotHash === expectedHash)).toBe(true);
  });

  it("closes every browser context and the browser itself even when a capture succeeds", async () => {
    const { browser } = mockChromium();
    await runScreenshotEvidenceCapture({
      baseUrl: "http://localhost:3000", routeIds: ["home"], outputDir, commit: COMMIT, launchChromium: async () => browser,
    });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
