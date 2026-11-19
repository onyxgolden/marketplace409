// Health dashboard browser check — P1-A TypeError + P1-B #418 evidence.
//
// Usage: node scripts/health-dashboard-browser-check.mjs [--port 3102] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server), renders
// the real HealthDashboard at /phone-fixture?case=health-dashboard via real
// Chromium (Playwright) — the fixture seeds a pre-#833 persisted snapshot
// (every collection except `documents`) into the in-memory SWR cache, the exact
// shape that crashed production with
// `Cannot read properties of undefined (reading 'filter')` — and verifies, at
// desktop width (1280px) and Jason's phone width (390px):
//   - the dashboard renders its content (no error boundary, no
//     "This page couldn't load")
//   - zero page errors and zero console errors (no TypeError, no React #418
//     hydration warning)
//   - no page-level horizontal overflow
//
// Exits non-zero on any failure, and prints a one-line summary either way.
// No Supabase network call happens on render (the seeded entry is fresh, so
// the hook does not refetch); the dev server gets the same fake Supabase env
// vars as the manual-entry phone check, so nothing real is ever contacted.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}
const port = Number(argValue("--port", "3102"));
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture?case=health-dashboard`;
const WIDTHS = [1280, 390];

async function waitForServer(timeoutMs = 180000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(BASE);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${port} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function checkWidth(browser, width) {
  const pageErrors = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 60000 });
    // The dashboard renders the seeded profile + lab once the snapshot is served.
    await page.waitForSelector("text=jasonmorgan99@gmail.com", { timeout: 60000 });
    await page.waitForTimeout(1500); // let hydration + any late effects settle
    const bodyText = await page.evaluate(() => document.body.innerText);
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        innerWidth: window.innerWidth,
        scrollWidth: doc.scrollWidth,
        pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      };
    });
    const failures = [];
    if (bodyText.includes("This page couldn't load") || bodyText.includes("couldn't load")) {
      failures.push("error boundary shown ('couldn't load')");
    }
    if (!bodyText.includes("LDL cholesterol")) failures.push("seeded lab marker 'LDL cholesterol' not rendered");
    if (pageErrors.length) failures.push(`page error(s): ${JSON.stringify(pageErrors)}`);
    const hydrationWarnings = consoleErrors.filter((t) => /hydrat/i.test(t) || /418/.test(t));
    if (hydrationWarnings.length) failures.push(`hydration warning(s): ${JSON.stringify(hydrationWarnings)}`);
    const typeErrors = consoleErrors.filter((t) => /TypeError|Cannot read properties/.test(t));
    if (typeErrors.length) failures.push(`TypeError(s): ${JSON.stringify(typeErrors)}`);
    if (metrics.pageOverflow) failures.push(`page overflow at ${width}px (scrollWidth=${metrics.scrollWidth})`);
    return { width, metrics, pageErrors, consoleErrors, failures };
  } finally {
    await context.close();
  }
}

async function main() {
  let server = null;
  if (!keepServer) {
    server = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: true,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://test-fixture-only.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-fixture-publishable-key-not-real" },
    });
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    await waitForServer();
  }
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const width of WIDTHS) {
      results.push(await checkWidth(browser, width));
    }
    console.log(JSON.stringify(results, null, 2));
    const failures = results.flatMap((r) => r.failures.map((f) => `${r.width}px: ${f}`));
    if (failures.length) {
      console.error(`FAIL: ${failures.length} issue(s):\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("PASS: HealthDashboard renders the pre-#833 snapshot with no error boundary, no page/console errors, and no overflow at 1280px and 390px");
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
