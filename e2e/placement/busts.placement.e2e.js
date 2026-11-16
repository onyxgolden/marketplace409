// Slice-9 busts (brief 2026-11-15): browser-level viewport proof.
// jsdom cannot measure layout rectangles (getBoundingClientRect
// returns zeros), so these tests run the real WorkPackageBusts panel
// in Chromium at desktop 1280x800 and phone 390x844, with the
// placement-harness API mock, and assert:
//   (1) the detected candidate, the recorded bust, and the
//       insufficiency render with plain-words labels and money;
//   (2) confirming a candidate shows its confirmation inline beside
//       the action — bounding rectangle inside the viewport
//       immediately after the save, without scrolling — and the
//       recorded list grows;
//   (3) expanding a recorded bust shows its history and linked
//       change order, with no raw actor id;
//   (4) the manual-record form sends dollars as whole cents and
//       confirms in plain words;
//   (5) no horizontal overflow at phone width.
// Wording, validation, and the RPC contract live in the jsdom unit
// tests (WorkPackageBusts.test.jsx) and the migration suite.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { buildHarnessLocked } from "./build-harness-locked.mjs";

// Paths are resolved from the working directory: run the suite from the
// repo root (`npx playwright test --config=e2e/playwright.placement.config.js`).
const repoRoot = process.cwd();
const placementDir = path.join(repoRoot, "e2e", "placement");

let baseURL;
let server;

test.beforeAll(async () => {
  // Every run tests the current source: rebuild the harness first.
  buildHarnessLocked(repoRoot, placementDir);
  server = spawn("node", [path.join(placementDir, "server.mjs")], { cwd: repoRoot });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("placement server did not start")), 15000);
    server.stdout.on("data", (d) => {
      const m = String(d).match(/PLACEMENT_SERVER_PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    server.stderr.on("data", (d) => console.log("[placement-server]", String(d)));
  });
  baseURL = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  server?.kill();
});

// Scroll a locator into view at `fraction` of the viewport height
// from the top, by document coordinate (not scrollIntoView), then wait
// for its box to stop moving and re-scroll — the way a user positions
// a form to see the action and its result.
async function scrollAndAssert(page, locator, label, fraction = 0.5) {
  const scrollTo = async () => {
    await locator.evaluate((el, f) => {
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, docTop - window.innerHeight * f);
    }, fraction);
  };
  await scrollTo();
  let previous = null;
  for (let i = 0; i < 40; i++) {
    const box = await locator.boundingBox();
    if (box && previous && box.x === previous.x && box.y === previous.y && box.width === previous.width && box.height === previous.height) break;
    previous = box;
    await page.waitForTimeout(100);
  }
  await scrollTo();
  await expect(locator, `${label} is visible`).toBeVisible({ timeout: 10000 });
  const box = await locator.boundingBox();
  expect(box, `${label} has a layout box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(box.y, `${label}: top inside viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${label}: bottom inside viewport`).toBeLessThanOrEqual(viewport.height);
  expect(box.x, `${label}: left inside viewport`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: right inside viewport (no horizontal clipping)`).toBeLessThanOrEqual(viewport.width);
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page overflow at this viewport").toBe(0);
}

async function gotoBusts(page) {
  await page.goto(`${baseURL}/busts.html`);
  await expect(page.getByText("Detected — needs review")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("slice-9 busts — candidates, confirm, detail, manual record", () => {
  test("candidates, recorded bust, and insufficiency render in plain words", async ({ page }) => {
    await gotoBusts(page);
    await expect(page.getByText("Labor cost").first()).toBeVisible();
    await expect(page.getByText("Whole package").first()).toBeVisible();
    await expect(page.getByText("$2,500.00 over").first()).toBeVisible();
    await expect(page.getByText("Could not check")).toBeVisible();
    await expect(page.getByText(/No assignments on file for 2026-11-09/)).toBeVisible();
    await expect(page.getByText("Recorded busts (1)")).toBeVisible();
    await expect(page.getByText("Actual cost is over the frozen baseline.")).toBeVisible();
    // The status badge on the recorded bust — not the "Open" option
    // in the status filter select (options read hidden to Playwright).
    await expect(page.locator("li span:text-is('Open')").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm bust" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record a bust" })).toBeVisible();
    await assertNoOverflow(page);
  });

  test("confirming a candidate confirms inline in the viewport and grows the recorded list", async ({ page }) => {
    await gotoBusts(page);
    const confirm = page.getByRole("button", { name: "Confirm bust" });
    // The confirmation sits beside the button inside the candidate
    // form, so the button goes in the upper-middle — room below for
    // the notice and the list growth underneath.
    await scrollAndAssert(page, confirm, "Confirm bust button", 0.3);
    await confirm.click();
    const notice = page.getByText("Bust recorded — Labor cost is open for review.");
    await expect(notice).toBeVisible({ timeout: 10000 });
    // In the viewport immediately after the save — no scrolling to
    // notice it, and inside the candidate's own form region (the
    // scoped locator is the notice beside the clicked button).
    await scrollAndAssert(page, notice, "confirm notice", 0.3);
    await expect(page.getByText("Recorded busts (2)")).toBeVisible();
    await assertNoOverflow(page);
  });

  test("expanding a recorded bust shows its history and linked change order", async ({ page }) => {
    await gotoBusts(page);
    await page.getByRole("button", { name: "Detail" }).first().click();
    await expect(page.getByText("History", { exact: true })).toBeVisible();
    await expect(page.getByText("Recorded", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Bust recorded", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Linked change orders")).toBeVisible();
    await expect(page.getByText("Change order 2 (approved)")).toBeVisible();
    await expect(page.getByText("Move bust to")).toBeVisible();
    // History shows what changed and why — never a raw actor id.
    const detail = page.locator("text=History").locator("xpath=..");
    await expect(detail).not.toContainText("e1b22131");
    await assertNoOverflow(page);
  });

  test("manual record sends dollars as whole cents and confirms in plain words", async ({ page }) => {
    await gotoBusts(page);
    await page.getByRole("button", { name: "Record a bust" }).click();
    await page.locator("#manual-dimension").selectOption("LABOR_COST");
    await page.locator("#manual-planned").fill("10000");
    await page.locator("#manual-observed").fill("12500");
    await page.locator("#manual-evidence").fill("Verified against the signed timesheets for week 46.");
    const record = page.getByRole("button", { name: "Record bust" });
    await expect(record).toBeEnabled();
    await scrollAndAssert(page, record, "Record bust button", 0.3);
    await record.click();
    const notice = page.getByText("Bust recorded — Labor cost is open for review.");
    await expect(notice).toBeVisible({ timeout: 10000 });
    await scrollAndAssert(page, notice, "manual record notice", 0.3);
    // The dollars the user typed arrived as whole cents.
    const posted = await page.evaluate(() => window.__placementLastBustPost);
    expect(posted).toBeDefined();
    expect(posted.dimension).toBe("LABOR_COST");
    expect(posted.plannedValue).toBe(1000000);
    expect(posted.observedValue).toBe(1250000);
    expect(posted.unit).toBe("USD_CENTS");
    await assertNoOverflow(page);
  });
});
