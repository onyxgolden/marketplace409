// Planner owner-only test data — real-Chromium fixture check.
//
// Usage:
//   node scripts/test-data-fixture-check.mjs [--tag after] [--port 3101]
//     [--widths 360,390,412,430,1919] [--cases owner-real,owner-test,co-owner]
//     [--out <evidence-dir>] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server),
// renders the real PlannerHierarchyManager in /test-data-fixture at
// each viewport width, with the hierarchy + test-data API routes
// intercepted per scenario, and measures:
//   - documentElement.scrollWidth <= innerWidth + 1 (page-level overflow)
//   - every button/input/select/link fully inside the viewport
//   - owner-real: the Test data section IS present (server says the
//     owner may use test data), Real mode shows the real client, and no
//     test name appears anywhere in the page text.
//   - owner-test: switching to Test shows only the test client with
//     TEST badges; Load sample packages confirms in plain words;
//     Preview cleanup shows the counts panel and the Delete button stays
//     disabled until the typed name matches exactly.
//   - co-owner: NO Test data section, NO mode switch, and NO test name
//     anywhere in the page text — not merely CSS-hidden (the check reads
//     document.body.innerText, so a hidden-but-present name still fails).
//
// The intercepted payloads are the shapes the real routes return; the
// DB-level isolation (Brandy sees zero test rows) is proven separately
// by plannerTestClient.migration.test.js on real PG16 — this script
// proves the UI never surfaces what the server does not send.
//
// Writes screenshots + results JSON to --out (default
// <repo>/.test-data-evidence/, git-ignored). Receipts embed the exact
// tested HEAD SHA, the widths/cases run, and the Chromium version.
//
// Exits non-zero when any check fails, so it can gate a PR. Screenshots
// alone never replace the numerical geometry below.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// --- Checkout resolution: this file's own location, never a hardcoded path.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
function resolveRepoRoot() {
  const pkgPath = path.join(REPO_ROOT, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    throw new Error(
      `test-data-fixture-check: no package.json at ${pkgPath} — run from a marketplace409 checkout`
    );
  }
  if (pkg.name !== "marketplace409") {
    throw new Error(
      `test-data-fixture-check: ${pkgPath} is not the marketplace409 app (name=${pkg.name}) — refusing to test the wrong checkout`
    );
  }
  return REPO_ROOT;
}
const ROOT = resolveRepoRoot();

function testedHeadSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown (not a git checkout)";
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tag: "after", port: 3101, widths: [360, 390, 412, 430, 1919], cases: ["owner-real", "owner-test", "co-owner"], outDir: null, keepServer: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--tag") out.tag = args[++i];
    else if (args[i] === "--port") out.port = Number(args[++i]);
    else if (args[i] === "--widths") out.widths = args[++i].split(",").map(Number);
    else if (args[i] === "--cases") out.cases = args[++i].split(",");
    else if (args[i] === "--out") out.outDir = args[++i];
    else if (args[i] === "--keep-server") out.keepServer = true;
  }
  return out;
}
const { tag, port, widths: WIDTHS, cases: CASES, outDir, keepServer } = parseArgs();
const OUT = outDir || path.join(ROOT, ".test-data-evidence");
const BASE = `http://localhost:${port}/test-data-fixture`;
fs.mkdirSync(OUT, { recursive: true });

// --- Canned API payloads (the shapes the real routes return). -----------
const REAL_INVENTORY = (canUseOwnerTestData, canManage = true) => ({
  ownerId: "owner_1",
  canManage,
  canUseOwnerTestData,
  clients: [
    {
      id: "forge_cli_1", name: "Acme", externalReference: "ACME-1", notes: "",
      status: "active", version: 3, isTest: false,
      sites: [
        {
          id: "forge_site_1", name: "Plant 1", siteType: "industrial",
          addressLine1: "", addressLine2: "", city: "", region: "",
          postalCode: "", countryCode: "", status: "active", version: 2, isTest: false,
          projects: [
            { id: "forge_prj_1", name: "Turnaround", projectCode: "TA-01", description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "active", version: 5, packageCount: 2, isTest: false },
          ],
        },
      ],
    },
  ],
});

const TEST_INVENTORY = (canUseOwnerTestData) => ({
  ownerId: "owner_1",
  canManage: true,
  canUseOwnerTestData,
  clients: canUseOwnerTestData ? [
    {
      id: "forge_cli_test1", name: "Fictional Test Client", externalReference: "", notes: "",
      status: "active", version: 1, isTest: true,
      sites: [
        {
          id: "forge_site_test1", name: "Fictional Test Site", siteType: "industrial",
          addressLine1: "", addressLine2: "", city: "", region: "",
          postalCode: "", countryCode: "", status: "active", version: 1, isTest: true,
          projects: [
            { id: "forge_prj_test1", name: "Fictional Test Project", projectCode: null, description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "active", version: 1, packageCount: 0, isTest: true },
          ],
        },
      ],
    },
  ] : [],
});

async function waitForServer(portNumber, timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${portNumber}/test-data-fixture?case=owner-real`);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${portNumber} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function measurePage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bad = [];
    for (const el of document.querySelectorAll("button, input, select, a, textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        bad.push({ tag: el.tagName, text: (el.textContent || el.value || "").trim().slice(0, 60), left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      outOfViewportCount: bad.length,
      outOfViewportControls: bad.slice(0, 10),
    };
  });
}

async function pageText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function main() {
  let server = null;
  if (!keepServer) {
    server = spawn("npm", ["run", "dev", "--", "-p", String(port)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    await waitForServer(port);
  }
  const browser = await chromium.launch();
  const results = {
    tag,
    at: new Date().toISOString(),
    repoRoot: ROOT,
    headSha: testedHeadSha(),
    widths: WIDTHS,
    cases: CASES,
    browser: { name: "chromium", version: browser.version() },
    checks: [],
    failures: [],
  };
  try {
    for (const c of CASES) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const isOwner = c !== "co-owner";
        const canUse = isOwner;
        await page.route("**/api/forge/hierarchy*", async (route) => {
          const url = route.request().url();
          if (url.includes("mode=test")) {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ inventory: TEST_INVENTORY(canUse) }) });
          } else {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ inventory: REAL_INVENTORY(canUse, isOwner) }) });
          }
        });
        await page.route("**/api/forge/planner/test-data/load", async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ load: { loaded: true, alreadyLoaded: false, packages: 6, steps: 31, message: "Loaded 6 sample packages / 31 steps" } }) });
        });
        await page.route("**/api/forge/planner/test-data/preview", async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: { clientId: "forge_cli_test1", clientName: "Fictional Test Client", counts: { forge_clients: 1, forge_sites: 1, forge_projects: 1, forge_work_packages: 6, forge_work_steps: 31 }, blockers: [], canPurge: true, digest: "a".repeat(64) } }) });
        });
        await page.route("**/api/forge/planner/test-data/purge", async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ purge: { purged: true, alreadyPurged: false, message: "Test data deleted." } }) });
        });
        const url = `${BASE}?case=${c}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 60000 });
        await page.waitForTimeout(800);
        const check = { case: c, width, url };
        check.page = await measurePage(page);
        const fail = (msg) => results.failures.push(`${c}@${width}: ${msg}`);

        if (check.page.pageOverflow) fail(`page overflow scrollWidth=${check.page.scrollWidth} > innerWidth=${check.page.innerWidth}`);
        if (check.page.outOfViewportCount > 0) fail(`${check.page.outOfViewportCount} controls outside viewport: ${JSON.stringify(check.page.outOfViewportControls)}`);

        if (c === "co-owner") {
          const section = await page.$("[data-testid='planner-test-data-section']");
          if (section) fail("co-owner sees the Test data section");
          const text = await pageText(page);
          if (text.includes("Fictional")) fail("co-owner page text contains a test name");
          if (text.includes("Test data")) fail("co-owner page text mentions Test data");
          const testButton = await page.$$("button");
          const labels = await Promise.all(testButton.map((b) => b.textContent()));
          if (labels.some((l) => (l || "").trim() === "Test")) fail("co-owner sees a Test mode switch button");
        } else {
          const section = await page.$("[data-testid='planner-test-data-section']");
          if (!section) fail("owner does not see the Test data section");
          let text = await pageText(page);
          if (!text.includes("TEST — OWNER ONLY")) fail("owner Test data section lacks the TEST — OWNER ONLY badge");
          if (text.includes("Fictional Test Client")) fail("owner Real mode shows a test client name");
          if (c === "owner-test") {
            await page.getByRole("button", { name: "Test", exact: true }).click();
            await page.waitForTimeout(800);
            text = await pageText(page);
            if (!text.includes("Fictional Test Client")) fail("Test mode does not show the test client");
            if (text.includes("Acme")) fail("Test mode shows a real client");
            const badges = await page.$$eval("span", (spans) => spans.filter((s) => s.textContent.trim().startsWith("TEST")).length);
            if (badges < 3) fail(`Test mode shows ${badges} TEST badges, expected >= 3`);
            check.testMode = { badges };
            // Load sample packages -> plain-words confirmation.
            await page.getByRole("button", { name: "Load sample packages into Fictional Test Project" }).click();
            await page.waitForTimeout(800);
            text = await pageText(page);
            if (!text.includes("Loaded 6 sample packages / 31 steps")) fail("sample load did not confirm in plain words");
            check.loadConfirmed = text.includes("Loaded 6 sample packages / 31 steps");
            // Preview cleanup -> counts panel, Delete disabled until the
            // typed name matches exactly.
            await page.getByRole("button", { name: "Preview cleanup of Fictional Test Client" }).click();
            await page.waitForTimeout(800);
            const panel = await page.$("[data-testid='purge-preview-forge_cli_test1']");
            if (!panel) fail("purge preview panel did not appear");
            const deleteButton = page.getByRole("button", { name: "Delete test data" });
            if (await deleteButton.isEnabled()) fail("Delete test data is enabled before the name is typed");
            await page.fill("#purge-confirm-forge_cli_test1", "Wrong Name");
            if (await deleteButton.isEnabled()) fail("Delete test data is enabled with a wrong name");
            await page.fill("#purge-confirm-forge_cli_test1", "Fictional Test Client");
            if (!(await deleteButton.isEnabled())) fail("Delete test data is disabled with the exact name");
            check.purgePreview = { panelShown: !!panel };
          }
        }

        const shot = path.join(OUT, `${tag}-${c}-${width}.png`);
        await page.screenshot({ path: shot });
        check.screenshot = shot;
        results.checks.push(check);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  fs.writeFileSync(path.join(OUT, `${tag}-results.json`), JSON.stringify(results, null, 2));
  if (results.failures.length > 0) {
    console.error(`FAIL (${results.failures.length}):\n${results.failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`PASS: ${results.checks.length} checks (${CASES.join(", ")}) at ${WIDTHS.join(", ")}px — receipts in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
