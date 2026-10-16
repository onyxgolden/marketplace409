/**
 * run-tests.js — official unit test entrypoint.
 * Usage: node tests/run-tests.js
 */

import { runAll, printResults } from "./harness.js";

await import("./checks.test.js");
await import("./mutation.test.js");
await import("./misc.test.js");

const res = await runAll();
process.exit(printResults(res));
