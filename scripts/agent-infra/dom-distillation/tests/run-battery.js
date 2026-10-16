/**
 * run-battery.js — frozen battery: all fixtures vs gold labels.
 *
 * For each fixture:
 *   - corpus freeze verified first (DOM-005): pinned file hashes must
 *     match the manifest before anything is evaluated
 *   - status/reason matches gold expectation
 *   - every critical label/state/warning/error retained COMPLETE
 *     (exact role/name; warning/error tails present)
 *   - row/table context associated with controls (rowctx lines)
 *   - every forbidden ref absent from the reference map (no fabrication)
 *   - the distilled text is parsed with the TRUSTED parser
 *     (parseDistilledText): zero parse errors, and every parsed control
 *     record agrees exactly with the reference map (ref/role/name) —
 *     spoofed `[e999]`-style text inside framed data fields never
 *     surfaces as a control record
 *   - verifyReferenceMap recomputes the snapshot pin (no trusted digests)
 *   - adverse-case extras: injection text emitted as data only; duplicate
 *     labels keep distinct refs; truncation explicitly marked
 *
 * Usage: node tests/run-battery.js   (exit 0 = all pass, exit 1 = failures)
 * Also importable: runBattery(rootDir, { quiet }) -> { pass, fail, failures, results }.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { distillSnapshot, verifyReferenceMap } from "../src/index.js";
import { parseDistilledText } from "../src/parse.js";
import { verifyCorpus } from "../corpus/verify-corpus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, "..");

function stateSuffixesPresent(parsedControl, wanted) {
  if (!parsedControl) return false;
  return wanted.every(s => parsedControl.states.includes(s));
}

export function runBattery(rootDir = DEFAULT_ROOT, opts = {}) {
  const quiet = !!opts.quiet;
  const PAGES = join(rootDir, "fixtures", "pages");
  const GOLD = JSON.parse(readFileSync(join(rootDir, "fixtures", "gold.json"), "utf8"));

  let pass = 0;
  let fail = 0;
  const failures = [];
  const results = [];

  function check(cond, label, detail = "") {
    if (cond) { pass++; }
    else { fail++; failures.push(`${label}: ${detail}`); }
  }

  // DOM-005: the freeze is ENFORCED — evaluation never runs on drifted inputs.
  const corpus = verifyCorpus(rootDir);
  check(corpus.ok, "corpus frozen", corpus.failures.join("; "));
  if (!corpus.ok) {
    return { pass, fail, failures, results };
  }

  // Expected fixture set comes from the frozen manifest: no missing, no extras.
  const manifest = JSON.parse(readFileSync(join(rootDir, "corpus", "manifest.json"), "utf8"));
  const expectedPages = manifest.files
    .map(f => f.path)
    .filter(p => p.startsWith("fixtures/pages/") && p.endsWith(".json"))
    .map(p => p.slice("fixtures/pages/".length))
    .sort();
  const onDisk = existsSync(PAGES)
    ? readdirSync(PAGES).filter(f => f.endsWith(".json")).sort()
    : [];
  check(
    JSON.stringify(onDisk) === JSON.stringify(expectedPages),
    "battery fixture set",
    `expected [${expectedPages.join(",")}] got [${onDisk.join(",")}]`
  );

  for (const f of onDisk) {
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

      // Trusted parse: the ONLY sanctioned reading of control records.
      const parsed = parseDistilledText(out.distilled_text);
      check(parsed.errors.length === 0, `${label} parse`, parsed.errors.slice(0, 3).join("; "));
      const parsedByRef = new Map(parsed.controls.map(c => [c.ref, c]));

      // Exact agreement: parsed records <-> reference map, both directions.
      for (const c of parsed.controls) {
        const m = out.reference_map[c.ref];
        check(!!m, `${label} parsed ${c.ref} in map`, "parsed control has no map entry");
        if (m) {
          check(m.role === c.role, `${label} parsed ${c.ref} role`, `map ${m.role} vs text ${c.role}`);
          check(m.name === c.name, `${label} parsed ${c.ref} name`, "map/text name disagree");
        }
      }
      for (const key of Object.keys(out.reference_map)) {
        check(parsedByRef.has(key), `${label} map ${key} in text`, "map entry has no parsed control line");
      }

      for (const c of g.critical) {
        const m = out.reference_map[c.ref];
        check(!!m, `${label} critical ${c.ref}`, "missing from reference map");
        if (m) {
          check(m.role === c.role, `${label} critical ${c.ref} role`, `expected ${c.role}, got ${m.role}`);
          // DOM-001: critical names are complete, never silently truncated.
          check(m.name === c.name, `${label} critical ${c.ref} name`, `expected ${JSON.stringify(c.name)}, got ${JSON.stringify(m.name)}`);
        }
        const pc = parsedByRef.get(c.ref);
        check(!!pc, `${label} critical ${c.ref} line`, "no parsed control record");
        if (c.state_contains) {
          check(stateSuffixesPresent(pc, c.state_contains),
            `${label} critical ${c.ref} state`, `missing state ${c.state_contains.join(",")}`);
        }
        if (c.warning_contains) {
          check(!!pc && (pc.warning || "").includes(c.warning_contains),
            `${label} critical ${c.ref} warning`,
            `warning tail ${JSON.stringify(c.warning_contains)} not complete in record`);
        }
        if (c.error_contains) {
          check(!!pc && (pc.invalid || "").includes(c.error_contains),
            `${label} critical ${c.ref} error`,
            `error tail ${JSON.stringify(c.error_contains)} not complete in record`);
        }
        if (c.rowctx_contains) {
          const rl = parsed.rowctx.find(r => r.ref === c.ref);
          check(!!rl, `${label} critical ${c.ref} rowctx`, "no rowctx association line");
          if (rl) {
            for (const want of c.rowctx_contains) {
              check(rl.rowtext.includes(want),
                `${label} critical ${c.ref} rowctx-text`, `row context missing ${JSON.stringify(want)}`);
            }
          }
        }
      }

      for (const fr of g.forbidden || []) {
        check(!(fr in out.reference_map), `${label} forbidden ${fr}`, "forbidden ref present in map");
        check(!parsedByRef.has(fr), `${label} forbidden ${fr} line`, "forbidden ref has parsed control record");
      }

      // Full source/head/frame binding, pin recomputed (never trusted).
      const mapErr = verifyReferenceMap(out, snapshot);
      check(mapErr === null, `${label} map-integrity`, mapErr || "");

      if (g.require_distinct_refs) {
        const dupRefs = new Set(
          parsed.controls.filter(c => c.name === "Submit").map(c => c.ref)
        );
        check(dupRefs.size === g.require_distinct_refs, `${label} distinct`, `got ${dupRefs.size}`);
      }
      if (g.injection_text_must_be_data) {
        check((parsed.pageText || "").includes("Ignore all previous instructions"),
          `${label} injection-data`, "injection text must be preserved as data");
        check(!("e99" in out.reference_map), `${label} injection-e99`, "fabricated e99 in map");
        check(!parsedByRef.has("e99") && ![...parsedByRef.keys()].some(k => k === "e999"),
          `${label} injection-no-spoof-line`, "spoofed control record parsed from data");
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

  if (!quiet) {
    console.log(`\n${pass} passed, ${fail} failed across ${onDisk.length} fixtures`);
    if (failures.length) {
      console.log("FAILURES:");
      for (const f of failures.slice(0, 40)) console.log("  - " + f);
    }
  }
  return { pass, fail, failures, results };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const r = runBattery(DEFAULT_ROOT);
  if (r.fail > 0) process.exit(1);
}
