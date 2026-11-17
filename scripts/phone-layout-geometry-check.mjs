// Phone Slice 5 geometry harness — real Chromium via Playwright.
//
// Usage:
//   node scripts/phone-layout-geometry-check.mjs --tag before|after [--port 3100]
//     [--widths 360,390,412,430,768,1919] [--cases designer,work-header,app-header,forge-header,rental-23]
//     [--keep-server]
//
// Spawns the Next dev server for this worktree (unless --keep-server, which
// assumes one is already running on --port), renders the real components in
// /phone-fixture at each viewport width, and measures:
//   - documentElement.scrollWidth <= innerWidth + 1 (page-level overflow)
//   - every button/input/select/link fully inside the viewport
//   - designer: every rendered SVG dimension/deck text's screen rect
//     (via getBBox + getScreenCTM) — zero pairwise intersections, zero
//     outside the visible 2D pane; structural fit coverage of the
//     limiting axis; and tap-a-wall -> the selected wall's label appears
//   - work-header: Document library / Admin / New package fully visible
//   - app-header / forge-header: Apps / Applications always visible, all
//     header controls inside the viewport
//   - rental-23: Slice 2 regression guard (7 icons + +16, metrics line,
//     billing Active)
//
// Writes screenshots + results JSON to ~/workspace/phone-slice5-evidence/.
// Exits non-zero when any check fails, so it can gate a PR. Screenshots
// alone never replace the numerical geometry below.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WORKTREE = "/home/hatch/workspace/build-wt/phone-slice5";
const require = createRequire(`${WORKTREE}/node_modules/playwright/index.js`);
const { chromium } = require("playwright");

const OUT = "/home/hatch/workspace/phone-slice5-evidence";

// The before-run designer measurement at a width, for the 1919
// no-regression comparison (desktop defects that pre-exist the slice do
// not count as new failures). Returns null when no before file exists.
function loadBeforeDesigner(width) {
  try {
    const before = JSON.parse(fs.readFileSync(path.join(OUT, "results-before.json"), "utf8"));
    const check = before.checks.find((x) => x.case === "designer" && x.width === width);
    return check?.designer || null;
  } catch {
    return null;
  }
}
const args = process.argv.slice(2);
const argVal = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const tag = argVal("--tag", "check");
const port = argVal("--port", "3100");
const widthsArg = argVal("--widths", undefined);
const casesArg = argVal("--cases", undefined);
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture`;

const WIDTHS = widthsArg ? widthsArg.split(",").map(Number) : [360, 390, 412, 430, 768, 1919];
const CASES = casesArg ? casesArg.split(",") : ["designer", "work-header", "app-header", "forge-header", "rental-23"];

fs.mkdirSync(OUT, { recursive: true });

function rectsIntersect(a, b, pad = 0) {
  return (
    a.left - pad < b.right + pad &&
    b.left - pad < a.right + pad &&
    a.top - pad < b.bottom + pad &&
    b.top - pad < a.bottom + pad
  );
}

async function measurePage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bad = [];
    for (const el of document.querySelectorAll("button, input, select, a[href], textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        bad.push({ tag: el.tagName, text: (el.textContent || el.value || "").trim().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      outOfViewportControls: bad.slice(0, 10),
      outOfViewportCount: bad.length,
    };
  });
}

// All rendered SVG plan texts (dimension + deck labels) in screen coords,
// plus the structural wall-line extents for the fit-coverage check.
async function measureDesigner(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-testid="designer-pane"]');
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    const svg = pane ? pane.querySelector("svg") : null;
    const out = { paneRect: paneRect ? { left: Math.round(paneRect.left), top: Math.round(paneRect.top), width: Math.round(paneRect.width), height: Math.round(paneRect.height) } : null, labels: [], intersections: [], outsidePane: [], fit: null };
    if (!svg) return out;
    const toScreen = (el, x, y) => {
      // Per-ELEMENT screen CTM: the SVG's CTM omits each text's own
      // rotate() transform, which would measure every vertical label as
      // if it were horizontal (wrong AABB, phantom intersections).
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    };
    // Dimension labels (fill #9ca3af, fontSize 12) and deck labels
    // (#a0744a, or #f59e0b when selected). Ruler ticks share the #9ca3af
    // fill at fontSize 9 and pipe labels use other fills — neither is a
    // plan label, so both are excluded by the fontSize/text filters.
    const texts = [...svg.querySelectorAll("text")].filter((t) => {
      const fill = (t.getAttribute("fill") || "").toLowerCase();
      // React renders the fontSize prop as the `font-size` attribute.
      const size = t.getAttribute("font-size");
      const text = (t.textContent || "").trim();
      if (fill === "#9ca3af" && size === "12") return true;
      if (fill === "#a0744a") return true;
      if (text.includes("below threshold")) return true;
      return false;
    });
    out.labels = texts.map((t) => {
      const bb = t.getBBox();
      const tl = toScreen(t, bb.x, bb.y);
      const br = toScreen(t, bb.x + bb.width, bb.y + bb.height);
      // A 90-degree rotation swaps the corners: normalize so left<=right
      // and top<=bottom, or every intersection test on a vertical label
      // is computed from an inverted rect.
      return {
        text: (t.textContent || "").trim(),
        fill: t.getAttribute("fill"),
        rect: { left: Math.round(Math.min(tl.x, br.x)), top: Math.round(Math.min(tl.y, br.y)), right: Math.round(Math.max(tl.x, br.x)), bottom: Math.round(Math.max(tl.y, br.y)) },
      };
    });
    const rectsIntersectInPage = (a, b, pad = 0) =>
      a.left - pad < b.right + pad &&
      b.left - pad < a.right + pad &&
      a.top - pad < b.bottom + pad &&
      b.top - pad < a.bottom + pad;
    for (let i = 0; i < out.labels.length; i += 1) {
      for (let j = i + 1; j < out.labels.length; j += 1) {
        if (rectsIntersectInPage(out.labels[i].rect, out.labels[j].rect, -1)) {
          out.intersections.push([out.labels[i].text, out.labels[j].text]);
        }
      }
      const r = out.labels[i].rect;
      if (paneRect && (r.left < paneRect.left - 1 || r.right > paneRect.right + 1 || r.top < paneRect.top - 1 || r.bottom > paneRect.bottom + 1)) {
        out.outsidePane.push(out.labels[i].text);
      }
    }
    // Structural fit: wall lines (stroke #e5e7eb) in screen coords.
    // Line x1/y1 attributes are SVG-local, so offset by the SVG's
    // viewport rect before comparing against the pane rect.
    const svgRect = svg.getBoundingClientRect();
    const lines = [...svg.querySelectorAll("line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === "#e5e7eb");
    if (lines.length && paneRect) {
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const l of lines) {
        for (const [x, y] of [[+l.getAttribute("x1"), +l.getAttribute("y1")], [+l.getAttribute("x2"), +l.getAttribute("y2")]]) {
          const sx = svgRect.left + x;
          const sy = svgRect.top + y;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      }
      const structW = maxX - minX;
      const structH = maxY - minY;
      out.fit = {
        structuralPx: { width: Math.round(structW), height: Math.round(structH) },
        panePx: { width: Math.round(paneRect.width), height: Math.round(paneRect.height) },
        // Coverage of the limiting axis: the fitted plan must use at least
        // 50% of whichever pane axis limits the fit (padding is 24px/side).
        widthCoverage: +(structW / Math.max(1, paneRect.width - 48)).toFixed(3),
        heightCoverage: +(structH / Math.max(1, paneRect.height - 48)).toFixed(3),
        insidePane: minX >= paneRect.left - 1 && maxX <= paneRect.right + 1 && minY >= paneRect.top - 1 && maxY <= paneRect.bottom + 1,
      };
    }
    return out;
  });
}

// Tap the closet stack and report whether the TAPPED wall's label is the
// one showing afterwards. PlanCanvas hit-tests walls in reverse design
// order, so a click on the stack selects the last-created (topmost) of
// the three 12"-apart verticals — click that line, not the middle one.
// A label sits a few px to the side of its wall (the dimension offset),
// so the expected center is clickedLineX + delta, where delta is read
// off the before state (visible label center minus its wall's line x).
// In the fixed state the unselected stack shows one label; after the tap
// exactly that wall's label must be the one showing.
async function measureDesignerSelection(page) {
  const before = await measureDesigner(page);
  const beforeCenters = before.labels.filter((l) => l.text === '192"').map((l) => Math.round((l.rect.left + l.rect.right) / 2));
  const pt = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="designer-pane"]');
    const svg = pane ? pane.querySelector("svg") : null;
    if (!svg) return null;
    const lines = [...svg.querySelectorAll("line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === "#e5e7eb");
    const verticals = lines
      .filter((l) => Math.abs(+l.getAttribute("x2") - +l.getAttribute("x1")) < 1)
      .map((l) => ({ x: +l.getAttribute("x1"), y1: +l.getAttribute("y1"), y2: +l.getAttribute("y2") }))
      .sort((a, b) => a.x - b.x);
    // The closet stack: three consecutive verticals spanning < 60 SVG px
    // (24 plan inches; the span grows with the fit scale — 8px at 360,
    // 50px at 1919 — so a fixed 15px threshold misses it at 768/1919).
    for (let i = 0; i + 2 < verticals.length; i += 1) {
      if (verticals[i + 2].x - verticals[i].x < 60) {
        const last = verticals[i + 2];
        const r = svg.getBoundingClientRect();
        return { x: r.left + last.x, y: r.top + (last.y1 + last.y2) / 2, lineX: Math.round(r.left + last.x), stackXs: [verticals[i], verticals[i + 1], verticals[i + 2]].map((v) => Math.round(r.left + v.x)) };
      }
    }
    return null;
  });
  if (!pt) return { clicked: false, reason: "closet stack not found", beforeCenters };
  // Label offset from its wall, in screen px: the dimension offset is
  // 16.3 plan inches past the wall face (dimensionGeometry: wall
  // thickness/2 + 14) plus the ~4.2px rotation shift of a 12px label's
  // glyph box about its anchor. The line spacing is 12 plan inches, so
  // the scale falls out of the measured spacing — no hardcoded scale.
  const spacing = pt.stackXs[1] - pt.stackXs[0];
  const delta = 4.2 + (16.3 / 12) * spacing;
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(400);
  const after = await measureDesigner(page);
  const afterCenters = after.labels.filter((l) => l.text === '192"').map((l) => Math.round((l.rect.left + l.rect.right) / 2));
  const expectedCenter = delta === null ? pt.lineX : pt.lineX + delta;
  return {
    clicked: true,
    clickedLineX: pt.lineX,
    labelOffsetPx: delta,
    beforeCenters,
    afterCenters,
    expectedCenter,
    selectedLabelShown: afterCenters.some((cx) => Math.abs(cx - expectedCenter) <= 3),
  };
}

async function measureHeader(page, triggerText) {
  return page.evaluate((trigger) => {
    const header = document.querySelector("header");
    if (!header) return { headerPresent: false };
    const controls = [...header.querySelectorAll("button, a[href]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), visible: r.width > 0 && r.height > 0 };
    });
    const triggerEl = [...header.querySelectorAll("button")].find((b) => (b.textContent || "").includes(trigger));
    const triggerRect = triggerEl ? triggerEl.getBoundingClientRect() : null;
    return {
      headerPresent: true,
      controls,
      triggerVisible: triggerRect ? triggerRect.left >= -1 && triggerRect.right <= window.innerWidth + 1 && triggerRect.width > 0 : false,
      triggerRect: triggerRect ? { left: Math.round(triggerRect.left), right: Math.round(triggerRect.right) } : null,
    };
  }, triggerText);
}

async function measureWorkHeader(page) {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll("main a[href]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || "").trim(), href: el.getAttribute("href"), left: Math.round(r.left), right: Math.round(r.right), visible: r.width > 0 };
    });
    const h1 = document.querySelector("main h1");
    const h1Rect = h1 ? h1.getBoundingClientRect() : null;
    return {
      links,
      headingVisible: h1Rect ? h1Rect.left >= -1 && h1Rect.right <= window.innerWidth + 1 : false,
      allLinksVisible: links.length === 3 && links.every((l) => l.left >= -1 && l.right <= window.innerWidth + 1),
    };
  });
}

async function measureRental(page) {
  return page.evaluate(() => {
    const overview = document.querySelector("[data-rental-overview]");
    const metricsEl = [...document.querySelectorAll("span")].find((s) => /units? · \d+% occupied/.test(s.textContent || ""));
    const metricsRect = metricsEl ? metricsEl.getBoundingClientRect() : null;
    const strip = document.querySelector("[data-portfolio-strip]");
    const circles = strip ? strip.querySelectorAll(":scope > span").length : 0;
    const overflowMarker = strip ? [...strip.querySelectorAll(":scope > span")].map((s) => s.textContent.trim()).find((t) => /^\+\d+$/.test(t)) || null : null;
    const billing = document.querySelector("[data-billing-status]");
    const billingRect = billing ? billing.getBoundingClientRect() : null;
    return {
      metricsText: metricsEl ? metricsEl.textContent.trim() : null,
      metricsVisible: metricsRect ? metricsRect.left >= -1 && metricsRect.right <= window.innerWidth + 1 : false,
      metricsClipped: metricsEl ? metricsEl.scrollWidth > metricsEl.clientWidth + 1 : null,
      stripCircles: circles,
      overflowMarker,
      billingStatus: billing ? billing.getAttribute("data-billing-status") : null,
      billingVisible: billingRect ? billingRect.left >= -1 && billingRect.right <= window.innerWidth + 1 : false,
      overviewPresent: !!overview,
    };
  });
}

async function waitForServer(port, timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${port}/phone-fixture?case=designer`);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${port} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  let server = null;
  if (!keepServer) {
    server = spawn("npm", ["run", "dev", "--", "-p", String(port)], { cwd: WORKTREE, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    await waitForServer(port);
  }
  const browser = await chromium.launch();
  const results = { tag, base: BASE, at: new Date().toISOString(), checks: [], failures: [] };
  try {
    for (const c of CASES) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        // Jason's phone shows inch-only dimension labels (144", 216", ...),
        // which is the localStorage display-units preference — set it before
        // the page loads so the fixture renders what he actually saw.
        await page.addInitScript(() => {
          try { window.localStorage.setItem("forge-designer-display-units", "in"); } catch { /* ignore */ }
        });
        const url = `${BASE}?case=${c}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 60000 });
        await page.waitForTimeout(800); // let the open-time auto-fit settle
        const check = { case: c, width, url };
        check.page = await measurePage(page);
        if (c === "designer") {
          check.designer = await measureDesigner(page);
          check.designerSelection = await measureDesignerSelection(page);
        } else if (c === "work-header") {
          check.workHeader = await measureWorkHeader(page);
        } else if (c === "app-header") {
          check.header = await measureHeader(page, "Apps");
        } else if (c === "forge-header") {
          check.header = await measureHeader(page, "Applications");
        } else if (c === "rental-23") {
          check.rental = await measureRental(page);
        }
        const shot = path.join(OUT, `${tag}-${c}-${width}.png`);
        await page.screenshot({ path: shot });
        check.screenshot = shot;
        // ---- verdicts for this check ----
        const fail = (msg) => results.failures.push(`${c}@${width}: ${msg}`);
        if (check.page.pageOverflow) fail(`page overflow scrollWidth=${check.page.scrollWidth} > innerWidth=${check.page.innerWidth}`);
        if (check.page.outOfViewportCount > 0) fail(`${check.page.outOfViewportCount} controls outside viewport: ${JSON.stringify(check.page.outOfViewportControls)}`);
        if (c === "designer" && check.designer) {
          const d = check.designer;
          // Desktop (1919) is a NO-REGRESSION comparison, not a zero-defect
          // one: the slice is phone-only, and the desktop deck-label x
          // 720" intersection pre-exists there (the selector never runs on
          // a desktop pane, by design). Only failures NEW vs the before
          // run count at 1919.
          let newIntersections = d.intersections;
          let newOutside = d.outsidePane;
          if (width === 1919 && tag === "after") {
            const before = loadBeforeDesigner(1919);
            if (before) {
              const beforePairs = new Set(before.intersections.map((p) => JSON.stringify([...p].sort())));
              newIntersections = d.intersections.filter((p) => !beforePairs.has(JSON.stringify([...p].sort())));
              const beforeOutside = new Set(before.outsidePane);
              newOutside = d.outsidePane.filter((t) => !beforeOutside.has(t));
            }
          }
          if (newIntersections.length) fail(`label intersections: ${JSON.stringify(newIntersections)}`);
          if (newOutside.length) fail(`labels outside pane: ${JSON.stringify(newOutside)}`);
          if (d.fit) {
            if (!d.fit.insidePane) fail("structural plan extends outside the pane");
            const limiting = Math.max(d.fit.widthCoverage, d.fit.heightCoverage);
            if (limiting < 0.5) fail(`fit covers only ${limiting} of the limiting axis (< 0.5)`);
          } else {
            fail("no fit measurement (no wall lines found)");
          }
          if (!check.designerSelection.selectedLabelShown) fail(`tap-a-wall did not reveal the selected wall's label: ${JSON.stringify(check.designerSelection)}`);
        }
        if (c === "work-header" && check.workHeader && !check.workHeader.allLinksVisible) fail(`header links not all visible: ${JSON.stringify(check.workHeader.links)}`);
        if ((c === "app-header" || c === "forge-header") && check.header) {
          const anyVisible = check.header.controls.some((ctl) => ctl.visible);
          // The mobile header is lg:hidden: at 1919 it is not rendered at
          // all (every control zero-size). That is the desktop layout, not
          // a failure — only check the trigger where the header exists.
          if (anyVisible && !check.header.triggerVisible) fail(`header trigger not visible: ${JSON.stringify(check.header)}`);
        }
        if (c === "rental-23" && check.rental) {
          const r = check.rental;
          if (!r.metricsVisible || r.metricsClipped) fail(`rental metrics not fully visible: ${JSON.stringify(r)}`);
          if (r.stripCircles !== 8 || r.overflowMarker !== "+16") fail(`rental strip wrong: circles=${r.stripCircles} marker=${r.overflowMarker}`);
          if (r.billingStatus !== "active" || !r.billingVisible) fail(`rental billing not Active/visible: ${JSON.stringify(r)}`);
        }
        results.checks.push(check);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
  const outFile = path.join(OUT, `results-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`wrote ${outFile}: ${results.checks.length} checks, ${results.failures.length} failures`);
  for (const f of results.failures) console.log(`FAIL ${f}`);
  process.exit(results.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
