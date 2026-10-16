/**
 * run-tests.js — unit suites: tokenizer, schemas, distiller, determinism, mutations.
 * Usage: node tests/run-tests.js   (exit 0 = all pass)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { countTokens, encode, tokenizerInfo } from "../src/tokenizer.js";
import { validateSnapshot } from "../src/schemas.js";
import { distillSnapshot, verifyReferenceMap, MAX_OUTPUT_TOKENS } from "../src/index.js";
import { sha256HexUtf8 } from "../src/canonical.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PAGES = join(ROOT, "fixtures", "pages");

let pass = 0, fail = 0;
const failures = [];
function t(cond, label, detail = "") {
  if (cond) pass++;
  else { fail++; failures.push(`${label}: ${detail}`); }
}
function load(id) {
  return JSON.parse(readFileSync(join(PAGES, id + ".json"), "utf8"));
}
function recomputeDigest(snap) {
  const arr = [...snap.nodes].sort((a, b) => (a.ref < b.ref ? -1 : 1));
  snap.snapshot_digest = sha256HexUtf8(arr);
  return snap;
}

// ---------------- tokenizer ----------------
t(countTokens("Hello, world!") === 4, "tok hello-world", `got ${countTokens("Hello, world!")}`);
t(countTokens("") === 0, "tok empty");
t(countTokens("Hello, world!") === countTokens("Hello, world!"), "tok deterministic");
t(encode("Hello").length === 1 && encode("Hello")[0] === "Hello", "tok single-word");
t(countTokens("café") > 1, "tok unicode-multibyte", `got ${countTokens("café")}`);
t(countTokens(" ".repeat(100)) >= 1, "tok whitespace");
t(tokenizerInfo().id === "gpt2-bpe/1", "tok pinned-id");
t(tokenizerInfo().runtime_downloads === false, "tok no-runtime-downloads");

// ---------------- schemas ----------------
{
  const good = load("n01-login-form");
  let ok = true;
  try { validateSnapshot(good); } catch (e) { ok = false; }
  t(ok, "schema valid");

  const unknown = JSON.parse(JSON.stringify(good));
  unknown.nodes[0].bogus = 1;
  t(throws(() => validateSnapshot(recomputeDigest(unknown))), "schema unknown-prop");

  const badRole = JSON.parse(JSON.stringify(good));
  badRole.nodes[1].role = "teleport";
  t(throws(() => validateSnapshot(recomputeDigest(badRole))), "schema bad-role");

  const dup = JSON.parse(JSON.stringify(good));
  dup.nodes[1].ref = dup.nodes[0].ref;
  t(throws(() => validateSnapshot(recomputeDigest(dup))), "schema dup-ref");

  const xframe = load("a24-cross-frame");
  t(throws(() => validateSnapshot(xframe)), "schema cross-frame");

  const dangling = JSON.parse(JSON.stringify(good));
  dangling.nodes[0].children.push("e999");
  t(throws(() => validateSnapshot(recomputeDigest(dangling))), "schema dangling-ref");

  const badDigest = JSON.parse(JSON.stringify(good));
  badDigest.snapshot_digest = "zzz";
  t(throws(() => validateSnapshot(badDigest)), "schema bad-digest-format");

  const badState = JSON.parse(JSON.stringify(good));
  delete badState.nodes[1].state.disabled;
  t(throws(() => validateSnapshot(recomputeDigest(badState))), "schema missing-state-key");

  const badRef = JSON.parse(JSON.stringify(good));
  badRef.nodes[1].ref = "x1";
  t(throws(() => validateSnapshot(recomputeDigest(badRef))), "schema bad-ref-format");

  const badFrame = JSON.parse(JSON.stringify(good));
  badFrame.nodes[1].frame_id = "nope";
  t(throws(() => validateSnapshot(recomputeDigest(badFrame))), "schema unknown-frame");
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

// ---------------- distiller ----------------
{
  const stale = load("a23-stale-digest");
  const o1 = distillSnapshot(stale);
  t(o1.status === "REFUSED" && o1.reason === "STALE_SNAPSHOT", "distill stale-refused");
  t(o1.reference_map === null && o1.distilled_text === null && o1.complete === false, "distill stale-no-partial");

  const huge = load("a26-huge-table");
  const o2 = distillSnapshot(huge);
  t(o2.status === "INCOMPLETE" && o2.reason === "OVER_LIMIT", "distill over-limit");
  t(o2.reference_map === null && o2.distilled_text === null, "distill over-limit-no-partial-map");
  t(o2.complete === false, "distill over-limit-incomplete");

  const hid = load("a25-hidden-content");
  const o3 = distillSnapshot(hid);
  t(o3.status === "OK" && !("e3" in o3.reference_map), "distill hidden-omitted");
  t(o3.omissions && o3.omissions.hidden === 1, "distill omission-reason-counted", JSON.stringify(o3.omissions));

  const off = load("a29-offscreen-cta");
  const o4 = distillSnapshot(off);
  const line = o4.distilled_text.split("\n").find(l => l.includes("Sign up for updates"));
  t(!!line && line.includes("offscreen"), "distill offscreen-retained");

  const deep = load("a30-deep-nesting");
  const o5 = distillSnapshot(deep);
  t(o5.truncated_fields > 0 && o5.distilled_text.includes("…[truncated]"), "distill truncation-marked");

  const n4 = load("n04-product-table");
  const o6 = distillSnapshot(n4);
  t(o6.distilled_text.includes("ctx "), "distill ctx-lines", "expected heading context lines");
  t(o6.complete === true && o6.output_tokens <= MAX_OUTPUT_TOKENS, "distill budget-flag");
  t(o6.tokenizer === "gpt2-bpe/1", "distill tokenizer-pinned");
  t(verifyReferenceMap(o6, n4) === null, "distill map-verifies");
}

// ---------------- determinism ----------------
{
  for (const id of ["n01-login-form", "a21-injection", "n13-calendar"]) {
    const snap = load(id);
    const a = JSON.stringify(distillSnapshot(snap));
    const b = JSON.stringify(distillSnapshot(snap));
    const c = JSON.stringify(distillSnapshot(snap));
    t(a === b && b === c, `determinism ${id}`);
  }
}

// ---------------- mutations (test sensitivity) ----------------
// M1: a distiller regression that drops a critical warning must be caught.
{
  const snap = load("a28-warning-base");
  const dlg = snap.nodes.find(n => n.role === "alertdialog");
  dlg.warning = null; // simulate the regression at the source
  recomputeDigest(snap); // keep the pin valid so only the warning loss is tested
  const out = distillSnapshot(snap);
  const goldWarn = "cannot be reversed";
  const line = (out.distilled_text.split("\n").find(l => l.includes("Send wire transfer?")) || "");
  const caught = out.status === "OK" && !line.includes(goldWarn);
  t(caught, "mutation M1 deleted-warning-caught", "gold check must fail when a critical warning is dropped");
}
// M2: a swapped target reference must be caught by map verification.
{
  const snap = load("n01-login-form");
  const out = JSON.parse(JSON.stringify(distillSnapshot(snap)));
  const keys = Object.keys(out.reference_map).filter(k => !out.reference_map[k].context_only);
  const a = keys[0], b = keys[1];
  const tmp = out.reference_map[a].name;
  out.reference_map[a].name = out.reference_map[b].name;
  out.reference_map[b].name = tmp;
  t(verifyReferenceMap(out, snap) !== null, "mutation M2 swapped-ref-caught");
}
// M3: a changed snapshot pin must refuse, never distill.
{
  const snap = load("n01-login-form");
  snap.snapshot_digest = "f".repeat(64);
  const out = distillSnapshot(snap);
  t(out.status === "REFUSED" && out.reason === "STALE_SNAPSHOT", "mutation M3 changed-pin-refused");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
