// Rental Manager Summary per-property performance section — phone-width check.
//
// Usage: node scripts/rental-property-performance-phone-check.mjs [--port 3102] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server, which
// assumes one is already running on --port), renders the real
// RentalPropertyPerformancePanel at /phone-fixture?case=rental-performance via
// real Chromium (Playwright), at 390px and 400px, and measures:
//   - no page-level horizontal overflow (documentElement.scrollWidth <=
//     innerWidth + 1)
//   - every button/link in the fixture fully inside the viewport
//   - the same two checks again after expanding "Expenses by category" on
//     the first property card and after switching the expenses period to
//     "Month to date" — pure client-side state transitions, no network call,
//     so this fixture never needs to intercept or fake a Supabase request
//
// The fixture carries a very long property label and large amounts
// ($1,234,567.89 income, $112,500.00 capital improvement), so the check
// proves the stacked cards, the expense detail, and the totals never clip
// at phone width.
//
// Exits non-zero on any failure, and prints a one-line summary either way.
// This script is new and scoped to this build only — it does not modify
// scripts/phone-layout-geometry-check.mjs (the separate Phone Slice 5
// geometry harness), only the shared /phone-fixture route, which is designed
// to be extended with new cases.
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
const port = Number(argValue("--port", "3102"));
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture`;
const WIDTHS = [390, 400];

// Progress heartbeat (FORGE-P-20261119-MUSE-LONG-RUN-PROGRESS-HEARTBEAT):
// this script takes ~10 minutes cold, almost all of it dev-server
// compile, and used to print nothing until it finished. Phase-transition
// lines only, no fake percentages; the stated window is measured, never
// guessed. The heartbeat never changes the 120s waitForServer timeout
// below and never grants unlimited runtime. The wait-phase timer
// (startWaitHeartbeat) keeps a heartbeat landing at each 60s boundary
// while the first fixture fetch is still pending in a cold compile; it
// only prints, never resets or extends the timeout.
const progress = createProgress({
  script: "rental-property-performance-phone-check",
  expected: "~10 min",
  measured: "cold runs Nov 20, 2026: 10m10s and 36s in this VM — compile time varies with VM load, so the window states the slow case",
});

async function waitForServer(timeoutMs = 120000) {
  // The timer fires independently of the fetch below: while the first
  // fixture request is pending in a cold compile, the loop is suspended
  // inside await fetch(...) and no loop heartbeat can run. The finally
  // clears the timer on success, failure, and timeout alike.
  progress.startWaitHeartbeat("waiting for dev server");
  try {
    const start = Date.now();
    for (;;) {
      try {
        const res = await fetch(`${BASE}?case=rental-performance`);
        if (res.ok || res.status === 404) return;
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${port} within ${timeoutMs}ms`);
      progress.heartbeat("waiting for dev server");
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    progress.stopWaitHeartbeat();
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const interactive = [...document.querySelectorAll('[data-testid="rental-performance-fixture"] button, [data-testid="rental-performance-fixture"] a')];
    const outside = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).map((el) => ({ tag: el.tagName, label: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 40) || null }));
    const section = document.querySelector('[data-rental-property-performance]');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      interactiveCount: interactive.length,
      outsideViewport: outside,
      sectionRendered: Boolean(section),
    };
  });
}

async function checkWidth(browser, width) {
  const failures = [];
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.goto(`${BASE}?case=rental-performance`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-rental-property-performance]');

    const initial = await measure(page);
    if (!initial.sectionRendered) failures.push(`${width}px: property performance section did not render`);
    if (initial.pageOverflow) failures.push(`${width}px: page overflow (scrollWidth=${initial.scrollWidth})`);
    if (initial.outsideViewport.length) failures.push(`${width}px: ${initial.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(initial.outsideViewport)}`);
    if (initial.interactiveCount < 5) failures.push(`${width}px: suspiciously few interactive controls found (${initial.interactiveCount}) -- fixture may not have rendered`);

    // Expand the expense detail on the first property card — pure client state.
    // The panel renders the same detail twice in the DOM (desktop table +
    // mobile cards, one hidden at phone width via sm:hidden / hidden sm:block),
    // and expanding one expands both (shared state) — so a plain text
    // selector resolves to the hidden table copy first and never becomes
    // visible. Scope the wait to a VISIBLE <p> so it tracks the card copy.
    await page.getByRole("button", { name: "Expenses by category" }).first().click();
    await page.locator('p:text("Expenses by category — All time (since 2014)"):visible').first().waitFor({ state: "visible" });
    const expanded = await measure(page);
    if (expanded.pageOverflow) failures.push(`${width}px expanded: page overflow (scrollWidth=${expanded.scrollWidth})`);
    if (expanded.outsideViewport.length) failures.push(`${width}px expanded: ${expanded.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(expanded.outsideViewport)}`);

    // Switch the expenses period — pure client state (same visible-copy rule).
    await page.getByRole("button", { name: "Month to date", exact: true }).click();
    await page.locator('p:text("Expenses by category — Month to date"):visible').first().waitFor({ state: "visible" });
    const switched = await measure(page);
    if (switched.pageOverflow) failures.push(`${width}px period-switched: page overflow (scrollWidth=${switched.scrollWidth})`);
    if (switched.outsideViewport.length) failures.push(`${width}px period-switched: ${switched.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(switched.outsideViewport)}`);

    return { width, initial, expanded, switched, failures };
  } finally {
    await page.close();
  }
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
    // this fixture never issues a real Supabase request (the panel takes its
    // read model as a prop), so a clearly fake value is enough and nothing
    // real is ever contacted.
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
  const results = [];
  try {
    for (const width of WIDTHS) {
      progress.phase(`checking ${width}px`);
      const result = await checkWidth(browser, width);
      results.push(result);
      failures.push(...result.failures);
    }
    console.log(JSON.stringify(results, null, 2));
    if (failures.length) {
      console.error(`FAIL: ${failures.length} phone-width issue(s) at 390/400px`);
      process.exitCode = 1;
      progress.done("FAIL", { exitCode: 1 });
    } else {
      console.log("PASS: no overflow, no out-of-viewport controls at 390px and 400px (initial, expanded, and period-switched states)");
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
