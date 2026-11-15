// Planner hierarchy manager (brief 2026-11-15): browser-level
// viewport proof for the Clients / Sites / Projects manager. jsdom
// cannot measure layout rectangles, so these tests run the real
// component in Chromium at desktop 1280x800 and phone 390x844 and
// assert each save confirmation's rendered text is present, correct,
// and fully inside the viewport after a normal user scroll — no
// forced scroll-to-notice, no overflow, no toast, no card-top
// relocation. The mock API (e2e/placement/mock.js) serves the route
// shape (camelCase, as the real GET route returns after the service
// maps the inventory RPC) and applies POST/PATCH/DELETE statefully, so
// the flows below are the real component paths, not stubs.
//
// Covered: the tree renders with archived rows and counts; creating
// a client confirms beside Save; an unchanged edit confirms
// truthfully and writes nothing; archive and delete confirm by name
// (delete only after the second confirmation, dialog in viewport);
// search narrows the tree; read-only mode hides mutation controls.
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

async function openManager(page, scenario = "") {
  await page.goto(`${baseURL}/hierarchy.html${scenario ? `?scenario=${scenario}` : ""}`);
  await expect(page.getByTestId("planner-hierarchy-manager")).toBeVisible();
  await expect(page.getByText("Acme", { exact: true })).toBeVisible();
}

test.describe("hierarchy manager — tree, confirmations, archive/delete", () => {
  test("tree renders with archived rows, counts, and navigation, with no overflow", async ({ page }) => {
    await openManager(page);
    await expect(page.getByText("2 clients · 2 sites · 2 projects")).toBeVisible();
    await expect(page.getByText("Revamp", { exact: true })).toBeVisible();
    await expect(page.getByText("Beta", { exact: true })).toBeVisible();
    await expect(page.getByText("2 assigned packages")).toBeVisible();
    await expect(page.getByRole("link", { name: "Planner", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Unassigned packages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Planner Admin" })).toBeVisible();
    await assertNoOverflow(page);
  });

  test("creating a client confirms beside Save, inside the viewport", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Name").fill("Acme Industrial");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notice = page.getByText("Acme Industrial saved.");
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "create-client confirmation");
    // The new client joins the tree on the reload.
    await expect(page.getByText("3 clients · 2 sites · 2 projects")).toBeVisible();
    await assertNoOverflow(page);
  });

  test("an unchanged edit confirms truthfully and writes nothing", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "Edit Acme" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notice = page.getByText("No changes to Acme — nothing needed saving.");
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "no-change confirmation");
    const patches = await page.evaluate(
      () => window.__placementCalls.filter((c) => c.method === "PATCH").length,
    );
    expect(patches, "no PATCH is sent for an unchanged edit").toBe(0);
    await assertNoOverflow(page);
  });

  test("archive confirms by name; delete needs the second confirmation, dialog in viewport", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "Archive Turnaround" }).click();
    const archived = page.getByText('Archived "Turnaround".');
    await expect(archived).toBeVisible();
    await scrollAndAssert(page, archived, "archive confirmation");
    // Revamp is archived with no packages: deletable after confirm.
    await page.getByRole("button", { name: "Delete Revamp" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Permanently delete this project?")).toBeVisible();
    await scrollAndAssert(page, dialog, "delete confirmation dialog");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    const deleted = page.getByText('Deleted "Revamp".');
    await expect(deleted).toBeVisible();
    await scrollAndAssert(page, deleted, "delete confirmation");
    await assertNoOverflow(page);
  });

  test("editing a client with changes confirms by name, inside the viewport", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "Edit Acme" }).click();
    await page.getByLabel("Name").fill("Acme Corp");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notice = page.getByText("Acme Corp saved.");
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "edit confirmation");
    await assertNoOverflow(page);
  });

  test("creating a site then a project under it confirms and joins the tree", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "New site under Acme" }).click();
    await page.getByLabel("Name").fill("Plant 9");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Plant 9 saved.")).toBeVisible();
    await page.getByRole("button", { name: "New project under Plant 9" }).click();
    await page.getByLabel("Name").fill("Turnaround 2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notice = page.getByText("Turnaround 2 saved.");
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "create-project confirmation");
    await expect(page.getByText("Plant 9", { exact: true })).toBeVisible();
    await expect(page.getByText("Turnaround 2", { exact: true })).toBeVisible();
    await assertNoOverflow(page);
  });

  test("restoring an archived project confirms by name", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "Restore Revamp" }).click();
    const notice = page.getByText('Restored "Revamp".');
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "restore confirmation");
    await assertNoOverflow(page);
  });

  test("form validation shows the error beside the form and sends nothing", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const error = page.getByText("Enter a name (1–200 characters).");
    await expect(error).toBeVisible();
    await scrollAndAssert(page, error, "validation error");
    const posts = await page.evaluate(
      () => window.__placementCalls.filter((c) => c.method === "POST").length,
    );
    expect(posts, "no POST is sent for an invalid form").toBe(0);
    await assertNoOverflow(page);
  });

  test("a very long client name does not overflow the viewport", async ({ page }) => {
    await openManager(page);
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Name").fill("Acme Industrial Holdings and Refining Services of Southeast Texas LLC");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const notice = page.getByText("Acme Industrial Holdings and Refining Services of Southeast Texas LLC saved.");
    await expect(notice).toBeVisible();
    await scrollAndAssert(page, notice, "long-name confirmation");
    await assertNoOverflow(page);
  });

  test("search narrows the tree to the matching branch", async ({ page }) => {
    await openManager(page);
    await page.getByLabel("Search clients, sites, and projects").fill("Turnaround");
    await expect(page.getByText("Turnaround", { exact: true })).toBeVisible();
    await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Plant 2", { exact: true })).toHaveCount(0);
    await assertNoOverflow(page);
  });

  test("read-only mode hides mutation controls", async ({ page }) => {
    await openManager(page, "hierarchy-readonly");
    await expect(page.getByText("cannot change it")).toBeVisible();
    await expect(page.getByRole("button", { name: "New client" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit Acme" })).toHaveCount(0);
    await assertNoOverflow(page);
  });
});
