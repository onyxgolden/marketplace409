/**
 * _lib.mjs — shared oracle harness (host-owned, immutable).
 * Oracles import this; it is NOT part of any fixture tree.
 */

export function parseArgs(argv) {
  const out = { seed: "0", tree_digest: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed") out.seed = argv[i + 1] || "0";
    if (argv[i] === "--tree-digest") out.tree_digest = argv[i + 1] || "";
  }
  return out;
}

export function makeOracle(oracleId) {
  const failures = [];
  let assertions = 0;
  return {
    eq(actual, expected, label) {
      assertions++;
      if (!Object.is(actual, expected)) {
        failures.push(`${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
      }
    },
    ok(cond, label) {
      assertions++;
      if (!cond) failures.push(`${label}: condition false`);
    },
    fail(label) {
      assertions++;
      failures.push(label);
    },
    report(seed, treeDigest) {
      const status = failures.length === 0 ? "PASS" : "FAIL";
      const result = { oracle_id: oracleId, seed, tree_digest: treeDigest, status, assertions, failures };
      console.log(`ORACLE_RESULT ${JSON.stringify(result)}`);
      process.exitCode = status === "PASS" ? 0 : 1;
    },
  };
}
