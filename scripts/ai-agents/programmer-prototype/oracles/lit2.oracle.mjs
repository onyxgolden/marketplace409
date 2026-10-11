/** lit2-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("lit2-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/greeting.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.greeting("Ada"), "Hello, Ada!", "greeting-ada");
  t.eq(mod.greeting(""), "Hello, !", "greeting-empty");
}
t.report(seed, tree_digest);
