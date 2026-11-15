// Slice-7 follow-ups (brief 2026-11-15): browser-level viewport proof
// for the three display-only findings. jsdom cannot measure layout
// rectangles, so these tests run the real components in Chromium at
// desktop 1280x800 and phone 390x844 and assert each finding's
// rendered text is present, correct, and fully inside the viewport
// after a normal user scroll — no forced scroll-to-notice, no
// overflow, no toast, no card-top relocation.
//
// Finding 1: two genuine Round 1s (Rev 0 and Rev 1) render as
// distinct revision-qualified buttons, and the accepted-review IFC
// picker uses the same label.
// Finding 2: review history and field hand-redline history read in
// plain words — friendly event/state, timestamp, bound revision,
// human outcome — with no raw enum, no actor-ID fragment, and a
// labelled reference only when it reads as one.
// Finding 3: the summary counts "Drawings awaiting review" (not
// rounds), with a per-drawing "Open review rounds: N" — 0 is correct
// when an active IFC release takes precedence, and a 0 beside an IFA
// In review badge shows the stale-summary warning with a manual retry.
//
// The pagination "Open rounds shown" branch (a full 200-row page) is
// covered by the jsdom unit tests — rendering 200 round buttons in
// the browser adds no layout evidence beyond the label itself.
// Wording/state mapping for every event type and outcome is covered
// there too; this suite proves the rendered page at both viewports.
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
  // Locked: a second spec file in a parallel worker builds the same
  // dist/ directory — the lock keeps the two builds from interleaving.
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

// Scroll a locator into view at `fraction` of the viewport height from
// the top, by document coordinate (not scrollIntoView), the way a user
// positions content to read it — then wait for its box to stop moving
// and re-scroll, so a late layout step cannot silently move the target
// out of the viewport after the scroll.
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

async function expandDrawing(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByText("Revisions", { exact: false }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function expandRound(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForLoadState("networkidle");
}

test.describe("slice-7 follow-ups — display labels and history", () => {
  test("Finding 1: duplicate Round 1s name their revision in the list and the IFC picker", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=duplicate-rounds`);
    await expandDrawing(page, "P-101");
    const rev0 = page.getByRole("button", { name: "Rev 0 (IFA) · Round 1 — Open" });
    const rev1 = page.getByRole("button", { name: "Rev 1 (IFA) · Round 1 — Approved" });
    await expect(rev0).toBeVisible();
    await expect(rev1).toBeVisible();
    // Two distinct round buttons, not one merged "Round 1".
    await expect(page.getByRole("button", { name: "Round 1" })).toHaveCount(2);
    await expect(page.getByText("Open review rounds: 1")).toBeVisible();
    // Different revisions, so no duplicate-numbering warning.
    await expect(page.getByText("Review numbering needs verification")).toHaveCount(0);
    const picker = page.locator("#ifc-rev-dwg_1");
    await expect(picker).toContainText("Rev 1 (IFA) · Round 1 — Approved");
    await expect(picker).not.toContainText("Round 1 — APPROVED");
    await scrollAndAssert(page, rev0, "Rev 0 Round 1 button");
    await scrollAndAssert(page, rev1, "Rev 1 Round 1 button");
    await assertNoOverflow(page);
  });

  test("Finding 2: review history reads in plain words, with no raw enum or actor ID", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await expandRound(page, "Round 1 — OPEN");
    const history = page.getByText("History", { exact: true }).locator("xpath=..");
    await expect(history).toContainText("Review opened");
    await expect(history).toContainText("Redline added");
    await expect(history).toContainText("Redline resolved");
    await expect(history).toContainText("Recorded by a team member");
    await expect(history).toContainText("11/8/2026");
    await expect(history).not.toContainText("REVIEW_OPENED");
    await expect(history).not.toContainText("REDLINE_ADDED");
    await expect(history).not.toContainText("REDLINE_RESOLVED");
    await expect(history).not.toContainText("43af922e");
    await expect(history).not.toContainText("e1b22131");
    await scrollAndAssert(page, history.locator("ul"), "review history list");
    await assertNoOverflow(page);
  });

  test("Finding 2: an approved round's history shows the approval in plain words", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "ISO-200");
    await expandRound(page, "Round 1 — APPROVED");
    const history = page.getByText("History", { exact: true }).locator("xpath=..");
    await expect(history).toContainText("Review opened");
    await expect(history).toContainText("Review approved");
    await expect(history).toContainText("Approved");
    await expect(history).not.toContainText("REVIEW_APPROVED");
    await expect(history).not.toContainText("43af922e");
    await scrollAndAssert(page, history.locator("ul"), "review history list");
    await assertNoOverflow(page);
  });

  test("Finding 2: field hand-redline history names the state and the reference, never a raw ID", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=pending-field`);
    await expandDrawing(page, "P-101");
    const history = page.getByText("Field hand-redline history", { exact: true }).locator("xpath=..");
    await expect(history).toContainText("Awaiting reconciliation");
    await expect(history).toContainText("Reference: scan-1.pdf");
    await expect(history).not.toContainText("HISTORICAL_PENDING_RECONCILIATION");
    await scrollAndAssert(page, history.locator("ul"), "field history list");
    await assertNoOverflow(page);
  });

  test("Finding 2: an opaque field reference renders 'Reference recorded' with no ID fragment", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=pending-field-opaque`);
    await expandDrawing(page, "P-101");
    const history = page.getByText("Field hand-redline history", { exact: true }).locator("xpath=..");
    await expect(history).toContainText("Awaiting reconciliation");
    await expect(history).toContainText("Reference recorded");
    await expect(history).not.toContainText("HISTORICAL_PENDING_RECONCILIATION");
    await expect(history).not.toContainText("43af922e");
    await expect(history).not.toContainText("e1b22131");
    await scrollAndAssert(page, history.locator("ul"), "field history list");
    await assertNoOverflow(page);
  });

  test("Finding 3: the summary counts drawings awaiting review, with a per-drawing open-round count", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expect(page.getByText("Drawings awaiting review")).toBeVisible();
    await expect(page.getByText("Pending review")).toHaveCount(0);
    await expect(page.getByText("Counts drawings, not review rounds")).toBeVisible();
    const countCell = page.locator("dt", { hasText: "Drawings awaiting review" }).locator("xpath=following-sibling::dd");
    await expect(countCell).toHaveText("1");
    await expect(page.getByText("Readiness summary may be out of date")).toHaveCount(0);
    await expandDrawing(page, "P-101");
    await expect(page.getByText("Open review rounds: 1")).toBeVisible();
    await scrollAndAssert(page, page.getByText("Open review rounds: 1"), "open-round count");
    await assertNoOverflow(page);
  });

  test("Finding 3: an active IFC with a historical OPEN round counts 0 in the summary and 1 per drawing", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=active-ifc`);
    const countCell = page.locator("dt", { hasText: "Drawings awaiting review" }).locator("xpath=following-sibling::dd");
    await expect(countCell).toHaveText("0");
    await expect(page.getByText("Readiness summary may be out of date")).toHaveCount(0);
    await expandDrawing(page, "P-101");
    await expect(page.getByText("Open review rounds: 1")).toBeVisible();
    await scrollAndAssert(page, page.getByText("Open review rounds: 1"), "open-round count");
    await assertNoOverflow(page);
  });

  test("Finding 3: a 0 count beside an IFA In review badge shows the stale-summary warning with a retry", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=stale-summary`);
    const warning = page.getByText("Readiness summary may be out of date");
    await expect(warning).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await scrollAndAssert(page, warning, "stale-summary warning");
    await assertNoOverflow(page);
  });
});
