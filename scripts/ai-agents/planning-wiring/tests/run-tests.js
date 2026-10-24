/**
 * Tests entry for the planning closure. Discovers test executables
 * ONLY from the authenticated manifest (runner/manifest.json): a
 * .test.js file on disk but absent from the manifest is refused with
 * exit 3 before any test byte runs. Suites run one at a time
 * (--test-concurrency=1) because trust suites mutate the live
 * candidate tree.
 *
 * Usage: node tests/run-tests.js <trust-root-sha256> [--only <name>]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyClosure } from "../runner/trust-entry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(argv = []) {
  const [trustRoot, ...rest] = argv;
  if (!trustRoot) {
    console.error("usage: node tests/run-tests.js <trust-root-sha256> [--only <name>]");
    return 2;
  }
  const manifest = verifyClosure(trustRoot);
  const only = rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null;
  const suites = Object.keys(manifest.files ?? {})
    .filter((p) => p.endsWith(".test.js"))
    .filter((p) => !only || p.includes(only));
  if (suites.length === 0) {
    console.error("no test suites in the authenticated manifest");
    return 3;
  }
  let failed = 0;
  for (const suite of suites) {
    const res = spawnSync(process.execPath, ["--test-concurrency=1", join(HERE, "..", suite)], {
      stdio: "inherit",
    });
    if (res.status !== 0) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
