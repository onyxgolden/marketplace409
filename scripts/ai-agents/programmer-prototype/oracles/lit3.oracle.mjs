/** lit3-acceptance-v1 — host-owned immutable acceptance oracle. */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("lit3-acceptance-v1");

let mod = null;
try {
  mod = await import("../src/timeout.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(mod.DEFAULT_TIMEOUT_MS, 3000, "default-timeout");
}
t.report(seed, tree_digest);
