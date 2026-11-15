// Slice-7 save-confirmation placement fix (brief 2026-11-15, §4A):
// browser-level viewport proof. jsdom cannot measure layout rectangles
// (getBoundingClientRect returns zeros), so these tests run the real
// components in Chromium at desktop 1280x800 and phone 390x844, perform
// each in-scope mutation through the rendered UI, and assert the
// confirmation renders in the same action/form region as the submit
// control with its bounding rectangle inside the viewport immediately
// after success — without scrolling or scrollIntoView — and with no
// horizontal clipping at phone width.
//
// Method: the submit control is scrolled into view at a viewing
// position that leaves room in the direction the confirmation sits
// relative to the button — the way a user positions the form to see
// the action and its result. Actions whose confirmation lands at or
// below the button (stage, redline, issue, field) put the button in
// the upper-middle (30% from the top): a save can add content above
// the form — a new list item — which pushes the form and its
// confirmation down, so the room has to be below. Actions whose
// confirmation is retained above the button after the form closes
// (review, decision, resolve, reconcile, retire, Package Edit) put
// the button in the lower-middle (70% from the top): the retained
// status sits a form-height above the button — for Package Edit the
// edit form collapses to the shorter read-only list, pulling the
// section-bottom confirmation ~350px up from the Save button's spot —
// so the room has to be above.
// Playwright's click does no further scrolling (the control is already
// visible), and the component never calls scrollIntoView. The
// assertions then prove the confirmation is (a) in the viewport
// immediately after the awaited save, (b) at its action's location —
// inside its own form when the form persists (proven by the scoped
// locator), inside the vertical span its form occupied before the save
// when the form closes on success, or in the lower half of the Package
// section for Package Edit — and (c) already in view at the scroll
// position the user was in when they clicked, so no scroll-to-notice
// happened. The old card-top notice fails (b) for every action (it sat
// at the top of the drawing workspace, outside every action's form)
// and fails (a) for the tall workspaces, so the suite is non-vacuous
// against the old placement.
//
// Wording (§4B) and isolation/state (§4C) are covered by the jsdom unit
// tests in WorkPackageDrawingReadiness.test.jsx and
// WorkPackageDetailClient.test.jsx; the §4D regressions live there too.
import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

// Paths are resolved from the working directory: run the suite from the
// repo root (`npx playwright test --config=e2e/playwright.placement.config.js`).
// (No import.meta here: Playwright transforms test files, and import.meta
// does not survive that transform in this repo's CJS package.)
const repoRoot = process.cwd();
const placementDir = path.join(repoRoot, "e2e", "placement");

let baseURL;
let server;

test.beforeAll(async () => {
  // Every run tests the current source: rebuild the harness first.
  execFileSync("node", [path.join(placementDir, "build-harness.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
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

// Scroll the submit control into view at `fraction` of the viewport
// height from the top (see the method comment above): 0.3 leaves room
// below the button for growth-above and a confirmation under it, 0.7
// leaves room above for a confirmation retained at the top of the
// form block. Positioned by document coordinate, not scrollIntoView,
// so the fraction is exact.
async function scrollActionIntoView(page, locator, fraction = 0.5) {
  await locator.evaluate((el, f) => {
    const docTop = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, docTop - window.innerHeight * f);
  }, fraction);
}

// Scroll, then wait until the control's box stops moving, then
// re-scroll to the target fraction and verify the control actually
// sits there. The workspace's sections resolve in discrete steps after
// expanding a drawing, and a step can land between the scroll and the
// first stability read — the control ends up a few hundred pixels off
// its target with a "stable" box. The loop re-scrolls after the layout
// settles, so the viewing position is exact at click time; without it
// a late growth step silently moves the control (and its confirmation)
// out of the viewport.
async function scrollAndSnapshot(page, button, fraction = 0.5) {
  const target = page.viewportSize().height * fraction;
  for (let attempt = 0; attempt < 3; attempt++) {
    await scrollActionIntoView(page, button, fraction);
    let previous = null;
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      const box = await button.boundingBox();
      if (box && previous && box.x === previous.x && box.y === previous.y) {
        if (++stable >= 5) break;
      } else {
        stable = 0;
      }
      previous = box;
      await page.waitForTimeout(100);
    }
    const box = await button.boundingBox();
    if (box && Math.abs(box.y - target) <= 10) break;
  }
  return { scrollY: await page.evaluate(() => window.scrollY) };
}

// The action form's box in document coordinates, captured before the
// click (the form may unmount on success). The confirmation must land
// inside the vertical span that form occupied — that is the brief's
// "same action/form footer region".
async function captureAnchor(page, formLocator) {
  const box = await formLocator.boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  return { box, scrollY };
}

// The viewport proof (§4A): the status is visible, its whole bounding
// box is inside the viewport, it sits inside the vertical span its
// action's form occupied before the save (±100px — the old card-top
// notice sat at the top of the drawing workspace, above the form's
// span, so this fails on the old placement even where the viewport is
// tall enough to contain both), and it was already in view at the
// scroll position the user was in when they clicked — no
// scroll-to-notice happened. The scroll position itself may shift a
// little from scroll anchoring when the mutation adds or removes
// content above (a new list item, a closing form), so the "already in
// view" check compares document coordinates against the pre-click
// viewport, not exact scrollY equality. Also asserts no horizontal
// page overflow at this viewport.
async function assertPlaced(page, status, before, anchor, anchorGone, mode = "span") {
  await expect(status).toBeVisible({ timeout: 10000 });
  const box = await status.boundingBox();
  expect(box, "confirmation has a layout box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(box.y, "confirmation top is inside the viewport").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "confirmation bottom is inside the viewport").toBeLessThanOrEqual(viewport.height);
  expect(box.x, "confirmation left edge is inside the viewport").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "confirmation right edge is inside the viewport (no horizontal clipping)").toBeLessThanOrEqual(viewport.width);
  const scrollYAfter = await page.evaluate(() => window.scrollY);
  // At the action's location — but only when the action's form closed
  // on success (anchorGone): then the confirmation must land inside
  // the vertical span that form occupied before the save (±100px). The
  // old card-top notice sat at the top of the drawing workspace, above
  // the form's span, so this fails on the old placement even where the
  // viewport is tall enough to contain both. When the form persists,
  // the test's scoped locator already proves the status is inside that
  // form — a document-coordinate span check would false-fail there,
  // because the form itself moves when the save adds content above it
  // (a new list item pushes the whole form down).
  if (anchor?.box) {
    const anchorTop = anchor.box.y + anchor.scrollY;
    const anchorBottom = anchorTop + anchor.box.height;
    const statusTop = box.y + scrollYAfter;
    if (mode === "sectionBottom") {
      // Package Edit: the retained notice sits at the bottom of the
      // Package section, below the read-only fields — assert it is in
      // the section's lower half. (The read-only list wraps taller than
      // the edit form at phone width, so a form-span check false-fails
      // there; the section-bottom check is the design rationale.)
      expect(statusTop, "confirmation sits at the bottom of the Package section, not below the header").toBeGreaterThanOrEqual(anchorTop + (anchorBottom - anchorTop) / 2);
      expect(statusTop, "confirmation sits at the bottom of the Package section").toBeLessThanOrEqual(anchorBottom + 16);
    } else if (anchorGone) {
      expect(statusTop, "confirmation sits at its action's form location, not at the card top").toBeGreaterThanOrEqual(anchorTop - 100);
      expect(statusTop, "confirmation sits at its action's form location, not at the card top").toBeLessThanOrEqual(anchorBottom + 100);
    }
  }
  // In view at the scroll position the user was already in when they
  // clicked: no scroll-to-notice happened. The scroll position itself
  // may shift a little from scroll anchoring when the mutation adds or
  // removes content above (a new list item, a closing form) — a 16px
  // (one line) tolerance covers that noise; the old card-top notice
  // sat 300px+ above the action, so the tolerance does not save it.
  const docTop = box.y + scrollYAfter;
  const docBottom = box.y + box.height + scrollYAfter;
  expect(docTop, "confirmation was in view at the scroll position before the save").toBeGreaterThanOrEqual(before.scrollY - 16);
  expect(docBottom, "confirmation was in view at the scroll position before the save").toBeLessThanOrEqual(before.scrollY + viewport.height + 16);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page overflow at this viewport").toBe(0);
}

async function expandDrawing(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByText("Revisions", { exact: false }).first()).toBeVisible();
  // The workspace fetches its sections asynchronously; let the layout
  // settle before any scroll/snapshot, or the box goes stale.
  await page.waitForLoadState("networkidle");
}

async function expandRound(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForLoadState("networkidle");
}

test.describe("confirmation placement — drawing readiness", () => {
  test("stage IFC PDF confirms beside the stage form", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "ISO-200");
    await page.setInputFiles("input[type='file']", {
      name: "W-0005-1-TEST-ISO-IFC.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%test\n%%EOF\n"),
    });
    const button = page.getByRole("button", { name: "Stage IFC PDF" });
    const anchor = await captureAnchor(page, page.locator("form", { hasText: "Stage an IFC PDF" }));
    const before = await scrollAndSnapshot(page, button, 0.3);
    await button.click();
    const status = page.locator("form", { hasText: "Stage an IFC PDF" }).locator('[role="status"]');
    await expect(status).toHaveText("IFC PDF W-0005-1-TEST-ISO-IFC.pdf staged for drawing ISO-200 — it is staged, not yet issued.");
    await assertPlaced(page, status, before, anchor, false);
  });

  test("open review round confirms in the Review rounds section after the form closes", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=no-open-round`);
    await expandDrawing(page, "P-101");
    await page.selectOption("#review-rev-dwg_1", "forge_wpdrv_2");
    const button = page.getByRole("button", { name: "Open review" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.getByRole("button", { name: "Open review" }) }));
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const status = page.locator("p", { hasText: "Review rounds" }).locator("xpath=..").locator('[role="status"]');
    await expect(status).toHaveText("Review round opened for drawing P-101, Rev 1.");
    await assertPlaced(page, status, before, anchor, true);
  });

  test("add redline confirms inside the redline form", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await expandRound(page, "Round 1 — OPEN");
    await page.fill("#redline-comment-forge_wpdrvw_1", "Check the weld note.");
    const button = page.getByRole("button", { name: "Add redline" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.getByRole("button", { name: "Add redline" }) }));
    const before = await scrollAndSnapshot(page, button, 0.3);
    await button.click();
    const status = page.locator("form", { hasText: "Add a redline" }).locator('[role="status"]');
    await expect(status).toHaveText("Redline added to drawing P-101, Rev 0 (IFA).");
    await assertPlaced(page, status, before, anchor, false);
  });

  test("resolve redline (accepted as noted) confirms in its own redline item", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await expandRound(page, "Round 1 — OPEN");
    await page.getByRole("button", { name: "Resolve" }).click();
    await page.selectOption("#resolve-forge_wpdrl_1", "ACCEPTED_AS_NOTED");
    const button = page.getByRole("button", { name: "Save resolution" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.locator("#resolve-forge_wpdrl_1") }));
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const status = page.locator("li", { hasText: "Move this nozzle 50 mm up." }).locator('[role="status"]');
    await expect(status).toHaveText("Redline accepted as noted for drawing P-101, Rev 0 (IFA).");
    await assertPlaced(page, status, before, anchor, true);
  });

  test("record round decision confirms in the round detail after the forms close", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await expandRound(page, "Round 1 — OPEN");
    await page.fill("#decision-reason-forge_wpdrvw_1", "Looks good.");
    const button = page.getByRole("button", { name: "Record decision" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.getByRole("button", { name: "Add redline" }) }));
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const status = page
      .locator("li", { has: page.getByRole("button", { name: "Round 1 — APPROVED" }) })
      .locator('[role="status"]');
    await expect(status).toHaveText("Review decision recorded for drawing P-101, Rev 0 (IFA): approved.");
    await assertPlaced(page, status, before, anchor, true);
  });

  test("issue IFC revision confirms inside the issue form", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "ISO-200");
    await page.setInputFiles("input[type='file']", {
      name: "W-0005-1-TEST-ISO-IFC.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%test\n%%EOF\n"),
    });
    await page.getByRole("button", { name: "Stage IFC PDF" }).click();
    await expect(page.locator('[role="status"]', { hasText: "staged for drawing ISO-200" })).toBeVisible();
    await page.selectOption("#ifc-rev-dwg_2", "forge_wpdrvw_2");
    await page.fill("#ifc-code-dwg_2", "2");
    await expect(page.locator("#ifc-file-dwg_2 option[value='forge_wpa_9']")).toHaveCount(1);
    await page.selectOption("#ifc-file-dwg_2", "forge_wpa_9");
    const button = page.getByRole("button", { name: "Issue IFC revision" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.getByRole("button", { name: "Issue IFC revision" }) }));
    const before = await scrollAndSnapshot(page, button, 0.3);
    await button.click();
    const status = page.locator("form", { hasText: "Issue an IFC revision" }).locator('[role="status"]');
    await expect(status).toHaveText("IFC revision 2 for drawing ISO-200 issued for construction.");
    await assertPlaced(page, status, before, anchor, false);
  });

  test("capture field hand-redline confirms inside the field form", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await page.selectOption("#field-rev-dwg_1", "forge_wpdrv_2");
    await page.fill("#field-ref-dwg_1", "scan-1.pdf");
    await page.fill("#field-sha-dwg_1", "d".repeat(64));
    await page.fill("#field-reason-dwg_1", "Marked up on site.");
    const button = page.getByRole("button", { name: "Capture field hand-redline" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.getByRole("button", { name: "Capture field hand-redline" }) }));
    const before = await scrollAndSnapshot(page, button, 0.3);
    await button.click();
    const status = page.locator("form", { hasText: "Capture a field hand-redline" }).locator('[role="status"]');
    await expect(status).toHaveText(
      "Field hand-redline captured for drawing P-101, Rev 1 (IFA) as a historical record. It is not an issued IFC revision.",
    );
    await assertPlaced(page, status, before, anchor, false);
  });

  test("reconcile field hand-redline confirms in its own field item", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=pending-field`);
    await expandDrawing(page, "P-101");
    await page.selectOption("#recon-rev-forge_wpdfr_1", "forge_wpdrv_2");
    const button = page.getByRole("button", { name: "Reconcile" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.locator("#recon-rev-forge_wpdfr_1") }));
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const status = page.locator("li", { hasText: "Marked up on site." }).locator('[role="status"]');
    await expect(status).toHaveText(
      "Field hand-redline reconciled for drawing P-101, Rev 0 (IFA), reconciled as Rev 1 (IFA).",
    );
    await assertPlaced(page, status, before, anchor, true);
  });

  test("retire drawing confirms in the drawing after the retire form closes", async ({ page }) => {
    await page.goto(`${baseURL}/readiness.html?scenario=default`);
    await expandDrawing(page, "P-101");
    await page.getByRole("button", { name: "Retire drawing" }).first().click();
    await page.fill("#retire-reason-dwg_1", "Superseded by a new package.");
    const button = page
      .locator("form", { has: page.locator("#retire-reason-dwg_1") })
      .getByRole("button", { name: "Retire drawing" });
    const anchor = await captureAnchor(page, page.locator("form", { has: page.locator("#retire-reason-dwg_1") }));
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const status = page.locator('[role="status"]', { hasText: "Drawing P-101 retired" });
    await expect(status).toHaveText("Drawing P-101 retired. Its review history is kept.");
    await assertPlaced(page, status, before, anchor, true);
  });
});

test.describe("confirmation placement — Package Edit Save", () => {
  test("a real save confirms in the Package section", async ({ page }) => {
    await page.goto(`${baseURL}/detail.html`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("form input:not([type='date'])").first().fill("Turnover 2");
    const button = page.getByRole("button", { name: "Save", exact: true });
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Package" }) });
    const status = section.locator('[role="status"]');
    await expect(status).toHaveText("Turnover 2 saved.");
    const anchor = await captureAnchor(page, section);
    await assertPlaced(page, status, before, anchor, true, "sectionBottom");
  });

  test("a no-change save confirms truthfully and sends no PATCH", async ({ page }) => {
    await page.goto(`${baseURL}/detail.html`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const button = page.getByRole("button", { name: "Save", exact: true });
    const before = await scrollAndSnapshot(page, button, 0.7);
    await button.click();
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Package" }) });
    const status = section.locator('[role="status"]');
    await expect(status).toHaveText("No changes to Turnover — nothing needed saving.");
    const anchor = await captureAnchor(page, section);
    await assertPlaced(page, status, before, anchor, true, "sectionBottom");
    const patches = await page.evaluate(() => window.__placementPatches.length);
    expect(patches, "a no-change save sends no PATCH").toBe(0);
  });
});
