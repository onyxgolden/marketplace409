/** lit-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("lit-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/labels.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.statusLabel("active"), "Active", "active");
  t.eq(mod.statusLabel("paused"), "Paused", "paused");
  t.eq(mod.statusLabel("archived"), "Archived", "archived");
  t.eq(mod.statusLabel("nope"), "Unknown", "unknown");
}
t.report(seed, tree_digest);
