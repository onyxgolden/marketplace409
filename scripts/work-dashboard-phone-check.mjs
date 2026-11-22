// D1 dashboard rebuild — phone-width check (D2 extends it with the
// planning-progress widget).
//
// Usage: node scripts/work-dashboard-phone-check.mjs [--port 3102] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server, which
// assumes one is already running on --port), renders the REAL
// PlannerDashboardShell at /phone-fixture?case=work-dashboard via real
// Chromium (Playwright), at 390px and 400px, and measures:
//   - no page-level horizontal overflow (documentElement.scrollWidth <=
//     innerWidth + 1)
//   - every button/link in the fixture fully inside the viewport
//   - the same two checks again after switching the scope pivot chart to
//     Bars (pure client-side state, no network call)
//   - D2: the same two checks again after switching the progress pivot
//     to Bars, plus a progress-bars screenshot
//   - clicking the draft legend row navigates toward the status filter:
//     the navigation request URL must carry status=draft and the test
//     project's forgeProject id (the real /forge/work route cannot render
//     data with the dummy env in this VM, so the request URL — not the
//     landing page — is the drill-down evidence here; Jason's S26+ check
//     with live data remains the final gate)
//   - D2: clicking the Piping progress row navigates toward the system
//     filter: the request URL must carry system=Piping + progressBy=system
//     and the test project's forgeProject id, and must NOT carry the
//     property/mode narrowing filters (D1 fix-round-1 rule)
//   - D2b: the cost-split widget in its complete state (synthetic
//     $3,000.00 strip, all five categories, 3 of 3 estimated packages
//     reconciled) and its incomplete state ($1,000.00 unallocated),
//     donut + bars at phone width; clicking the labor row navigates
//     toward costCategory=labor with the project scope; the default
//     (no snapshot) shows the not-available note and the "—" strip
//   - D2b: the budget-allocation editor (work-budget-editor case) with
//     intercepted API responses — add-line + planned-labor helper +
//     exact-sum save at phone width, no production writes
//   - D2b fix round 1: every editor control (buttons, inputs, selects)
//     measures at least ~44px on both axes at 390/400px, and the delete
//     confirmation names the package and explains the split stays
//     incomplete — target rectangles, not just viewport intersection
//
// The fixture carries 6 wholly synthetic packages created for this test
// (fix round 1 provenance — no production data) plus a synthetic
// planning-% map (100/75/50/25/0, one package without a checklist) and
// invented planner names on three of them, so the check also proves the
// single-segment donut, the "—" no-cost strip, and the progress widget
// never clip at phone width.
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
const TEST_PROJECT_ID = "forge_project_synth_d1_dashboard";

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
  script: "work-dashboard-phone-check",
  expected: "~10 min",
  measured: "cold runs vary with VM load (see rental-property-performance-phone-check, same harness: 10m10s cold once, 36s warm) — the window states the slow case",
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
        const res = await fetch(`${BASE}?case=work-dashboard`);
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

async function measure(page, fixtureTestId = "work-dashboard-fixture") {
  return page.evaluate((testId) => {
    const doc = document.documentElement;
    const interactive = [...document.querySelectorAll(`[data-testid="${testId}"] button, [data-testid="${testId}"] a`)];
    const outside = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > window.innerWidth + 1 || r.left < -1;
    }).map((el) => ({ tag: el.tagName, label: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 40) || null }));
    const section = document.querySelector('[data-testid="planner-dashboard"]');
    const progress = document.querySelector('[data-testid="planner-progress"]');
    const cost = document.querySelector('[data-testid="planner-cost-split"]');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      interactiveCount: interactive.length,
      outsideViewport: outside,
      sectionRendered: Boolean(section),
      stripText: section?.textContent?.slice(0, 200) || null,
      progressRendered: Boolean(progress),
      progressText: progress?.textContent?.slice(0, 300) || null,
      costRendered: Boolean(cost),
      costText: cost?.textContent?.slice(0, 500) || null,
    };
  }, fixtureTestId);
}

// D2b fix round 1 — touch-target rectangles for the budget editor.
// The standing rule is ~44px targets at 360–430px; viewport
// intersection alone does not prove it. Every button/input/select/link
// inside the fixture must measure at least ~44px on both axes.
async function measureTargetSizes(page, fixtureTestId = "work-budget-editor-fixture") {
  return page.evaluate((testId) => {
    const els = [...document.querySelectorAll(
      `[data-testid="${testId}"] button, [data-testid="${testId}"] input, [data-testid="${testId}"] select, [data-testid="${testId}"] a`,
    )];
    const undersized = els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        label: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 40) || el.id || null,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      };
    }).filter((c) => c.height < 43.5 || c.width < 43.5);
    return { count: els.length, undersized };
  }, fixtureTestId);
}

async function checkWidth(browser, width) {
  const failures = [];
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.goto(`${BASE}?case=work-dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="planner-dashboard"]');

    // Navigation requests are the drill-down evidence (the real route
    // cannot render data with the dummy env here). Registered once, up
    // front, so both drill clicks below are captured.
    const navigationUrls = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/forge/work?")) navigationUrls.push(url);
    });

    // D2 progress drill first: clicking a progress row navigates away,
    // so it runs before the layout checks, then the fixture reloads
    // (warm — the route is already compiled). Piping has 2 fixture
    // packages (SYN-03 at 50%, SYN-04 at 25%): 0 of 2 complete, 37.5%.
    await page.locator('[data-testid="planner-progress"]').getByRole("link", { name: /Piping: 0 of 2 packages/ }).click();
    await page.waitForTimeout(3000);
    const progressDrillUrl = navigationUrls.find((url) => url.includes("system=Piping"));
    if (!progressDrillUrl) {
      failures.push(`${width}px: clicking the Piping progress row never requested a system=Piping URL (saw: ${JSON.stringify(navigationUrls)})`);
    } else {
      if (!progressDrillUrl.includes("progressBy=system")) failures.push(`${width}px: progress drill-down URL dropped the progress tab: ${progressDrillUrl}`);
      if (!progressDrillUrl.includes(`forgeProject=${TEST_PROJECT_ID}`)) failures.push(`${width}px: progress drill-down URL dropped the project scope: ${progressDrillUrl}`);
      if (progressDrillUrl.includes("propertyId=")) failures.push(`${width}px: progress drill-down URL carried a narrowing property filter: ${progressDrillUrl}`);
      if (progressDrillUrl.includes("mode=")) failures.push(`${width}px: progress drill-down URL carried a narrowing mode filter: ${progressDrillUrl}`);
    }
    await page.goto(`${BASE}?case=work-dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="planner-dashboard"]');

    const initial = await measure(page);
    if (!initial.sectionRendered) failures.push(`${width}px: dashboard section did not render`);
    if (initial.pageOverflow) failures.push(`${width}px: page overflow (scrollWidth=${initial.scrollWidth})`);
    if (initial.outsideViewport.length) failures.push(`${width}px: ${initial.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(initial.outsideViewport)}`);
    if (initial.interactiveCount < 5) failures.push(`${width}px: suspiciously few interactive controls found (${initial.interactiveCount}) -- fixture may not have rendered`);
    // The fixture's 6 synthetic packages are all draft with no
    // planned cost: strip shows 6 items and "—", donut is one segment.
    if (!initial.stripText?.includes("Synthetic Dashboard Test Project")) failures.push(`${width}px: strip project label missing`);
    if (!initial.stripText?.includes("Total scope items")) failures.push(`${width}px: strip items block missing`);
    // D2: the progress widget renders with its total (1 of 6 complete,
    // mean 50.0% over the 5 packages with planning) and its groups.
    if (!initial.progressRendered) failures.push(`${width}px: progress widget did not render`);
    if (!initial.progressText?.includes("Planning progress")) failures.push(`${width}px: progress heading missing`);
    if (!initial.progressText?.includes("1 of 6")) failures.push(`${width}px: progress total missing (expected 1 of 6)`);
    if (!initial.progressText?.includes("50.0%")) failures.push(`${width}px: progress total percent missing (expected 50.0%)`);
    if (!initial.progressText?.includes("Piping")) failures.push(`${width}px: progress system groups missing`);
    // D2b: the default load carries no cost snapshot — the widget says
    // so instead of showing a false $0.00 split, and the strip shows "—".
    if (!initial.costRendered) failures.push(`${width}px: cost-split widget did not render`);
    if (!initial.costText?.includes("Cost split isn't available yet")) failures.push(`${width}px: cost widget missing its not-available note`);
    await page.screenshot({ path: path.join(ROOT, ".phone-layout-evidence", `work-dashboard-${width}.png`) });

    // Switch the scope pivot chart to Bars — pure client state. Same
    // overflow and viewport checks in the switched state. The Bars
    // button is scoped to the scope card: the progress widget has its
    // own Bars button since D2, and an unscoped lookup would match two.
    await page.locator('[data-testid="planner-scope"]').getByRole("button", { name: "Bars", exact: true }).click();
    await page.waitForSelector('[data-testid="planner-donut"]', { state: "detached" });
    const bars = await measure(page);
    if (bars.pageOverflow) failures.push(`${width}px bars: page overflow (scrollWidth=${bars.scrollWidth})`);
    if (bars.outsideViewport.length) failures.push(`${width}px bars: ${bars.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(bars.outsideViewport)}`);
    await page.locator('[data-testid="planner-scope"]').getByRole("button", { name: "Donut", exact: true }).click();
    await page.waitForSelector('[data-testid="planner-donut"]');

    // D2: switch the progress pivot to Bars — same checks in the
    // switched state, plus a screenshot of the progress bars.
    await page.locator('[data-testid="planner-progress"]').getByRole("button", { name: "Bars", exact: true }).click();
    await page.waitForTimeout(500);
    const progressBars = await measure(page);
    if (progressBars.pageOverflow) failures.push(`${width}px progress bars: page overflow (scrollWidth=${progressBars.scrollWidth})`);
    if (progressBars.outsideViewport.length) failures.push(`${width}px progress bars: ${progressBars.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(progressBars.outsideViewport)}`);
    await page.screenshot({ path: path.join(ROOT, ".phone-layout-evidence", `work-dashboard-progress-bars-${width}.png`) });
    await page.locator('[data-testid="planner-progress"]').getByRole("button", { name: "Table", exact: true }).click();
    await page.waitForTimeout(500);

    // Click-to-filter: the draft legend row must navigate toward the
    // status filter. The real /forge/work route cannot render data with
    // the dummy env here, so the navigation REQUEST URL is the evidence.
    await page.getByRole("link", { name: /draft: 6 of 6 packages/ }).click();
    await page.waitForTimeout(3000);
    const drillUrl = navigationUrls.find((url) => url.includes("status=draft"));
    if (!drillUrl) {
      failures.push(`${width}px: clicking the draft legend row never requested a status=draft URL (saw: ${JSON.stringify(navigationUrls)})`);
    } else if (!drillUrl.includes(`forgeProject=${TEST_PROJECT_ID}`)) {
      failures.push(`${width}px: drill-down URL dropped the project scope: ${drillUrl}`);
    }

    // D2b cost states — complete, then incomplete. Each is a fresh
    // fixture load (warm — the route is already compiled).
    await page.goto(`${BASE}?case=work-dashboard&cost=complete`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="planner-cost-split"]');
    const costComplete = await measure(page);
    if (costComplete.pageOverflow) failures.push(`${width}px cost complete: page overflow (scrollWidth=${costComplete.scrollWidth})`);
    if (costComplete.outsideViewport.length) failures.push(`${width}px cost complete: ${costComplete.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(costComplete.outsideViewport)}`);
    if (!costComplete.stripText?.includes("$3,000.00")) failures.push(`${width}px cost complete: strip missing the $3,000.00 control-estimate total`);
    if (!costComplete.costText?.includes("All 3 estimated packages reconciled.")) failures.push(`${width}px cost complete: widget missing the reconciled note`);
    if (!costComplete.costText?.includes("Labor")) failures.push(`${width}px cost complete: labor row missing`);
    // Cost pivot to Bars — same checks in the switched state.
    await page.locator('[data-testid="planner-cost-split"]').getByRole("button", { name: "Bars", exact: true }).click();
    await page.waitForTimeout(500);
    const costBars = await measure(page);
    if (costBars.pageOverflow) failures.push(`${width}px cost bars: page overflow (scrollWidth=${costBars.scrollWidth})`);
    if (costBars.outsideViewport.length) failures.push(`${width}px cost bars: ${costBars.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(costBars.outsideViewport)}`);
    await page.screenshot({ path: path.join(ROOT, ".phone-layout-evidence", `work-dashboard-cost-bars-${width}.png`) });
    await page.locator('[data-testid="planner-cost-split"]').getByRole("button", { name: "Donut", exact: true }).click();
    await page.waitForTimeout(500);
    // Cost drill-down: the labor row navigates toward costCategory=labor.
    await page.locator('[data-testid="planner-cost-split"]').getByRole("link", { name: /Labor: \$1,300\.00/ }).click();
    await page.waitForTimeout(3000);
    const costDrillUrl = navigationUrls.find((url) => url.includes("costCategory=labor"));
    if (!costDrillUrl) {
      failures.push(`${width}px: clicking the labor cost row never requested a costCategory=labor URL (saw: ${JSON.stringify(navigationUrls)})`);
    } else if (!costDrillUrl.includes(`forgeProject=${TEST_PROJECT_ID}`)) {
      failures.push(`${width}px: cost drill-down URL dropped the project scope: ${costDrillUrl}`);
    }

    // D2b incomplete state: one package's allocation went stale, so its
    // $1,000.00 reads as unallocated and the five-way totals drop to
    // the two reconciled packages ($2,000.00).
    await page.goto(`${BASE}?case=work-dashboard&cost=incomplete`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="planner-cost-split"]');
    const costIncomplete = await measure(page);
    if (costIncomplete.pageOverflow) failures.push(`${width}px cost incomplete: page overflow (scrollWidth=${costIncomplete.scrollWidth})`);
    if (costIncomplete.outsideViewport.length) failures.push(`${width}px cost incomplete: ${costIncomplete.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(costIncomplete.outsideViewport)}`);
    if (!costIncomplete.costText?.includes("Allocation incomplete")) failures.push(`${width}px cost incomplete: banner missing`);
    if (!costIncomplete.costText?.includes("$1,000.00 unallocated")) failures.push(`${width}px cost incomplete: banner missing the precise $1,000.00 unallocated amount`);
    if (costIncomplete.costText?.includes("Labor $1,300.00")) failures.push(`${width}px cost incomplete: false chart — the stale package's labor is still counted`);

    return { width, initial, bars, progressBars, drillUrl: drillUrl || null, progressDrillUrl: progressDrillUrl || null, costComplete, costBars, costDrillUrl: costDrillUrl || null, costIncomplete, failures };
  } finally {
    await page.close();
  }
}

// D2b budget editor at phone width. The editor's GET/POST calls are
// intercepted with canned responses — a $1,500.00 estimate, no saved
// allocation, a $900.00 planned-labor forecast — so the whole add-line
// + save flow runs with no production writes. The POST handler keeps
// the saved allocation in memory, so the post-save GET returns it and
// the editor's table renders, exactly as the real round-trip would.
async function checkBudgetEditor(browser, width) {
  const failures = [];
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    let savedAllocation = null;
    const snapshot = () => ({
      estimate: { id: "est_synth_01", version: 1, currentControlEstimateCents: 150000 },
      allocation: savedAllocation,
      packageCode: "SYN-01",
      packageTitle: "Synthetic exchanger inspection [SYNTHETIC]",
      plannedLaborForecastCents: 90000,
      notApplied: false,
    });
    await page.route("**/api/work-packages/forge_wp_synth_d1_01/budget-allocation", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        const lines = (body?.lines || []).map((line, i) => ({ id: `line_${i + 1}`, ...line }));
        const categoryTotals = { labor: 0, material: 0, equipment: 0, external_services: 0, rental: 0 };
        for (const line of lines) categoryTotals[line.category] = (categoryTotals[line.category] || 0) + line.amountCents;
        savedAllocation = {
          id: "alloc_synth_01", version: 1, estimateId: "est_synth_01", estimateVersion: 1,
          allocatedTotalCents: 150000, categoryTotals, lines,
        };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedAllocation) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot()) });
      }
    });
    await page.goto(`${BASE}?case=work-budget-editor`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('text=No budget allocation yet', { timeout: 15000 });

    const initial = await measure(page, "work-budget-editor-fixture");
    if (initial.pageOverflow) failures.push(`${width}px editor: page overflow (scrollWidth=${initial.scrollWidth})`);
    if (initial.outsideViewport.length) failures.push(`${width}px editor: ${initial.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(initial.outsideViewport)}`);
    const initialTargets = await measureTargetSizes(page, "work-budget-editor-fixture");
    if (initialTargets.undersized.length) failures.push(`${width}px editor: ${initialTargets.undersized.length} control(s) under ~44px: ${JSON.stringify(initialTargets.undersized)}`);

    // Add-line + planned-labor helper + exact-sum save: one material
    // line ($600.00) typed by hand, one labor line ($900.00) from the
    // forecast helper — together exactly the $1,500.00 estimate.
    await page.getByRole("button", { name: "Add budget allocation", exact: true }).click();
    await page.waitForSelector('select[id^="alloc-category-"]');
    await page.locator('select[id^="alloc-category-"]').first().selectOption("material");
    await page.locator('input[id^="alloc-description-"]').first().fill("Synthetic pipe");
    await page.locator('input[id^="alloc-amount-"]').first().fill("600.00");
    await page.getByRole("button", { name: /Use planned labor estimate/ }).click();
    await page.waitForTimeout(300);
    const editing = await measure(page, "work-budget-editor-fixture");
    if (editing.pageOverflow) failures.push(`${width}px editor editing: page overflow (scrollWidth=${editing.scrollWidth})`);
    if (editing.outsideViewport.length) failures.push(`${width}px editor editing: ${editing.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(editing.outsideViewport)}`);
    const editingTargets = await measureTargetSizes(page, "work-budget-editor-fixture");
    if (editingTargets.undersized.length) failures.push(`${width}px editor editing: ${editingTargets.undersized.length} control(s) under ~44px: ${JSON.stringify(editingTargets.undersized)}`);
    await page.getByLabel("Reason for this budget allocation change").fill("Phone check");
    const saveButton = page.getByRole("button", { name: "Save budget allocation", exact: true });
    if (await saveButton.isDisabled()) failures.push(`${width}px editor: Save stayed disabled with exact-sum lines + reason`);
    await saveButton.click();
    await page.waitForSelector('text=Budget allocation saved for SYN-01', { timeout: 15000 });
    const saved = await measure(page, "work-budget-editor-fixture");
    if (saved.pageOverflow) failures.push(`${width}px editor saved: page overflow (scrollWidth=${saved.scrollWidth})`);
    if (saved.outsideViewport.length) failures.push(`${width}px editor saved: ${saved.outsideViewport.length} control(s) outside viewport: ${JSON.stringify(saved.outsideViewport)}`);
    const savedTargets = await measureTargetSizes(page, "work-budget-editor-fixture");
    if (savedTargets.undersized.length) failures.push(`${width}px editor saved: ${savedTargets.undersized.length} control(s) under ~44px: ${JSON.stringify(savedTargets.undersized)}`);
    const savedText = await page.evaluate(() => document.querySelector('[data-testid="work-budget-editor-fixture"]').textContent);
    if (!savedText.includes("labor $900.00, material $600.00")) failures.push(`${width}px editor: save confirmation missing the saved split`);
    if (!savedText.includes("Synthetic pipe")) failures.push(`${width}px editor: saved table missing the material line`);
    // Delete confirmation at phone width (fix round 1 P1): the copy
    // must name the package and explain the split stays incomplete.
    // The confirm button is NOT clicked — no retire endpoint is
    // intercepted here, so the delete itself is proved in jsdom.
    await page.getByRole("button", { name: "Delete this allocation", exact: true }).click();
    await page.waitForSelector('input[aria-label="Reason for deleting the budget allocation"]', { timeout: 15000 });
    const retireText = await page.evaluate(() => document.querySelector('[data-testid="work-budget-editor-fixture"]').textContent);
    if (!retireText.includes("Delete the budget allocation for SYN-01")) failures.push(`${width}px editor delete: confirmation does not name the package`);
    if (!retireText.includes("remain incomplete")) failures.push(`${width}px editor delete: confirmation does not explain the split stays incomplete`);
    const retireTargets = await measureTargetSizes(page, "work-budget-editor-fixture");
    if (retireTargets.undersized.length) failures.push(`${width}px editor delete: ${retireTargets.undersized.length} control(s) under ~44px: ${JSON.stringify(retireTargets.undersized)}`);
    await page.screenshot({ path: path.join(ROOT, ".phone-layout-evidence", `work-budget-editor-${width}.png`) });
    return { width, initial, editing, saved, failures, initialTargets, editingTargets, savedTargets, retireTargets };
  } finally {
    await page.close();
  }
}

// The real /forge/work route with dummy env cannot load live data in this
// VM (auth/SWRIdentityBridge needs real Supabase env). Load it once at
// 400px and record honestly what renders — an observation, not a gate:
// Jason's S26+ check with live data remains the final gate. Overflow only
// counts against the build if the dashboard actually rendered.
async function checkRealPage(browser) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  try {
    const response = await page.goto(`http://localhost:${port}/forge/work?forgeProject=unassigned`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2000);
    const observed = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        url: window.location.href,
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        pageOverflow: doc.scrollWidth > window.innerWidth + 1,
        dashboardRendered: Boolean(document.querySelector('[data-testid="planner-dashboard"]')),
        bodyText: document.body.innerText.slice(0, 300),
      };
    });
    return { status: response?.status() ?? null, ...observed };
  } catch (err) {
    return { error: String(err?.message || err) };
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
      progress.phase(`checking budget editor ${width}px`);
      const editorResult = await checkBudgetEditor(browser, width);
      results.push({ case: "work-budget-editor", ...editorResult });
      failures.push(...editorResult.failures);
    }
    progress.phase("observing the real /forge/work route");
    const realPage = await checkRealPage(browser);
    if (realPage.dashboardRendered && realPage.pageOverflow) {
      failures.push(`real /forge/work at 400px: dashboard rendered with page overflow (scrollWidth=${realPage.scrollWidth})`);
    }
    console.log(JSON.stringify({ results, realPage }, null, 2));
    if (failures.length) {
      console.error(`FAIL: ${failures.length} phone-width issue(s) at 390/400px`);
      process.exitCode = 1;
      progress.done("FAIL", { exitCode: 1 });
    } else {
      console.log("PASS: no overflow, no out-of-viewport controls at 390px and 400px (donut + scope bars + progress bars + cost complete/incomplete + cost bars states, budget editor add-line + save flow), every editor control measures ~44px or more on both axes (initial/editing/saved/delete states), draft drill-down requests the status filter, Piping progress drill-down requests system=Piping + progressBy=system with no narrowing filters, labor cost drill-down requests costCategory=labor with the project scope; real /forge/work observed separately (see JSON)");
      progress.done("PASS", { exitCode: 0 });
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
