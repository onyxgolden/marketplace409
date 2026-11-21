// Health Labs importer manual-entry build — phone-width geometry check.
//
// Usage: node scripts/health-labs-manual-entry-phone-check.mjs [--port 3101] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server, which
// assumes one is already running on --port), renders the real
// HealthLabManualEntryForm + HealthSourceDocumentCard at /phone-fixture?case=health
// via real Chromium (Playwright), at Jason's phone width (390px, matching the
// Phone Slice 5 geometry check's own widths), and measures:
//   - no page-level horizontal overflow (documentElement.scrollWidth <=
//     innerWidth + 1)
//   - every button/input/select in the manual-entry form and the two
//     fixture source-document cards fully inside the viewport
//   - the same two checks again after clicking "Review before saving" --
//     a pure client-side state transition, no network call, so this
//     fixture never needs to intercept or fake a Supabase request
//
// Exits non-zero on any failure, and prints a one-line summary either way.
// This script is new and scoped to this build only -- it does not modify
// scripts/phone-layout-geometry-check.mjs (the separate Phone Slice 5
// geometry harness, actively worked on elsewhere), only the shared
// /phone-fixture route, which is designed to be extended with new cases.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createProgress } from "./check-progress.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}
const port = Number(argValue("--port", "3101"));
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture`;
const WIDTH = 390;

// Progress heartbeat (FORGE-P-20261119-MUSE-LONG-RUN-PROGRESS-HEARTBEAT):
// this script takes ~10 minutes, almost all of it dev-server compile,
// and used to print nothing until it finished — twice killed as "hung"
// while actually passing. Phase-transition lines only, no fake
// percentages; the stated window is measured, never guessed. The
// heartbeat never changes the 120s waitForServer timeout below and
// never grants unlimited runtime — silent past the window is killable.
const progress = createProgress({
  script: "health-labs-manual-entry-phone-check",
  expected: "~10 min",
  measured: "prior runs Nov 18, 2026, ~10 min in this VM; 42s Nov 20, 2026 — compile time varies with VM load, so the window states the slow case",
});

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}?case=health`);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${port} within ${timeoutMs}ms`);
    progress.heartbeat("waiting for dev server");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const interactive = [...document.querySelectorAll('[data-testid="health-fixture"] button, [data-testid="health-fixture"] input, [data-testid="health-fixture"] select')];
    const outside = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).map((el) => ({ tag: el.tagName, label: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 40) || null }));
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      interactiveCount: interactive.length,
      outsideViewport: outside,
    };
  });
}

async function main() {
  progress.start();
  let server = null;
  let readyPhaseEmitted = false;
  if (!keepServer) {
    progress.phase("dev server starting");
    // shell: true -- on Windows, npm resolves to npm.cmd, which spawn() cannot
    // exec directly without a shell. SWRIdentityBridge (a root-level provider
    // every page renders, not anything this build added) constructs a
    // Supabase client unconditionally on mount, which throws and 500s the
    // whole page without these two env vars set to SOME non-empty value --
    // createBrowserClient only checks presence at construction time, and
    // this fixture never issues a real Supabase request (neither the
    // manual-entry form nor the document cards call Supabase until a
    // save/delete click, which this script never performs), so a clearly
    // fake value is enough and nothing real is ever contacted.
    server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: true,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://test-fixture-only.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-fixture-publishable-key-not-real" },
    });
    // Watch the dev server's own output for real phase transitions: Next
    // prints "Ready" when it accepts connections and "Compiling" when the
    // first request compiles the fixture route. Only the phase names are
    // reported — server output itself is never echoed (it carries paths).
    let compilingPhaseEmitted = false;
    let buffer = "";
    const scanServerOutput = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!compilingPhaseEmitted && /Compiling/.test(line)) {
          compilingPhaseEmitted = true;
          progress.phase("compiling fixture route");
        }
        if (!readyPhaseEmitted && /Ready in/.test(line)) {
          readyPhaseEmitted = true;
          progress.phase("dev server accepting connections");
        }
      }
    };
    server.stdout.on("data", scanServerOutput);
    server.stderr.on("data", scanServerOutput);
    await waitForServer();
    if (!readyPhaseEmitted) {
      readyPhaseEmitted = true;
      progress.phase("dev server ready");
    }
  } else {
    progress.phase("using existing dev server");
    await waitForServer();
    progress.phase("dev server ready");
  }
  progress.phase("running checks");
  const browser = await chromium.launch();
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 } });
    await page.goto(`${BASE}?case=health`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');

    const before = await measure(page);
    if (before.pageOverflow) failures.push(`edit state: page overflow at ${WIDTH}px (scrollWidth=${before.scrollWidth})`);
    if (before.outsideViewport.length) failures.push(`edit state: ${before.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(before.outsideViewport)}`);
    if (before.interactiveCount < 5) failures.push(`edit state: suspiciously few interactive controls found (${before.interactiveCount}) -- fixture may not have rendered`);

    // Fill one row and advance to the review step -- pure client state, no network call.
    await page.fill('[aria-label="Marker 1"]', "Vitamin D, 25-OH");
    await page.fill('[aria-label="Value 1"]', "42");
    await page.getByRole("button", { name: "Review before saving" }).click();
    await page.waitForSelector("text=Review before saving");

    const afterReview = await measure(page);
    if (afterReview.pageOverflow) failures.push(`review state: page overflow at ${WIDTH}px (scrollWidth=${afterReview.scrollWidth})`);
    if (afterReview.outsideViewport.length) failures.push(`review state: ${afterReview.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(afterReview.outsideViewport)}`);

    const result = { width: WIDTH, before, afterReview, failures };
    console.log(JSON.stringify(result, null, 2));
    if (failures.length) {
      console.error(`FAIL: ${failures.length} phone-width issue(s) at ${WIDTH}px`);
      process.exitCode = 1;
      progress.done("FAIL", { exitCode: 1 });
    } else {
      console.log(`PASS: no overflow, no out-of-viewport controls at ${WIDTH}px (edit state and review state)`);
      progress.done("PASS", { exitCode: 0 });
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  progress.done("ERROR", { exitCode: 1 });
  process.exitCode = 1;
});
