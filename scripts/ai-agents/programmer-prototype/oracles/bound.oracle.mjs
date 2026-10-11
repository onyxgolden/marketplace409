/** bound-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("bound-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/range.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.inRange(1, 1, 5), true, "lo-edge");
  t.eq(mod.inRange(5, 1, 5), true, "hi-edge");
  t.eq(mod.inRange(3, 1, 5), true, "mid");
  t.eq(mod.inRange(0, 1, 5), false, "below-lo");
  t.eq(mod.inRange(6, 1, 5), false, "above-hi");
}
t.report(seed, tree_digest);
