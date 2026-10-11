/**
 * ser-acceptance-v1 — host-owned immutable acceptance oracle.
 * Exercises the generated pure serializer on INVENTED escrow audit events.
 * No ledger, database, or financial data is involved.
 */
import { parseArgs, makeOracle } from "./_lib.mjs";

const { seed, tree_digest } = parseArgs(process.argv.slice(2));
const t = makeOracle("ser-acceptance-v1");

let mod = null;
try {
  mod = await import("../lib/escrowAuditSerializer.mjs");
} catch (e) {
  t.fail(`import: ${e.message}`);
}
if (mod) {
  t.eq(typeof mod.serializeEscrowAuditEvent, "function", "export-is-function");
  if (typeof mod.serializeEscrowAuditEvent === "function") {
    t.eq(
      mod.serializeEscrowAuditEvent({ eventId: "EV-1", kind: "funded", amountCents: 1500, at: "2026-01-02T00:00:00Z" }),
      "EV-1|funded|1500|2026-01-02T00:00:00Z",
      "event-1",
    );
    t.eq(
      mod.serializeEscrowAuditEvent({ eventId: "EV-2", kind: "released", amountCents: 0, at: "2026-01-03T00:00:00Z" }),
      "EV-2|released|0|2026-01-03T00:00:00Z",
      "event-2",
    );
    // Purity: same input twice -> identical output; input object unmutated.
    const ev = { eventId: "EV-3", kind: "held", amountCents: 42, at: "2026-01-04T00:00:00Z" };
    const before = JSON.stringify(ev);
    const r1 = mod.serializeEscrowAuditEvent(ev);
    const r2 = mod.serializeEscrowAuditEvent(ev);
    t.eq(r1, r2, "deterministic");
    t.eq(JSON.stringify(ev), before, "input-unmutated");
  }
}
t.report(seed, tree_digest);
