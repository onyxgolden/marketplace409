/**
 * ser2-acceptance-v1 — host-owned immutable acceptance oracle.
 * Exercises the generated pure filter on INVENTED escrow audit events.
 */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("ser2-acceptance-v1");

let mod = null;
try {
  mod = await import("../lib/escrowEventFilter.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(typeof mod.filterEscrowEvents, "function", "export-is-function");
  if (typeof mod.filterEscrowEvents === "function") {
    const events = [
      { eventId: "EV-1", kind: "funded" },
      { eventId: "EV-2", kind: "released" },
      { eventId: "EV-3", kind: "funded" },
    ];
    const got = mod.filterEscrowEvents(events, "funded");
    t.eq(JSON.stringify(got), JSON.stringify([events[0], events[2]]), "filter-funded");
    t.eq(mod.filterEscrowEvents(events, "released").length, 1, "filter-released-count");
    t.eq(JSON.stringify(events), JSON.stringify([
      { eventId: "EV-1", kind: "funded" },
      { eventId: "EV-2", kind: "released" },
      { eventId: "EV-3", kind: "funded" },
    ]), "input-unmutated");
  }
}
t.report(seed, tree_digest);
