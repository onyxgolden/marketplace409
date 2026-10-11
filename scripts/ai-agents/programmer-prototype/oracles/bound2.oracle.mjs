/** bound2-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("bound2-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/clamp.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.clampIndex(-1, 5), 0, "neg");
  t.eq(mod.clampIndex(0, 5), 0, "zero");
  t.eq(mod.clampIndex(4, 5), 4, "last-valid");
  t.eq(mod.clampIndex(5, 5), 4, "len");
  t.eq(mod.clampIndex(9, 5), 4, "above-len");
}
t.report(seed, tree_digest);
