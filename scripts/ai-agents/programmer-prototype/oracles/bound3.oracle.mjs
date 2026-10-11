/** bound3-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("bound3-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/paginate.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.pageCount(10, 3), 4, "partial-page");
  t.eq(mod.pageCount(9, 3), 3, "exact-pages");
  t.eq(mod.pageCount(1, 10), 1, "single-partial");
}
t.report(seed, tree_digest);
