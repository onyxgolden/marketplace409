// Phone Slice 5 geometry harness — real Chromium via Playwright.
//
// Usage:
//   node scripts/phone-layout-geometry-check.mjs --tag before|after [--port 3100]
//     [--widths 360,390,400,412,430,768,1919] [--cases designer,fccu,room-designs,work-header,app-header,forge-header,rental-23,projects-list]
//     [--out <evidence-dir>] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server, which
// assumes one is already running on --port), renders the real components in
// /phone-fixture at each viewport width, and measures:
//   - documentElement.scrollWidth <= innerWidth + 1 (page-level overflow)
//   - every button/input/select/link fully inside the viewport
//   - designer: every rendered SVG dimension/deck text's screen rect
//     (via getBBox + getScreenCTM) — zero pairwise intersections, zero
//     outside the visible 2D pane; structural fit coverage of the
//     limiting axis; and tap-a-wall -> the selected wall's label appears
//   - fccu: the provenance-verified REAL FCCU Plot Plan
//     (design_mwjvt635_lmexii, 91 pipes / 91 symbols / 21 equipment) —
//     EVERY rendered SVG text classified by data-label-kind with 4-corner
//     getScreenCTM AABBs; zero intersections among eligible industrial
//     labels, zero outside the pane at whole-plot fit (containment is a
//     fit-state rule only — at zoom the pane is a window into a larger
//     plan, so zoomed labels outside the pane are expected, not a
//     failure), a non-empty bounded equipment-tag set at whole-plot fit,
//     tap-an-exchanger/a-pipe/a-flare selection proofs (overview tags
//     are the tap target: tapping a tag selects its equipment), a
//     second zoomed scale near the tag-gate transition, and a read-only
//     (no non-GET requests, excluding Next dev's own stack-frame
//     reporter) check. Ruler/HUD texts are excluded by semantic
//     classification and reported, never counted.
//   - room-designs: the real ProjectsList — subtitle fully wrapped and
//     visible, input + New design button fully inside the viewport, form
//     stacked below sm / row at sm+, no page overflow
//   - work-header: Document library / Admin / New package fully visible
//   - app-header / forge-header: Apps / Applications always visible, all
//     header controls inside the viewport
//   - rental-23: Slice 2 regression guard (7 icons + +16, metrics line,
//     billing Active)
//   - projects-list: Slice 3 guard — the REAL ProjectsScreen (Scheduling
//     Projects list) with a fixture list seeded into the SWR cache; the
//     guard also intercepts /api/forge/scheduling (GET only) as a
//     backstop. At phone widths (<640px) the stacked cards must show
//     every name and FULL start/finish date with an Open link inside the
//     viewport and the desktop table must be hidden; at 640px and up the
//     table must show with all six columns and the cards must be hidden.
//     September dates (longest month name) prove full-date rendering.
//
// Portability (fix round 1): the repository root is resolved from this
// file's own location (import.meta.url) and validated against the
// marketplace409 package.json — Playwright is imported from the
// project-declared dependency and the dev server is launched with cwd set
// to this exact checkout, so the script tests the checkout it lives in
// from any clone, worktree, or CI machine. No absolute builder paths.
//
// Writes screenshots + results JSON to --out (default
// <repo>/.phone-layout-evidence/, git-ignored). Receipts embed the exact
// tested HEAD SHA, the widths/cases run, and the Chromium version.
//
// Desktop (1919px) is a NO-REGRESSION comparison against the TRACKED
// baseline in scripts/phone-layout-geometry-baseline.json — not an
// external before-run file. The baseline records the intersections and
// outside-pane labels measured on the slice-5 fixture plan at base
// 438a02e0 AND at the slice head; both measured zero, so the allowlist
// is deliberately empty and ANY 1919px intersection is a new defect
// that fails the guard. A missing or unreadable baseline is a hard
// error (exit 2), never a silent pass or a spurious geometry failure;
// an allowlist entry that no longer occurs only warns.
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
      `phone-layout-geometry-check: no package.json at ${pkgPath} — run from a marketplace409 checkout`
    );
  }
  if (pkg.name !== "marketplace409") {
    throw new Error(
      `phone-layout-geometry-check: ${pkgPath} is not the marketplace409 app (name=${pkg.name}) — refusing to test the wrong checkout`
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

// --- Tracked 1919px desktop baseline (see the JSON file for the measured
// provenance). Loaded once at startup: a missing/stale baseline must never
// make a routine correct PR check fail spuriously or be silently accepted,
// so a missing or malformed baseline is a hard error here, not a geometry
// verdict.
const BASELINE_PATH = path.join(SCRIPT_DIR, "phone-layout-geometry-baseline.json");
function loadDesktopBaseline() {
  let raw;
  try {
    raw = fs.readFileSync(BASELINE_PATH, "utf8");
  } catch {
    throw new Error(
      `phone-layout-geometry-check: tracked desktop baseline missing at ${BASELINE_PATH} — ` +
        `refusing to evaluate 1919px without it (a missing baseline must not silently pass ` +
        `or spuriously fail the desktop comparison)`
    );
  }
  let baseline;
  try {
    baseline = JSON.parse(raw);
  } catch (err) {
    throw new Error(`phone-layout-geometry-check: baseline ${BASELINE_PATH} is not valid JSON: ${err.message}`);
  }
  if (baseline.version !== 1 || baseline.case !== "designer" || baseline.width !== 1919) {
    throw new Error(
      `phone-layout-geometry-check: baseline ${BASELINE_PATH} has unexpected shape ` +
        `(want version 1, case "designer", width 1919)`
    );
  }
  if (!Array.isArray(baseline.expectedIntersections) || !Array.isArray(baseline.expectedOutsidePane)) {
    throw new Error(`phone-layout-geometry-check: baseline ${BASELINE_PATH} lacks expectedIntersections/expectedOutsidePane arrays`);
  }
  return baseline;
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
const outArg = argVal("--out", undefined);
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture`;

const WIDTHS = widthsArg ? widthsArg.split(",").map(Number) : [360, 390, 400, 412, 430, 768, 1919];
const CASES = casesArg ? casesArg.split(",") : ["designer", "fccu", "room-designs", "work-header", "app-header", "forge-header", "rental-23", "projects-list"];

// Evidence goes under the repo by default (git-ignored), or wherever
// --out points. Never a hardcoded builder path.
const OUT = outArg ? path.resolve(outArg) : path.join(ROOT, ".phone-layout-evidence");

const BASELINE = loadDesktopBaseline();

// --- FCCU provenance manifest (Phone Slice 5 follow-up): the guard
// independently checks the fixture's runtime SHA + counts against this
// tracked manifest — a mutated snapshot or manifest fails here even if
// the loader's own check were bypassed. A missing manifest is a hard
// error, never a silent pass.
const FCCU_MANIFEST_PATH = path.join(ROOT, "src", "app", "phone-fixture", "fccu-provenance.json");
let FCCU_MANIFEST = null;
try {
  FCCU_MANIFEST = JSON.parse(fs.readFileSync(FCCU_MANIFEST_PATH, "utf8"));
} catch (err) {
  throw new Error(
    `phone-layout-geometry-check: FCCU provenance manifest missing/unreadable at ${FCCU_MANIFEST_PATH}: ${err.message} — ` +
      `the fccu case cannot run without it (a missing manifest must not silently pass)`
  );
}
if (!FCCU_MANIFEST.levelDesignSha256 || !FCCU_MANIFEST.counts || FCCU_MANIFEST.sourceProjectId !== "design_mwjvt635_lmexii") {
  throw new Error(`phone-layout-geometry-check: FCCU manifest at ${FCCU_MANIFEST_PATH} has unexpected shape (want levelDesignSha256, counts, sourceProjectId design_mwjvt635_lmexii)`);
}

// Tier lists for the label-layout engine (brief §2 — mirror of
// src/domains/roomDesigner/fccuLabelTierOverrides.js). Checked by
// TEXT, not by data-tier, so the same assertions fail on the old
// overview rendering (which carries no tier attribute) as on the
// engine: the fail-before run must trip them on the unmodified base.
const FCCU_TIER_1 = ["R-101", "R-102", "T-101", "T-102", "E-101", "E-102", "E-103", "E-104", "K-101", "K-102", "V-101", "V-102", "P-101", "FL-101"];
const FCCU_TIER_2 = ["P-102", "P-103", "P-104", "P-105", "P-106", "PR-101", "SL-101"];

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

// --- Projects-list case (Phone Slice 3) ---
// Renders the real ProjectsScreen with the fixture list (seeded into the
// SWR cache by the fixture page; the guard's route intercept below is the
// backstop). Measures: at phone widths the stacked cards show every name
// and FULL start/finish date with an Open link inside the viewport and
// the desktop table is hidden; at 640px and up the table shows with all
// six columns and the cards are hidden.
async function measureProjectsList(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const visible = (el) => {
      if (!el) return false;
      if (window.getComputedStyle(el).display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const cardsRoot = document.querySelector("[data-projects-cards]");
    const cards = [...document.querySelectorAll("[data-project-card]")].map((card) => {
      const name = card.querySelector("h2");
      const start = card.querySelector("[data-project-start]");
      const finish = card.querySelector("[data-project-finish]");
      const open = [...card.querySelectorAll("a")].find((a) => (a.textContent || "").trim() === "Open");
      const del = card.querySelector('button[title="Delete project"]');
      const badge = [...card.querySelectorAll("span")].find((s) => (s.textContent || "").trim() === "SHARED EXAMPLE");
      return {
        name: name ? name.textContent.trim() : null,
        start: start ? start.textContent.trim() : null,
        startRect: rect(start),
        startClipped: start ? start.scrollWidth > start.clientWidth + 1 : null,
        finish: finish ? finish.textContent.trim() : null,
        finishRect: rect(finish),
        finishClipped: finish ? finish.scrollWidth > finish.clientWidth + 1 : null,
        openRect: rect(open),
        openHref: open ? open.getAttribute("href") : null,
        hasDelete: !!del,
        hasBadge: !!badge,
        visible: visible(card),
      };
    });
    const table = document.querySelector("[data-scheduling-projects] table");
    const headers = table ? [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim()) : [];
    const rows = table ? [...table.querySelectorAll("tbody tr")].length : 0;
    return {
      cardsVisible: cardsRoot ? visible(cardsRoot) : false,
      cards,
      tablePresent: !!table,
      tableVisible: table ? visible(table) : false,
      tableHeaders: headers,
      tableRows: rows,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

// --- FCCU case (Phone Slice 5 follow-up) ---
//
// The merged Slice 5 guard measured only the synthetic small-house
// designer plan, so it could not see the real FCCU Plot Plan's label
// pile. The fccu case renders the provenance-verified real design
// (design_mwjvt635_lmexii, 91 pipes / 91 symbols / 21 equipment) through
// the actual PlanCanvas + renderSymbol2D paths and measures EVERY
// rendered SVG text with getBBox + per-element getScreenCTM, all four
// bbox corners — classified by the stable data-label-kind annotation
// (never a fill/font allowlist). Ruler ticks (ancestor [data-ruler]) and
// the crosshair HUD (ancestor [data-hud]) are excluded by explicit
// semantic classification; a text with no classification at all fails
// the guard rather than being silently ignored.
//
// Eligible industrial labels (intersections + containment apply):
// equipment-tag, symbol-tag, symbol-caption, pipe-label, annotation,
// room-label, room-area, wall-label, deck-label, sheet-label,
// symbol-glyph-letter. Excluded (reported, never counted):
// ruler, hud, selection-hint, org-chart-label.
//
// An empty eligible set is NOT a pass: at whole-plot fit at least one
// short equipment tag must render, and the selection proofs must expose
// full identity for a crowded exchanger, a pipe, and a noncrowded
// equipment object. Hidden/accepted counts are reported per category
// against the provenance counts (data-fccu-counts on the fixture root).
async function measureFccu(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="designer-fixture"]');
    const pane = document.querySelector('[data-testid="designer-pane"]');
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    const svg = pane ? pane.querySelector("svg") : null;
    const out = {
      fccuState: root ? root.getAttribute("data-fccu-state") : null,
      errorText: null,
      sha: root ? root.getAttribute("data-fccu-sha") : null,
      counts: null,
      engineActive: !!document.querySelector('[data-testid="label-engine-controls"]'),
      paneRect: paneRect ? { left: Math.round(paneRect.left), top: Math.round(paneRect.top), width: Math.round(paneRect.width), height: Math.round(paneRect.height) } : null,
      scale: null,
      texts: [],
      countsByKind: {},
      eligible: [],
      intersections: [],
      outsidePane: [],
      excluded: [],
      unclassified: [],
      fit: null,
    };
    try { out.counts = root ? JSON.parse(root.getAttribute("data-fccu-counts") || "null") : null; } catch { out.counts = null; }
    if (out.fccuState === "error") {
      const main = document.querySelector("main");
      out.errorText = main ? main.textContent.trim().slice(0, 500) : "provenance error (no message)";
    }
    if (!svg) return out;
    const toScreen = (el, x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    };
    // View scale from the TOP ruler only (left-ruler labels share the
    // same fill/size but sit at x≈3 with unrelated values — mixing them
    // drags the median to 0). Top strip: y < 24, left of the corner box.
    const rulerLabels = [...svg.querySelectorAll("text")].filter((t) => {
      if (t.getAttribute("font-size") !== "9") return false;
      if (!/^-?\d+′$/.test((t.textContent || "").trim())) return false;
      const r = t.getBoundingClientRect();
      return r.top < 24 && r.left > 30;
    }).map((t) => ({ v: parseInt(t.textContent, 10), x: t.getBoundingClientRect().left }))
      .filter((p) => Number.isFinite(p.v))
      .sort((a, b) => a.x - b.x);
    const gaps = [];
    for (let i = 1; i < rulerLabels.length; i += 1) {
      if (rulerLabels[i].v > rulerLabels[i - 1].v) {
        gaps.push((rulerLabels[i].x - rulerLabels[i - 1].x) / ((rulerLabels[i].v - rulerLabels[i - 1].v) * 12));
      }
    }
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      out.scale = +gaps[Math.floor(gaps.length / 2)].toFixed(4);
    }
    const ELIGIBLE = new Set(["equipment-tag", "symbol-tag", "symbol-caption", "pipe-label", "annotation", "room-label", "room-area", "wall-label", "deck-label", "sheet-label", "symbol-glyph-letter"]);
    const EXCLUDED = new Set(["ruler", "hud", "selection-hint", "org-chart-label"]);
    for (const t of svg.querySelectorAll("text")) {
      const bb = t.getBBox();
      if (bb.width === 0 && bb.height === 0) continue;
      const corners = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => toScreen(t, x, y));
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const text = (t.textContent || "").trim();
      let kind = t.getAttribute("data-label-kind") || null;
      if (!kind) {
        if (t.closest("[data-ruler]")) kind = "ruler";
        else if (t.closest("[data-hud]")) kind = "hud";
        else kind = "unclassified";
      }
      const entry = {
        text: text.slice(0, 60),
        kind,
        symbolId: t.getAttribute("data-symbol-id") || null,
        tier: t.getAttribute("data-tier") || null,
        fontSize: t.getAttribute("font-size") || null,
        rect: { left: Math.round(Math.min(...xs)), top: Math.round(Math.min(...ys)), right: Math.round(Math.max(...xs)), bottom: Math.round(Math.max(...ys)) },
      };
      out.texts.push(entry);
      out.countsByKind[kind] = (out.countsByKind[kind] || 0) + 1;
      if (ELIGIBLE.has(kind)) out.eligible.push(entry);
      else if (EXCLUDED.has(kind)) out.excluded.push(entry);
      else out.unclassified.push(entry);
    }
    for (let i = 0; i < out.eligible.length; i += 1) {
      for (let j = i + 1; j < out.eligible.length; j += 1) {
        const a = out.eligible[i].rect;
        const b = out.eligible[j].rect;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          out.intersections.push([out.eligible[i].text, out.eligible[j].text]);
        }
      }
      const r = out.eligible[i].rect;
      if (paneRect && (r.left < paneRect.left - 1 || r.right > paneRect.right + 1 || r.top < paneRect.top - 1 || r.bottom > paneRect.bottom + 1)) {
        out.outsidePane.push(out.eligible[i].text);
      }
    }
    // Structural fit: room polygons + pipe polylines must sit inside the
    // pane and cover at least half of the limiting axis. Every point is
    // transformed by its own element's getScreenCTM: pipe/room points
    // are already screen coords, but glyph polygons (reducers, rack
    // members) live in a transformed <g> frame, so adding the raw local
    // coords to the svg offset would fabricate a bbox far outside the
    // pane.
    const pts = [];
    for (const poly of svg.querySelectorAll("polygon, polyline")) {
      const raw = poly.getAttribute("points") || "";
      const ctm = poly.getScreenCTM();
      if (!ctm) continue;
      for (const pair of raw.trim().split(/\s+/)) {
        const [x, y] = pair.split(",").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const p = new DOMPoint(x, y).matrixTransform(ctm);
          pts.push([p.x, p.y]);
        }
      }
    }
    if (pts.length && paneRect) {
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs);
      const minY = Math.min(...ys); const maxY = Math.max(...ys);
      out.fit = {
        structuralPx: { width: Math.round(maxX - minX), height: Math.round(maxY - minY) },
        panePx: { width: Math.round(paneRect.width), height: Math.round(paneRect.height) },
        widthCoverage: +((maxX - minX) / Math.max(1, paneRect.width - 48)).toFixed(3),
        heightCoverage: +((maxY - minY) / Math.max(1, paneRect.height - 48)).toFixed(3),
        insidePane: minX >= paneRect.left - 1 && maxX <= paneRect.right + 1 && minY >= paneRect.top - 1 && maxY <= paneRect.bottom + 1,
      };
    }
    return out;
  });
}

// Tap three objects in the crowded FCCU plot and prove the read-only
// selection disclosure identifies each one exactly: a crowded exchanger
// (E-101, via its tag), a pipe (longest polyline segment midpoint,
// chosen far from any rendered tag), and a noncrowded equipment object
// (FL-101, isolated at the far right — via its tag when rendered, or
// via the Hidden labels Find button when the engine withholds it at
// the dense 360px fit, which also proves the recovery path).
// Returns the disclosure text after each tap.
async function measureFccuSelection(page) {
  const tapTargets = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="designer-pane"]');
    const svg = pane ? pane.querySelector("svg") : null;
    if (!svg) return null;
    const tagRect = (label) => {
      const t = [...svg.querySelectorAll('text[data-label-kind="equipment-tag"]')].find((el) => (el.textContent || "").trim() === label);
      if (!t) return null;
      const r = t.getBoundingClientRect();
      // Engine tags are themselves the touch target (PlanCanvas
      // dispatches SELECT from the tag's pointerdown), so click the
      // tag centre — never a point below it, where the 1-2px glyph
      // underneath would be missed and a pipe hit instead.
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tagRect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } };
    };
    // Pipe targets: midpoints of the longest polyline segments that
    // stay clear of every rendered overview tag (symbols are hit-tested
    // before pipes, so a midpoint under a tag would select the symbol).
    // Keep the top 5 by clearance: a midpoint can still land inside a
    // small symbol footprint (e.g. a hydrant), so the caller retries
    // until one tap actually reveals a pipe.
    const tagCenters = [...svg.querySelectorAll('text[data-label-kind="equipment-tag"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const svgRect = svg.getBoundingClientRect();
    const pipeCandidates = [];
    for (const poly of svg.querySelectorAll("polyline")) {
      const raw = (poly.getAttribute("points") || "").trim().split(/\s+/).map((pair) => pair.split(",").map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      for (let i = 1; i < raw.length; i += 1) {
        const mx = svgRect.left + (raw[i - 1][0] + raw[i][0]) / 2;
        const my = svgRect.top + (raw[i - 1][1] + raw[i][1]) / 2;
        const len = Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
        const clearance = Math.min(...tagCenters.map((c) => Math.hypot(mx - c.x, my - c.y)));
        pipeCandidates.push({ x: mx, y: my, len, clearance });
      }
    }
    pipeCandidates.sort((a, b) => b.clearance - a.clearance);
    const bestPipe = pipeCandidates.slice(0, 5).map((p) => ({ x: p.x, y: p.y, clearance: Math.round(p.clearance) }));
    return { exchanger: tagRect("E-101"), flare: tagRect("FL-101"), pipe: bestPipe.length ? bestPipe : null };
  });
  if (!tapTargets) return { tapped: false, reason: "no svg" };
  const result = { tapped: true, targets: tapTargets, disclosures: {} };
  const readDisclosure = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="fccu-selection-detail"]');
    return el ? el.textContent.trim() : null;
  });
  // Exchanger: tap its rendered tag.
  if (!tapTargets.exchanger) result.disclosures.exchanger = null;
  else {
    await page.mouse.click(tapTargets.exchanger.x, tapTargets.exchanger.y);
    await page.waitForTimeout(400);
    result.disclosures.exchanger = await readDisclosure();
  }
  // Pipe: retry candidate midpoints until one reveals a pipe identity
  // (a midpoint inside a small symbol footprint selects the symbol).
  // Runs BEFORE the flare fallback: a Find jump pans the view, which
  // would stale these fit-state coordinates.
  result.disclosures.pipe = null;
  for (const pt of tapTargets.pipe || []) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(400);
    const d = await readDisclosure();
    if (d && d.startsWith("Pipe fccu_pipe_")) { result.disclosures.pipe = d; break; }
    result.disclosures.pipe = d;
  }
  // Flare: tap its tag when rendered; when the engine withholds it
  // (the dense 360px fit), recover it through the Hidden labels Find
  // button — the designed recovery path for a withheld label — which
  // selects it and jumps the view to it. Runs last: the jump pans the
  // view, and nothing after it depends on fit-state coordinates.
  if (tapTargets.flare) {
    await page.mouse.click(tapTargets.flare.x, tapTargets.flare.y);
    await page.waitForTimeout(400);
    result.disclosures.flare = await readDisclosure();
  } else {
    const clicked = await page.evaluate(() => {
      const controls = document.querySelector('[data-testid="label-engine-controls"]');
      if (!controls) return false;
      const details = controls.querySelector("details");
      if (details && !details.open) {
        const summary = details.querySelector("summary");
        if (summary) summary.click();
      }
      const row = [...controls.querySelectorAll("details li")].find((li) => (li.textContent || "").includes("FL-101"));
      if (!row) return false;
      const btn = row.querySelector("button");
      if (!btn) return false;
      btn.click();
      return true;
    });
    await page.waitForTimeout(400);
    result.disclosures.flare = clicked ? await readDisclosure() : null;
    result.flareRecoveredViaFind = clicked;
    // Close the disclosure again: the open panel is 256px wide on a
    // ~300px pane and covers the pane centre, so it would swallow the
    // zoom-state wheel events (a scrollable element eats the wheel)
    // and the zoom states would measure z=1 forever.
    if (clicked) {
      await page.evaluate(() => {
        const details = document.querySelector('[data-testid="label-engine-controls"] details');
        if (details && details.open) {
          const summary = details.querySelector("summary");
          if (summary) summary.click();
        }
      });
      await page.waitForTimeout(200);
    }
  }
  return result;
}

// Whole-plot-fit assertions for the label engine (brief §7). Checked
// by TEXT against the tier lists so they fail on the old overview
// rendering too (fail-before). Gated on the PANE being phone-width
// (<768px) — the engine's own activation condition for an industrial
// design — NOT on the engine control being present: on the unmodified
// base the control does not exist, and gating on it would let the base
// pass these assertions vacuously. At 1919 the pane is wide, so the
// desktop in-glyph inventory stays the baseline there.
function assertFccuEngineFit(f, width, fail, warn, label) {
  if (!(f.paneRect && f.paneRect.width < 768)) return;
  const eqTags = f.texts.filter((t) => t.kind === "equipment-tag");
  const tier1Shown = FCCU_TIER_1.filter((tag) => eqTags.some((t) => t.text === tag));
  const tier1Withheld = FCCU_TIER_1.length - tier1Shown.length;
  // Brief §7 binds the ≤4-withheld rule at 390/400; other phone
  // widths are reported as warnings so a denser 360px fit does not
  // fail the run on a width the brief does not bind.
  if (width === 390 || width === 400) {
    if (tier1Withheld > 4) fail(`${label}: ${tier1Withheld} Tier 1 labels withheld at fit (max 4): ${JSON.stringify(FCCU_TIER_1.filter((tag) => !eqTags.some((t) => t.text === tag)))}`);
  } else if (tier1Withheld > 4) {
    warn(`${label}: ${tier1Withheld} Tier 1 labels withheld at fit at ${width}px (brief binds ≤4 at 390/400 only)`);
  }
  const tier2Shown = eqTags.filter((t) => FCCU_TIER_2.includes(t.text)).map((t) => t.text);
  if (tier2Shown.length) fail(`${label}: Tier 2 tags render at fit (Tier 1 only below 1.5x): ${JSON.stringify(tier2Shown)}`);
  for (const kind of ["pipe-label", "annotation", "room-label", "room-area", "symbol-caption"]) {
    if ((f.countsByKind[kind] || 0) > 0) fail(`${label}: Tier 3 ${kind} renders at fit (${f.countsByKind[kind]} shown)`);
  }
  const small = eqTags.filter((t) => t.fontSize !== null && Number(t.fontSize) < 12).map((t) => `${t.text}@${t.fontSize}px`);
  if (small.length) fail(`${label}: equipment tags below the 12px Tier 1 minimum at fit: ${JSON.stringify(small)}`);
  // Only ROUTINE-rendered in-glyph tags count here: the engine itself
  // renders piping tags as symbol-tag (with data-tier) at Tier 3, so
  // a bare kind count would false-positive at 2.5x. Routine tags carry
  // no data-tier attribute.
  const routineSymbolTags = f.texts.filter((t) => t.kind === "symbol-tag" && !t.tier).length;
  if (routineSymbolTags > 0) fail(`${label}: in-glyph symbol-tags still render at fit — the engine owns every equipment tag (got ${routineSymbolTags})`);
}

// Zoom states for the label-layout engine (brief §7): from whole-plot
// fit, wheel-zoom to the 1.5x reveal (Tier 2 in, Tier 3 out), the 2.5x
// reveal (pipe dimensions in), an ~8x exchanger close-up, then pan and
// re-measure, then return to fit. Targets are RELATIVE to the measured
// fit scale (each wheel step is 1.12x, so 1.5x lands at ~1.57x, 2.5x at
// ~2.77x, 8x at ~8.6x). The close-up is centred on the pane centre,
// which is the plot centre — where the E-101..E-104 cluster sits.
async function measureFccuZoomStates(page, fitScale) {
  const paneBox = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="designer-pane"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const zOf = (m) => (fitScale && m.scale ? +(m.scale / fitScale).toFixed(2) : null);
  const wheelTo = async (targetZ, maxSteps = 24) => {
    let m = await measureFccu(page);
    for (let step = 0; step < maxSteps; step += 1) {
      if (m.scale && fitScale && m.scale / fitScale >= targetZ) return m;
      await page.mouse.move(paneBox.x, paneBox.y);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(350);
      m = await measureFccu(page);
    }
    return m;
  };
  const stableCheck = async (m) => {
    await page.waitForTimeout(400);
    const again = await measureFccu(page);
    return {
      stable: JSON.stringify(m.eligible.map((t) => t.text).sort()) === JSON.stringify(again.eligible.map((t) => t.text).sort()),
      second: again,
    };
  };
  const states = {};
  const reveal15 = await wheelTo(1.5);
  states.reveal15 = { ...reveal15, z: zOf(reveal15), ...(await stableCheck(reveal15)) };
  const reveal25 = await wheelTo(2.5);
  states.reveal25 = { ...reveal25, z: zOf(reveal25), ...(await stableCheck(reveal25)) };
  const closeup = await wheelTo(8);
  states.closeup = { ...closeup, z: zOf(closeup), ...(await stableCheck(closeup)) };
  // Pan then re-measure: drag from a pane corner and confirm the view
  // actually moved (a label rect shifts) before re-measuring. A
  // left-button drag with the select tool does NOT pan (PlanCanvas only
  // starts a pan drag on middle button / pan tool / spacebar), so the
  // guard drags with the middle button — the pan gesture itself.
  const beforePan = await measureFccu(page);
  const beforeRect = beforePan.eligible[0] ? beforePan.eligible[0].rect : null;
  await page.mouse.move(paneBox.left + 24, paneBox.top + 24);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(paneBox.left + 104, paneBox.top + 64, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(400);
  const afterPan = await measureFccu(page);
  const afterRect = afterPan.eligible[0] ? afterPan.eligible[0].rect : null;
  states.pan = {
    ...afterPan,
    moved: !!(beforeRect && afterRect && (Math.abs(beforeRect.left - afterRect.left) > 2 || Math.abs(beforeRect.top - afterRect.top) > 2)),
    ...(await stableCheck(afterPan)),
  };
  // Return to fit: reload and let the open-time auto-fit settle.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 60000 });
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-fccu-state]");
    return el && (el.getAttribute("data-fccu-state") === "ready" || el.getAttribute("data-fccu-state") === "error");
  }, { timeout: 60000 });
  await page.waitForTimeout(800);
  const backToFit = await measureFccu(page);
  states.returnToFit = { ...backToFit, z: zOf(backToFit) };
  return states;
}

// --- Room designs case (Phone Slice 5 follow-up) ---
// Renders the real ProjectsList; the guard intercepts /api/forge/designer
// with a canned project list (GET only — no production write, no create).
async function measureRoomDesigns(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="room-designs-fixture"]');
    if (!root) return { present: false };
    const subtitle = [...root.querySelectorAll("p")].find((p) => (p.textContent || "").includes("Floor plans for remodels"));
    const input = root.querySelector('input[aria-label="New design name"]');
    const button = [...root.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("New design"));
    const form = input ? input.closest("div") : null;
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const formStyle = form ? window.getComputedStyle(form) : null;
    return {
      present: true,
      subtitle: subtitle ? {
        text: subtitle.textContent.trim(),
        rect: rect(subtitle),
        clipped: subtitle.scrollWidth > subtitle.clientWidth + 1,
        fullyVisible: (() => { const r = subtitle.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; })(),
      } : null,
      input: input ? { rect: rect(input), focused: document.activeElement === input } : null,
      button: button ? { rect: rect(button), label: button.textContent.trim(), disabled: button.disabled, visible: (() => { const r = button.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0; })() } : null,
      formDirection: formStyle ? formStyle.flexDirection : null,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
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
    server = spawn("npm", ["run", "dev", "--", "-p", String(port)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    await waitForServer(port);
  }
  const browser = await chromium.launch();
  const results = {
    tag,
    base: BASE,
    at: new Date().toISOString(),
    repoRoot: ROOT,
    headSha: testedHeadSha(),
    widths: WIDTHS,
    cases: CASES,
    browser: { name: "chromium", version: browser.version() },
    baseline: { file: "scripts/phone-layout-geometry-baseline.json", measuredAtBase: BASELINE.measuredAtBase ?? null },
    fccuManifest: { file: "src/app/phone-fixture/fccu-provenance.json", sourceProjectId: FCCU_MANIFEST.sourceProjectId, levelDesignSha256: FCCU_MANIFEST.levelDesignSha256, counts: FCCU_MANIFEST.counts },
    checks: [],
    failures: [],
    warnings: [],
  };
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
        // Room designs renders the real ProjectsList, which fetches
        // /api/forge/designer on mount: intercept with a canned project
        // list (GET only — the guard never submits the create form, so
        // no production write is ever attempted).
        if (c === "room-designs") {
          await page.route("**/api/forge/designer", (route) => route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ projects: [
              { id: "design_guard_1", name: "Test kitchen remodel", updatedAt: "2026-11-16T12:00:00Z" },
              { id: "design_guard_2", name: "Test garage apartment layout", updatedAt: "2026-11-15T09:30:00Z" },
            ] }),
          }));
        }
        // FCCU must never write: record every non-GET request for the
        // verdict below (the fixture loads its snapshot by GET only).
        // Next.js dev's own stack-frame reporter posts to
        // /__nextjs_original-stack-frames when the dev overlay logs
        // (e.g. the pre-existing hydration warning) — dev-tooling
        // noise, not an app write, so it is excluded.
        const writeRequests = [];
        if (c === "fccu") {
          page.on("request", (req) => {
            if (!["GET", "HEAD", "OPTIONS"].includes(req.method()) && !req.url().includes("/__nextjs")) {
              writeRequests.push(`${req.method()} ${req.url()}`);
            }
          });
        }
        // Projects-list renders the real ProjectsScreen, which fetches
        // /api/forge/scheduling on mount: intercept with the same canned
        // project list the fixture page seeds into the SWR cache (GET
        // only — the guard never submits the create form or a delete, so
        // no production write is ever attempted).
        if (c === "projects-list") {
          await page.route("**/api/forge/scheduling", (route) => {
            if (route.request().method() !== "GET") return route.continue();
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ projects: [
                { id: "p-long-name", name: "FCCU Turnaround — Fall 2026 Shutdown and Revamp", startDate: "2026-09-30", endDate: "2026-12-31", createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-11-10T14:00:00Z", isPublic: true, isOwner: false },
                { id: "p-owner", name: "Crude Unit Revamp", startDate: "2026-11-02", endDate: "2026-11-20", createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-11-12T08:00:00Z", isPublic: false, isOwner: true },
                { id: "p-plain", name: "Hydrocracker Catalyst Change", startDate: "2026-09-15", endDate: "2026-10-02", createdAt: "2026-07-20T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", isPublic: false, isOwner: false },
              ] }),
            });
          });
        }
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('[data-fixture-ready="true"]', { timeout: 60000 });
        if (c === "projects-list") {
          // The list renders after the SWR seed/fetch resolves — wait for
          // cards (phone) or the table (desktop), not just the mount.
          await page.waitForFunction(
            () => document.querySelector("[data-projects-cards] article") || document.querySelector("[data-scheduling-projects] table"),
            { timeout: 60000 },
          );
        }
        if (c === "fccu") {
          await page.waitForFunction(() => {
            const el = document.querySelector("[data-fccu-state]");
            return el && (el.getAttribute("data-fccu-state") === "ready" || el.getAttribute("data-fccu-state") === "error");
          }, { timeout: 60000 });
        }
        await page.waitForTimeout(800); // let the open-time auto-fit settle
        const check = { case: c, width, url };
        check.page = await measurePage(page);
        if (c === "designer") {
          check.designer = await measureDesigner(page);
          check.designerSelection = await measureDesignerSelection(page);
        } else if (c === "fccu") {
          check.fccu = await measureFccu(page);
          check.fccuWriteRequests = writeRequests;
          if (check.fccu.fccuState === "ready") {
            // Selection proofs are a phone-width behavior (tapping an
            // overview tag): at 1919 the overview tags do not render —
            // identity there is the in-glyph tags, proven by the desktop
            // differential below — so the taps run at phone widths only.
            if (width !== 1919) check.fccuSelection = await measureFccuSelection(page);
            // Zoom states (brief §7): 1.5x / 2.5x reveals, the ~8x
            // exchanger close-up, pan + remeasure, return to fit —
            // phone widths only; the 1919 desktop check is the
            // fit-state differential.
            if (width !== 1919) check.fccuZoomStates = await measureFccuZoomStates(page, check.fccu.scale);
          }
        } else if (c === "room-designs") {
          check.roomDesigns = await measureRoomDesigns(page);
        } else if (c === "work-header") {
          check.workHeader = await measureWorkHeader(page);
        } else if (c === "app-header") {
          check.header = await measureHeader(page, "Apps");
        } else if (c === "forge-header") {
          check.header = await measureHeader(page, "Applications");
        } else if (c === "rental-23") {
          check.rental = await measureRental(page);
        } else if (c === "projects-list") {
          check.projectsList = await measureProjectsList(page);
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
          // Desktop (1919) is a NO-REGRESSION comparison against the
          // TRACKED baseline, not a zero-defect rule and not an external
          // before-run file: only intersections / outside-pane labels
          // NOT in the baseline count. The baseline's allowlist is
          // deliberately empty (measured zero at base and at head), so
          // any 1919px intersection is a new defect and fails here.
          // At every other width the rule is zero intersections.
          let newIntersections = d.intersections;
          let newOutside = d.outsidePane;
          if (width === 1919) {
            const pairKey = (p) => JSON.stringify([...p].sort());
            const expectedPairs = new Set(BASELINE.expectedIntersections.map(pairKey));
            newIntersections = d.intersections.filter((p) => !expectedPairs.has(pairKey(p)));
            const expectedOutside = new Set(BASELINE.expectedOutsidePane);
            newOutside = d.outsidePane.filter((t) => !expectedOutside.has(t));
            // Stale-baseline watch: an allowlist entry that no longer
            // occurs, or a label inventory that drifted from the
            // recorded one, only warns — it never fails a correct PR
            // and never silently passes a new defect.
            for (const p of BASELINE.expectedIntersections) {
              if (!d.intersections.some((q) => pairKey(q) === pairKey(p))) {
                results.warnings.push(`designer@1919: baseline pair no longer occurs (stale allowlist entry): ${JSON.stringify(p)}`);
              }
            }
            if (Array.isArray(BASELINE.expectedLabels)) {
              const got = d.labels.map((l) => l.text).sort();
              const want = [...BASELINE.expectedLabels].sort();
              if (JSON.stringify(got) !== JSON.stringify(want)) {
                results.warnings.push(`designer@1919: label inventory drifted from baseline (fixture plan changed? re-measure the baseline): got ${JSON.stringify(got)}`);
              }
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
        if (c === "fccu" && check.fccu) {
          const f = check.fccu;
          // Provenance is a hard gate: the fixture must be the verified
          // real design (SHA + counts from the tracked manifest), never
          // a silent synthetic fallback. A missing fixture file, a
          // mutated snapshot, or a drifted manifest fails here.
          if (f.fccuState !== "ready") fail(`FCCU fixture not ready (state=${f.fccuState}): ${f.errorText || "missing fixture / provenance error"}`);
          if (f.sha !== FCCU_MANIFEST.levelDesignSha256) fail(`FCCU provenance SHA mismatch: got ${f.sha}, want ${FCCU_MANIFEST.levelDesignSha256}`);
          // Key-order-insensitive: the manifest is written with sorted
          // keys, the fixture reports insertion order; compare per key.
          if (!f.counts || Object.keys(FCCU_MANIFEST.counts).some((k) => f.counts[k] !== FCCU_MANIFEST.counts[k]) || Object.keys(f.counts).some((k) => FCCU_MANIFEST.counts[k] === undefined)) fail(`FCCU provenance counts mismatch: got ${JSON.stringify(f.counts)}, want ${JSON.stringify(FCCU_MANIFEST.counts)}`);
          if (check.fccuWriteRequests.length) fail(`FCCU case made non-GET requests (must be read-only): ${JSON.stringify(check.fccuWriteRequests)}`);
          if (f.unclassified.length) fail(`unclassified SVG texts (every text must carry a data-label-kind or a ruler/hud ancestor): ${JSON.stringify(f.unclassified.slice(0, 10))}`);
          if (f.intersections.length) fail(`eligible industrial label intersections: ${JSON.stringify(f.intersections)}`);
          if (f.outsidePane.length) fail(`eligible industrial labels outside pane: ${JSON.stringify(f.outsidePane)}`);
          if (f.fit) {
            if (!f.fit.insidePane) fail("FCCU structural plan extends outside the pane");
            const limiting = Math.max(f.fit.widthCoverage, f.fit.heightCoverage);
            if (limiting < 0.5) fail(`FCCU fit covers only ${limiting} of the limiting axis (< 0.5)`);
          } else {
            fail("no FCCU fit measurement (no room/polygon or pipe/polyline points found)");
          }
          // An empty eligible set is NOT a pass: at whole-plot fit a
          // bounded set of short equipment tags must render. Hidden
          // counts are reported (not failed) so the receipt shows what
          // the policy withheld and why.
          const tagCount = f.countsByKind["equipment-tag"] || 0;
          const inGlyphCount = f.countsByKind["symbol-tag"] || 0;
          if (width !== 1919 && tagCount === 0 && inGlyphCount === 0) fail("no equipment tags render at whole-plot fit (empty label set is not a pass)");
          if (width === 1919 && inGlyphCount === 0) fail("no in-glyph equipment tags render at 1919 (desktop label inventory changed?)");
          // Engine fit rules (brief §7): Tier 1 coverage, Tier 2/3
          // absent at fit, ≥12px tags, engine owns every equipment tag.
          assertFccuEngineFit(f, width, fail, (m) => results.warnings.push(m), "FCCU fit");
          check.fccuHidden = {
            equipmentTags: { rendered: tagCount + inGlyphCount, total: f.counts ? f.counts.equipment : null },
            pipeLabels: { rendered: f.countsByKind["pipe-label"] || 0, total: f.counts ? f.counts.pipes : null },
            annotations: { rendered: f.countsByKind.annotation || 0, total: f.counts ? f.counts.annotations : null },
            roomLabels: { rendered: f.countsByKind["room-label"] || 0, total: f.counts ? f.counts.rooms : null },
            rulerTextsExcluded: f.countsByKind.ruler || 0,
            rulerIntersectionsExcluded: null, // counted below from raw texts
          };
          // Ruler-vs-ruler intersections are excluded from the verdict
          // (axes are not industrial labels) but recorded so the receipt
          // shows them instead of hiding them.
          const rulerRects = f.texts.filter((t) => t.kind === "ruler");
          let rulerIntersections = 0;
          for (let i = 0; i < rulerRects.length; i += 1) {
            for (let j = i + 1; j < rulerRects.length; j += 1) {
              const a = rulerRects[i].rect; const b = rulerRects[j].rect;
              if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) rulerIntersections += 1;
            }
          }
          check.fccuHidden.rulerIntersectionsExcluded = rulerIntersections;
          // Selection proofs: tapping a crowded exchanger, a pipe, and a
          // noncrowded equipment object must reveal full identity.
          if (check.fccuSelection) {
            const s = check.fccuSelection;
            if (!s.tapped) fail(`FCCU selection taps could not run: ${s.reason || "unknown"}`);
            else {
              if (!s.disclosures.exchanger || !s.disclosures.exchanger.includes("E-101")) fail(`tap crowded exchanger did not reveal E-101: ${JSON.stringify(s.disclosures.exchanger)}`);
              if (!s.disclosures.pipe || !s.disclosures.pipe.startsWith("Pipe fccu_pipe_")) fail(`tap pipe did not reveal a pipe identity: ${JSON.stringify(s.disclosures.pipe)}`);
              if (!s.disclosures.flare || !s.disclosures.flare.includes("FL-101")) fail(`tap noncrowded equipment did not reveal FL-101: ${JSON.stringify(s.disclosures.flare)}`);
            }
          }
          // Zoom states (brief §7): the engine owns equipment tags at
          // every zoom, Tier 2 appears at 1.5–2.5x, pipe dimensions at
          // ≥2.5x, Tier 3 at the ~8x close-up, pan + return-to-fit
          // re-measure clean. No outside-pane check at zoom: a zoomed
          // view is a window into a larger plan, so labels legitimately
          // fall outside the visible pane (the user pans to them).
          // Containment is a whole-plot-fit rule only (checked above).
          if (check.fccuZoomStates) {
            const zs = check.fccuZoomStates;
            const zoomStateVerdict = (state, name, extra) => {
              if (!state) { fail(`FCCU zoom state ${name} missing`); return; }
              // As at fit: only routine-rendered symbol-tags (no
              // data-tier) count — the engine's own Tier 3 piping tags
              // are symbol-tag with data-tier="3".
              const routineSymbolTags = state.texts.filter((t) => t.kind === "symbol-tag" && !t.tier).length;
              if (routineSymbolTags !== 0) fail(`FCCU ${name}: in-glyph symbol-tags render at zoom (engine owns equipment tags, got ${routineSymbolTags})`);
              if ((state.countsByKind["equipment-tag"] || 0) === 0) fail(`FCCU ${name}: no equipment tags render at zoom`);
              if (state.intersections.length) fail(`FCCU ${name}: eligible label intersections: ${JSON.stringify(state.intersections)}`);
              if (state.unclassified.length) fail(`FCCU ${name}: unclassified SVG texts: ${JSON.stringify(state.unclassified.slice(0, 10))}`);
              if (!state.stable) fail(`FCCU ${name}: eligible tag set is not stable across re-measurement (flicker)`);
              if (extra) extra(state);
            };
            zoomStateVerdict(zs.reveal15, "1.5x reveal", (s) => {
              if (s.z === null || s.z < 1.5 || s.z >= 2.5) fail(`FCCU 1.5x reveal: relative zoom ${s.z} is outside the 1.5–2.5 band`);
              const tier2 = s.texts.filter((t) => t.kind === "equipment-tag" && FCCU_TIER_2.includes(t.text)).map((t) => t.text);
              if (!tier2.length) fail("FCCU 1.5x reveal: no Tier 2 tag renders (Tier 2 must appear at 1.5–2.5x)");
              if ((s.countsByKind["pipe-label"] || 0) > 0) fail(`FCCU 1.5x reveal: pipe dimensions render below 2.5x (${s.countsByKind["pipe-label"]})`);
              if ((s.countsByKind.annotation || 0) > 0) fail(`FCCU 1.5x reveal: annotations render below 2.5x (${s.countsByKind.annotation})`);
            });
            zoomStateVerdict(zs.reveal25, "2.5x reveal", (s) => {
              if (s.z === null || s.z < 2.5) fail(`FCCU 2.5x reveal: relative zoom ${s.z} is below 2.5`);
              if ((s.countsByKind["pipe-label"] || 0) === 0) fail("FCCU 2.5x reveal: no pipe dimensions render (Tier 3 must appear at ≥2.5x)");
            });
            zoomStateVerdict(zs.closeup, "exchanger close-up", (s) => {
              if (s.z === null || s.z < 8) fail(`FCCU exchanger close-up: relative zoom ${s.z} is below 8`);
              // Tier 3 by data-tier, not by kind: near the sparse flare
              // stack (360px after a Find jump) the close-up shows a
              // room-area + a symbol-caption and no pipe dimension, and
              // both are Tier 3 — counting only pipe-label/annotation/
              // room-label would false-fail a real Tier 3 reveal.
              const tier3 = s.texts.filter((t) => t.tier === "3").length;
              if (!tier3) fail("FCCU exchanger close-up: no Tier 3 label renders at ~8x");
            });
            zoomStateVerdict(zs.pan, "pan", (s) => {
              if (!s.moved) fail("FCCU pan: the drag did not move the view (pan gesture not working?)");
            });
            if (zs.returnToFit) {
              assertFccuEngineFit(zs.returnToFit, width, fail, (m) => results.warnings.push(m), "FCCU return-to-fit");
              if (zs.returnToFit.intersections.length) fail(`FCCU return-to-fit: eligible label intersections: ${JSON.stringify(zs.returnToFit.intersections)}`);
              if (zs.returnToFit.outsidePane.length) fail(`FCCU return-to-fit: eligible labels outside pane: ${JSON.stringify(zs.returnToFit.outsidePane)}`);
              if (zs.returnToFit.z !== null && zs.returnToFit.z > 1.1) fail(`FCCU return-to-fit: scale did not return to fit (z=${zs.returnToFit.z})`);
            }
          }
        }
        if (c === "room-designs" && check.roomDesigns) {
          const r = check.roomDesigns;
          if (!r.present) fail("room-designs fixture did not render ProjectsList");
          else {
            if (!r.subtitle) fail("room-designs subtitle paragraph not found");
            else {
              if (r.subtitle.text !== "Floor plans for remodels and new layouts — 2D plans with a 3D view.") fail(`room-designs subtitle text wrong/clipped: ${JSON.stringify(r.subtitle.text)}`);
              if (r.subtitle.clipped || !r.subtitle.fullyVisible) fail(`room-designs subtitle clipped: ${JSON.stringify(r.subtitle)}`);
            }
            if (!r.input) fail("room-designs New design input not found");
            else if (r.input.rect.right > r.innerWidth + 1 || r.input.rect.left < -1) fail(`room-designs input outside viewport: ${JSON.stringify(r.input.rect)}`);
            if (!r.button) fail("room-designs New design button not found");
            else {
              if (r.button.label !== "New design") fail(`room-designs button label wrong: ${JSON.stringify(r.button.label)}`);
              if (!r.button.visible) fail(`room-designs New design button not fully visible: ${JSON.stringify(r.button.rect)}`);
              if (r.button.disabled) fail("room-designs New design button disabled on load");
            }
            if (width < 640 && r.formDirection !== "column") fail(`room-designs form is not stacked below sm at ${width}px (flex-direction=${r.formDirection})`);
            if (width >= 640 && r.formDirection !== "row") fail(`room-designs form is not a horizontal row at ${width}px (flex-direction=${r.formDirection})`);
            if (r.pageOverflow) fail(`room-designs page overflow scrollWidth=${r.scrollWidth} > innerWidth=${r.innerWidth}`);
          }
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
        if (c === "projects-list" && check.projectsList) {
          const p = check.projectsList;
          const isPhone = width < 640;
          if (isPhone) {
            if (!p.cardsVisible) fail("projects-list cards not visible at phone width");
            if (p.tableVisible) fail("projects-list desktop table visible at phone width (cards should replace it)");
            if (p.cards.length !== 3) fail(`projects-list expected 3 cards, got ${p.cards.length}`);
            for (const card of p.cards) {
              if (!card.name) fail("projects-list card missing name");
              if (!card.start || !card.finish) fail(`projects-list card missing dates: ${JSON.stringify(card)}`);
              if (card.startClipped || card.finishClipped) fail(`projects-list card date clipped: ${JSON.stringify(card)}`);
              for (const [label, r] of [["start", card.startRect], ["finish", card.finishRect], ["open", card.openRect]]) {
                if (!r) fail(`projects-list card ${card.name} missing ${label} rect`);
                else if (r.left < -1 || r.right > p.innerWidth + 1) fail(`projects-list card ${card.name} ${label} outside viewport: ${JSON.stringify(r)}`);
              }
              if (!card.openHref) fail(`projects-list card ${card.name} missing Open link`);
            }
            // Full-date proof: September (longest month name) dates read in full.
            const starts = p.cards.map((card) => card.start);
            if (!starts.includes("Sep 30, 2026") || !starts.includes("Sep 15, 2026")) fail(`projects-list September start dates not fully rendered: ${JSON.stringify(starts)}`);
            if (!p.cards.some((card) => card.hasBadge)) fail("projects-list SHARED EXAMPLE badge not rendered on any card");
            if (p.cards.filter((card) => card.hasDelete).length !== 1) fail(`projects-list owner delete on wrong number of cards: ${p.cards.filter((card) => card.hasDelete).length}`);
          } else {
            if (p.cardsVisible) fail("projects-list cards visible at desktop width (table should show)");
            if (!p.tableVisible) fail("projects-list desktop table not visible");
            if (p.tableRows !== 3) fail(`projects-list desktop table expected 3 rows, got ${p.tableRows}`);
            const wantHeaders = ["Name", "Start Date", "Finish Date", "Created", "Last Modified", "Actions"];
            if (JSON.stringify(p.tableHeaders) !== JSON.stringify(wantHeaders)) fail(`projects-list desktop table headers changed: ${JSON.stringify(p.tableHeaders)}`);
          }
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
  console.log(`wrote ${outFile}: ${results.checks.length} checks, ${results.failures.length} failures, ${results.warnings.length} warnings`);
  for (const f of results.failures) console.log(`FAIL ${f}`);
  for (const w of results.warnings) console.log(`WARN ${w}`);
  process.exit(results.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
