import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadBattery, runOnce } from "./battery.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const battery = loadBattery();
  const runs = [runOnce(battery), runOnce(battery), runOnce(battery)];
  const serialized = runs.map((r) => stableStringify(r));
  const deterministic = serialized[0] === serialized[1] && serialized[1] === serialized[2];
  const report = {
    suite: "eng-memory-battery",
    synthetic: true,
    batteryDigest: createHash("sha256").update(readFileSync(join(here, "fixtures", "battery-cases.json"), "utf8"), "utf8").digest("hex"),
    runs: 3,
    deterministic,
    runDigest: createHash("sha256").update(serialized[0], "utf8").digest("hex"),
    summary: runs[0],
  };
  const out = stableStringify(report) + "\n";
  if (values.out) writeFileSync(values.out, out);
  const s = runs[0];
  const allPass =
    deterministic &&
    s.leakage.clean &&
    s.cases.passed === s.cases.total &&
    s.gold.passed === s.gold.total;
  console.log(
    `battery: ${s.cases.passed}/${s.cases.total} cases, gold ${s.gold.passed}/${s.gold.total}, ` +
      `leakage ${s.leakage.clean ? "clean" : "DIRTY"}, deterministic ${deterministic ? "yes (3/3 byte-identical)" : "NO"}`,
  );
  if (!allPass) {
    for (const r of s.cases.results.filter((r) => !r.pass)) {
      console.log(`FAIL ${r.caseId}: ${r.failures.join("; ")}`);
    }
    for (const r of s.gold.results.filter((r) => !r.pass)) {
      console.log(`GOLD FAIL ${r.queryId}: ${r.failures.join("; ")}`);
    }
    process.exit(1);
  }
}

main();
