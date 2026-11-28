// Analyze a CDP CPU profile (Profiler.stop output, as written by
// scripts/__dbg-profile.mjs): top functions by self samples, top call
// paths (function <- parent <- grandparent), and top app ancestors.
// Replaces the D0 /tmp/analyze-profile.mjs + analyze-profile2.mjs
// scripts, which were lost — this one lives in the repo as dev tooling
// (not shipped code) so the P0 vs D2 re-profiling comparison is
// reproducible from the filed raw profiles.
//
// Usage:
//   node scripts/analyze-cdp-profile.mjs <profile.json> [--top N]
//   node scripts/analyze-cdp-profile.mjs <p0.json> --compare <d2.json>
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const topN = Number(args[args.indexOf("--top") + 1] || 25);
const compareFile = args[args.indexOf("--compare") + 1];
if (!file) { console.error("usage: analyze-cdp-profile.mjs <profile.json> [--top N] [--compare <other.json>]"); process.exit(2); }

function shortUrl(url = "") {
  const m = url.match(/([^/?#]+)(?:[?#].*)?$/);
  return m ? m[1] : url;
}

function analyze(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map();
  for (const id of profile.samples || []) self.set(id, (self.get(id) || 0) + 1);
  const total = (profile.samples || []).length;
  const byFn = new Map(); // "name (file:line)" -> { self, total }
  const byPath = new Map(); // "fn <- parent <- grandparent" -> samples
  const byAncestor = new Map(); // topmost app-frame ancestor -> samples
  const nameOf = (n) => {
    const cf = n.callFrame || {};
    const fn = cf.functionName || "(anonymous)";
    const loc = cf.url ? `${shortUrl(cf.url)}:${cf.lineNumber ?? 0}` : "";
    return loc ? `${fn} (${loc})` : fn;
  };
  for (const [id, count] of self) {
    const node = nodes.get(id);
    if (!node) continue;
    const key = nameOf(node);
    const e = byFn.get(key) || { self: 0 };
    e.self += count;
    byFn.set(key, e);
    const p1 = parent.get(id);
    const p2 = p1 != null ? parent.get(p1) : null;
    const path = [node, p1 != null && nodes.get(p1), p2 != null && nodes.get(p2)]
      .filter(Boolean).map(nameOf).join(" <- ");
    byPath.set(path, (byPath.get(path) || 0) + count);
    // Topmost ancestor that is an app frame: skip the React scheduler and
    // other framework frames (Turbopack names the compiled React DOM chunk
    // `..._next_dist_compiled_...`, not node_modules) so the table names
    // the app entry point (validateDesign, DesignerScreen effects, ...)
    // the way the D0 summary did.
    const isFramework = (url = "") =>
      url.includes("node_modules") || url.includes("next_dist_compiled") || url.includes("turbopack-");
    let cur = node;
    let anc = null;
    while (parent.get(cur.id) != null) {
      const up = nodes.get(parent.get(cur.id));
      const fn = up.callFrame?.functionName || "";
      const url = up.callFrame?.url || "";
      if (fn && !fn.startsWith("(") && !isFramework(url)) anc = up;
      cur = up;
    }
    if (anc) {
      const k = nameOf(anc);
      byAncestor.set(k, (byAncestor.get(k) || 0) + count);
    }
  }
  return { total, byFn, byPath, byAncestor, durationMs: Math.round(((profile.endTime - profile.startTime) || 0) / 1000) };
}

function pct(n, total) { return total ? `${(100 * n / total).toFixed(1)}%` : "—"; }
function table(title, entries, total, n = topN) {
  console.log(`\n${title} (total samples: ${total})`);
  for (const [k, v] of entries.slice(0, n)) console.log(`  ${String(v).padStart(7)}  ${pct(v, total).padStart(6)}  ${k}`);
}

const a = analyze(JSON.parse(readFileSync(file, "utf8")));
console.log(`profile: ${file}  durationMs=${a.durationMs}  samples=${a.total}`);
table("TOP FUNCTIONS (self samples)", [...a.byFn.entries()].map(([k, v]) => [k, v.self]).sort((x, y) => y[1] - x[1]), a.total);
table("TOP CALL PATHS (fn <- parent <- grandparent)", [...a.byPath.entries()].sort((x, y) => y[1] - x[1]), a.total, 20);
table("TOP APP COMPONENT ANCESTORS", [...a.byAncestor.entries()].sort((x, y) => y[1] - x[1]), a.total, 15);

if (compareFile) {
  const b = analyze(JSON.parse(readFileSync(compareFile, "utf8")));
  console.log(`\nCOMPARE: ${file} (A, ${a.total} samples) vs ${compareFile} (B, ${b.total} samples)`);
  const keys = new Set([...a.byFn.keys(), ...b.byFn.keys()]);
  const rows = [...keys].map((k) => {
    const sa = a.byFn.get(k)?.self || 0;
    const sb = b.byFn.get(k)?.self || 0;
    return { k, sa, sb, pa: 100 * sa / a.total, pb: 100 * sb / b.total, d: (100 * sb / b.total) - (100 * sa / a.total) };
  }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  console.log("  A% -> B% (Δpp)  function");
  for (const r of rows.slice(0, topN)) {
    console.log(`  ${r.pa.toFixed(1).padStart(5)} -> ${r.pb.toFixed(1).padStart(5)} (${r.d >= 0 ? "+" : ""}${r.d.toFixed(1)})  ${r.k}`);
  }
}
