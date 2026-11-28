// Planner phone-width fix — live check (Jason's S26+ shots, 2026-11-28).
//
// Usage: node .planner-phone-evidence/planner-phone-fix-check.mjs [--port 3103] [--keep-server]
//
// Spawns the Next dev server for THIS checkout (unless --keep-server),
// renders the REAL PlannerDashboardShell at /phone-fixture?case=work-dashboard
// (cost=complete, dark mode via the production `.dark` class — Jason's
// shots are dark mode) and the REAL WorkPackageListGrid at
// /phone-fixture?case=work-grid, at 390px and 400px, and measures:
//   1. D2b cost-split legend labels: each label's rendered line count
//      (getClientRects) — a whole label is 1 line; the S26+ defect
//      renders one letter per line.
//   2. D5 scope-block-map Export CSV button: fully inside the viewport
//      (right <= innerWidth + 1) and the header row fits its card.
//   3. Grid title contrast (dark): WCAG ratio of each real-row title
//      cell's computed color against its effective background; < 4.5:1 fails.
//   4. Blank rows: count of the greyed "New package title…" rows
//      (expect exactly BLANK_ROWS = 10 with default filters) — the
//      ruling is they belong (inline-create affordance), so the check
//      records the count and that each is an editable draft row.
//
// The grid is a desktop grid by design (known pre-existing horizontal
// overflow at phone width, NONBLOCKING per the D3 verdict) — page
// overflow is asserted only for the dashboard case, never the grid case.
//
// Writes one JSON per width to .planner-phone-evidence/ and exits
// non-zero on any failure. Pre-fix run must reproduce defects 1–2;
// post-fix run must pass all four checks.
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUT_DIR = path.join(ROOT, ".planner-phone-evidence");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}
const port = Number(argValue("--port", "3103"));
const keepServer = args.includes("--keep-server");
const BASE = `http://localhost:${port}/phone-fixture`;
const WIDTHS = [360, 390, 400]; // 360 = Jason's S26+ CSS width (the repro width: 1080 physical px at DPR 3.0); 390/400 = the stated verify widths.

async function waitForServer(timeoutMs = 600000) {
  // Cold compile of the fixture route takes minutes on this VM (the
  // shared harness notes ~10 min cold); 120s is not enough on first boot.
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE}?case=work-dashboard`);
      if (res.ok || res.status === 404) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not answer on :${port} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function measureDashboard(page, width) {
  return page.evaluate((w) => {
    const doc = document.documentElement;
    // getClientRects() on a blockified flex item always returns ONE rect
    // no matter how many lines the text wraps to — count lines with a
    // Range over the text node instead (one rect per laid-out line).
    const legendRows = [...document.querySelectorAll('[data-testid="planner-cost-legend"] li')].map((li) => {
      const label = li.querySelector("span.font-medium");
      let lines = null;
      if (label && label.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(label);
        lines = range.getClientRects().length;
      }
      return {
        text: label?.textContent ?? null,
        lines,
        clientWidth: label?.clientWidth ?? null,
        clientHeight: label?.clientHeight ?? null,
        scrollWidth: label?.scrollWidth ?? null,
        labelRect: label ? { x: Math.round(label.getBoundingClientRect().x), width: Math.round(label.getBoundingClientRect().width) } : null,
      };
    });
    // D5 scope-map header: Export CSV button + header row fit.
    const map = document.querySelector('[data-testid="scope-block-map"]');
    const exportBtn = map ? [...map.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Export Scope block map as CSV") : null;
    const exportRect = exportBtn ? exportBtn.getBoundingClientRect() : null;
    const headerRow = map ? map.querySelector(":scope > div") : null;
    const headerControls = map ? [...map.querySelectorAll(":scope > div button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { label: (b.getAttribute("aria-label") || b.textContent?.trim() || "").slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), outside: r.right > window.innerWidth + 1 || r.left < -1 };
    }) : [];
    return {
      width: w,
      innerWidth: window.innerWidth,
      darkModeOn: document.documentElement.classList.contains("dark"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      pageOverflow: doc.scrollWidth > window.innerWidth + 1,
      scrollWidth: doc.scrollWidth,
      costLegend: legendRows,
      scopeMapExport: exportBtn ? {
        label: exportBtn.getAttribute("aria-label"),
        left: Math.round(exportRect.left),
        right: Math.round(exportRect.right),
        width: Math.round(exportRect.width),
        height: Math.round(exportRect.height),
        outside: exportRect.right > window.innerWidth + 1 || exportRect.left < -1,
      } : null,
      scopeMapHeaderScrollWidth: headerRow ? headerRow.scrollWidth : null,
      scopeMapHeaderClientWidth: headerRow ? headerRow.clientWidth : null,
      scopeMapHeaderControls: headerControls,
    };
  }, width);
}

async function measureGrid(page, width) {
  return page.evaluate((w) => {
    // Tailwind v4 reports colors as oklch() in getComputedStyle — a
    // parser that only understands rgb() returns null and the contrast
    // check silently passes. Parse both, into LINEAR sRGB 0..1.
    function parseColor(str) {
      if (!str) return null;
      const rgb = str.match(/rgba?\(([^)]+)\)/);
      if (rgb) {
        const parts = rgb[1].split(",").map((s) => parseFloat(s));
        const f = (c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return { r: f(parts[0]), g: f(parts[1]), b: f(parts[2]), a: parts.length > 3 ? parts[3] : 1 };
      }
      const ok = str.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
      if (ok) {
        const L = ok[2] === "%" ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
        const C = parseFloat(ok[3]);
        const H = (parseFloat(ok[4]) * Math.PI) / 180;
        const a = C * Math.cos(H);
        const b = C * Math.sin(H);
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 0.0319727226 * b;
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;
        const clamp = (v) => Math.min(1, Math.max(0, v));
        return {
          r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3219295917 * s),
          b: clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7147499704 * s),
          a: ok[5] != null ? parseFloat(ok[5]) : 1,
        };
      }
      return null;
    }
    function luminance({ r, g, b }) {
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function effectiveBackground(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const parsed = parseColor(bg);
        if (parsed && parsed.a > 0) return parsed;
        node = node.parentElement;
      }
      const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
      if (bodyBg && bodyBg.a > 0) return bodyBg;
      return { r: 1, g: 1, b: 1, a: 1 };
    }
    function contrast(fg, bg) {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    function toRgbString(c) {
      const f = (v) => {
        const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, s)) * 255);
      };
      return `rgb(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
    }
    const rows = [...document.querySelectorAll('[data-testid="work-grid-fixture"] [role="row"]')];
    const dataRows = rows.filter((row) => row.querySelector('a[href*="/forge/work/"]'));
    const blankRows = rows.filter((row) => row.textContent.includes("New package title"));
    const titles = dataRows.map((row) => {
      const cells = [...row.querySelectorAll('[role="gridcell"], [role="cell"]')];
      const titleCell = cells[1];
      const textEl = titleCell?.querySelector("*") || titleCell;
      const cs = textEl ? getComputedStyle(textEl) : null;
      const fg = cs ? parseColor(cs.color) : null;
      const bg = textEl ? effectiveBackground(textEl) : null;
      return {
        title: titleCell?.textContent?.trim()?.slice(0, 40) ?? null,
        color: cs?.color ?? null,
        background: bg ? toRgbString(bg) : null,
        ratio: fg && bg ? contrast(fg, bg) : null,
        fontSize: cs?.fontSize ?? null,
      };
    });
    // Header row background (white in dark mode on the S26+ shot).
    const headerRow = document.querySelector('[data-testid="work-grid-fixture"] [role="row"].sticky');
    const headerBg = headerRow ? getComputedStyle(headerRow).backgroundColor : null;
    return {
      width: w,
      innerWidth: window.innerWidth,
      darkModeOn: document.documentElement.classList.contains("dark"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      dataRowCount: dataRows.length,
      blankRowCount: blankRows.length,
      blankRowTitles: blankRows.slice(0, 2).map((r) => r.textContent.trim().slice(0, 40)),
      titleContrast: titles,
      headerBackground: headerBg,
    };
  }, width);
}

async function checkWidth(browser, width, headSha) {
  const failures = [];
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const result = { width, head: headSha, failures };
  try {
    await page.goto(`${BASE}?case=work-dashboard&cost=complete`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="planner-cost-split"]');
    await page.waitForTimeout(500);
    // Re-assert dark right before measuring: the app theme effect can
    // strip the class after hydration; a light-mode measure would be
    // worthless for the dark-mode contrast leg.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    const dash = await measureDashboard(page, width);
    result.dashboard = dash;
    if (!dash.darkModeOn) failures.push(`${width}px dashboard: dark mode did not stay on (theme effect stripped .dark)`);
    if (dash.pageOverflow) failures.push(`${width}px dashboard: page overflow (scrollWidth=${dash.scrollWidth})`);
    const wrappedLabels = dash.costLegend.filter((l) => l.lines !== 1);
    if (wrappedLabels.length) failures.push(`${width}px D2b: ${wrappedLabels.length} legend label(s) wrapped (${wrappedLabels.map((l) => `${l.text}:${l.lines} lines`).join(", ")})`);
    if (dash.scopeMapHeaderScrollWidth > dash.scopeMapHeaderClientWidth + 1) failures.push(`${width}px D5: scope-block-map header overflows its card (scrollWidth=${dash.scopeMapHeaderScrollWidth}, clientWidth=${dash.scopeMapHeaderClientWidth})`);
    if (!dash.scopeMapExport) failures.push(`${width}px D5: scope-block-map Export CSV control missing`);
    else if (dash.scopeMapExport.outside) failures.push(`${width}px D5: scope-block-map Export CSV clipped (right=${dash.scopeMapExport.right}, innerWidth=${dash.innerWidth})`);
    const outsideControls = dash.scopeMapHeaderControls.filter((c) => c.outside);
    if (outsideControls.length) failures.push(`${width}px D5: ${outsideControls.length} scope-map header control(s) outside viewport: ${JSON.stringify(outsideControls)}`);
    await page.screenshot({ path: path.join(OUT_DIR, `dashboard-${width}w.png`) });

    await page.goto(`${BASE}?case=work-grid`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForSelector('[data-fixture-ready="true"]');
    await page.waitForSelector('[data-testid="work-grid-fixture"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    const grid = await measureGrid(page, width);
    result.grid = grid;
    if (grid.darkModeOn === false) failures.push(`${width}px grid: dark mode did not stay on`);
    if (grid.dataRowCount !== 6) failures.push(`${width}px grid: expected 6 data rows, got ${grid.dataRowCount}`);
    if (grid.blankRowCount !== 10) failures.push(`${width}px grid: expected 10 blank rows, got ${grid.blankRowCount}`);
    const unmeasured = grid.titleContrast.filter((t) => t.ratio == null);
    if (unmeasured.length) failures.push(`${width}px grid: ${unmeasured.length} title(s) with unmeasurable contrast (color parse failed): ${JSON.stringify(unmeasured)}`);
    const lowContrast = grid.titleContrast.filter((t) => t.ratio != null && t.ratio < 4.5);
    if (lowContrast.length) failures.push(`${width}px grid: ${lowContrast.length} title(s) below 4.5:1: ${JSON.stringify(lowContrast)}`);
    await page.screenshot({ path: path.join(OUT_DIR, `grid-${width}w.png`) });
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { execSync } = await import("node:child_process");
  const headSha = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  const treeSha = execSync("git rev-parse HEAD^{tree}", { cwd: ROOT }).toString().trim();
  let server = null;
  try {
    if (!keepServer) {
      console.log("starting dev server…");
      // Turbopack panics on the symlinked node_modules in a worktree
      // ("Symlink node_modules could not be resolved") — webpack mode
      // serves the same pages fine. Spawn next directly, not via npm.
      server = spawn("./node_modules/.bin/next", ["dev", "--webpack", "-p", String(port)], {
        cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: true,
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://test-fixture-only.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-fixture-publishable-key-not-real" },
      });
      server.stdout.on("data", () => {});
      server.stderr.on("data", () => {});
      await waitForServer();
      console.log("dev server up");
    } else {
      await waitForServer();
    }
    const browser = await chromium.launch();
    const results = [];
    try {
      for (const width of WIDTHS) {
        console.log(`checking ${width}px…`);
        const result = await checkWidth(browser, width, headSha);
        result.tree = treeSha;
        results.push(result);
        await writeFile(path.join(OUT_DIR, `planner-phone-fix-${width}w.json`), JSON.stringify(result, null, 2));
      }
    } finally {
      await browser.close();
    }
    const allFailures = results.flatMap((r) => r.failures);
    console.log(JSON.stringify({ head: headSha, tree: treeSha, failures: allFailures }, null, 2));
    if (allFailures.length) {
      console.error(`FAIL: ${allFailures.length} issue(s)`);
      process.exitCode = 1;
    } else {
      console.log("PASS: legend labels whole, scope-map Export CSV in viewport, grid titles >= 4.5:1, 10 blank rows (360/390/400)");
    }
  } finally {
    if (server) server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
