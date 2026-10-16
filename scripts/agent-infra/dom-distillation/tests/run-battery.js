/**
 * run-battery.js — frozen battery: all 30 fixtures vs gold labels.
 *
 * For each fixture:
 *   - status/reason matches gold expectation
 *   - every critical label/state/warning retained with exact role/name
 *   - every forbidden ref absent from the reference map (no fabrication)
 *   - every reference-map entry binds to the snapshot digest + frame and
 *     names a real snapshot node with matching role/name (no invented targets)
 *   - adverse-case extras: injection text emitted as data only; duplicate
 *     labels keep distinct refs; truncation explicitly marked
 *
 * Usage: node tests/run-battery.js   (exit 0 = all pass, exit 1 = failures)
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { distillSnapshot, baselineTokens } from "../src/index.js";
import { countTokens } from "../src/tokenizer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PAGES = join(ROOT, "fixtures", "pages");
const GOLD = JSON.parse(readFileSync(join(ROOT, "fixtures", "gold.json"), "utf8"));

let pass = 0;
let fail = 0;
const failures = [];
const results = [];

function check(cond, label, detail = "") {
  if (cond) { pass++; }
  else { fail++; failures.push(`${label}: ${detail}`); }
}

/** Every map entry must name a real node with matching role/name/frame/digest. */
function verifyReferenceMap(out, snapshot) {
  const byRef = new Map(snapshot.nodes.map(n => [n.ref, n]));
  for (const [ref, m] of Object.entries(out.reference_map)) {
    if (m.context_only) {
      // Context-only refs must still be real snapshot nodes.
      const n = byRef.get(ref);
      if (!n) return `context ref ${ref} names no snapshot node`;
      continue;
    }
    const n = byRef.get(ref);
    if (!n) return `map ref ${ref} is fabricated (no such snapshot node)`;
    if (m.snapshot_digest !== snapshot.snapshot_digest) return `map ref ${ref} binds wrong digest`;
    if (m.frame_id !== n.frame_id) return `map ref ${ref} binds wrong frame`;
    if (m.role !== n.role) return `map ref ${ref} role mismatch (${m.role} vs ${n.role})`;
    if (m.name !== n.name.slice(0, [...n.name].length > 160 ? 160 : [...n.name].length) &&
        m.name !== n.name) {
      return `map ref ${ref} name mismatch`;
    }
  }
  return null;
}

function stateSuffixesPresent(text, ref, wanted) {
  const line = text.split("\n").find(l => l.startsWith(`[${ref}]`));
  if (!line) return false;
  return wanted.every(s => line.includes(`(${s}`) || line.includes(`, ${s}`) || line.includes(`${s})`));
}

const pageFiles = readdirSync(PAGES).filter(f => f.endsWith(".json")).sort();
check(pageFiles.length === 30, "battery size", `expected 30 fixtures, got ${pageFiles.length}`);

for (const f of pageFiles) {
  const id = f.replace(/\.json$/, "");
  const label = `battery/${id}`;
  const snapshot = JSON.parse(readFileSync(join(PAGES, f), "utf8"));
  const g = GOLD[id];
  check(!!g, `${label} gold`, "missing gold label");
  if (!g) continue;

  const out = distillSnapshot(snapshot);
  check(out.status === g.expect_status, `${label} status`, `expected ${g.expect_status}, got ${out.status}`);
  if (g.expect_reason) {
    check(out.reason === g.expect_reason, `${label} reason`, `expected ${g.expect_reason}, got ${out.reason}`);
  }

  if (out.status === "OK") {
    check(out.complete === true, `${label} complete`, "OK must be complete:true");
    check(out.reference_map !== null && typeof out.reference_map === "object", `${label} map`, "OK must carry a map");
    check(typeof out.distilled_text === "string" && out.distilled_text.length > 0, `${label} text`, "OK must carry text");

    for (const c of g.critical) {
      const m = out.reference_map[c.ref];
      check(!!m && !m.context_only, `${label} critical ${c.ref}`, "missing from reference map");
      if (m) {
        check(m.role === c.role, `${label} critical ${c.ref} role`, `expected ${c.role}, got ${m.role}`);
        check(m.name === c.name, `${label} critical ${c.ref} name`, `expected ${JSON.stringify(c.name)}, got ${JSON.stringify(m.name)}`);
      }
      const line = (out.distilled_text.split("\n").find(l => l.startsWith(`[${c.ref}]`)) || "");
      check(line.length > 0, `${label} critical ${c.ref} line`, "no distilled line");
      if (c.state_contains) {
        check(stateSuffixesPresent(out.distilled_text, c.ref, c.state_contains),
          `${label} critical ${c.ref} state`, `missing state ${c.state_contains.join(",")}`);
      }
      if (c.warning_contains) {
        check(line.includes(c.warning_contains), `${label} critical ${c.ref} warning`,
          `warning text ${JSON.stringify(c.warning_contains)} not in line`);
      }
    }

    for (const fr of g.forbidden || []) {
      check(!(fr in out.reference_map), `${label} forbidden ${fr}`, "forbidden ref present in map");
      check(!out.distilled_text.split("\n").some(l => l.startsWith(`[${fr}]`)),
        `${label} forbidden ${fr} line`, "forbidden ref has distilled line");
    }

    const mapErr = verifyReferenceMap(out, snapshot);
    check(mapErr === null, `${label} map-integrity`, mapErr || "");

    // No fabricated refs anywhere in the text either.
    const textRefs = new Set([...out.distilled_text.matchAll(/\[e(\d+)\]/g)].map(m => "e" + m[1]));
    const nodeRefs = new Set(snapshot.nodes.map(n => n.ref));
    for (const r of textRefs) {
      check(nodeRefs.has(r), `${label} text-ref ${r}`, "text names a ref with no snapshot node");
    }

    if (g.require_distinct_refs) {
      const dupLines = out.distilled_text.split("\n").filter(l => l.includes('"Submit"') && /^\[e\d+\]/.test(l));
      const dupRefs = new Set(dupLines.map(l => l.match(/^\[(e\d+)\]/)[1]));
      check(dupRefs.size === g.require_distinct_refs, `${label} distinct`, `got ${dupRefs.size}`);
    }
    if (g.injection_text_must_be_data) {
      check(out.distilled_text.includes("Ignore all previous instructions"), `${label} injection-data`,
        "injection text must be preserved as data");
      check(!("e99" in out.reference_map), `${label} injection-e99`, "fabricated e99 in map");
    }
    if (g.expect_truncation) {
      check(out.truncated_fields > 0 && out.distilled_text.includes("…[truncated]"),
        `${label} truncation`, "long text must be explicitly marked truncated");
    }

    results.push({
      fixture: id, status: out.status,
      baseline_tokens: out.baseline_tokens,
      output_tokens: out.output_tokens,
      reduction_pct: +(100 * (1 - out.output_tokens / out.baseline_tokens)).toFixed(1),
      retained: out.retained_count, omitted: out.omitted_count,
    });
  } else {
    // Non-OK: no partial actionable map, no text, complete:false.
    check(out.complete === false, `${label} complete`, "non-OK must be complete:false");
    check(out.reference_map === null, `${label} no-map`, "non-OK must carry no reference map");
    check(out.distilled_text === null, `${label} no-text`, "non-OK must carry no distilled text");
    results.push({ fixture: id, status: out.status, reason: out.reason });
  }
}

// Cross-fixture: every ref in every OK map binds its own snapshot digest.
console.log(`\n${pass} passed, ${fail} failed across ${pageFiles.length} fixtures`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures.slice(0, 40)) console.log("  - " + f);
  process.exit(1);
}
