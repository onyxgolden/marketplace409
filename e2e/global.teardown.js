// Playwright global teardown for the tenant-portal smoke suite.
//
// Deletes every seeded row and auth user, then verifies nothing seeded
// remains. A leftover row fails the run even if every assertion passed:
// teardown is part of the suite's contract, not cleanup best-effort.
// If setup never ran (no run state), there is nothing to tear down.
import fs from "node:fs";
import { readTargetEnv } from "./helpers/target.js";
import { teardownRun } from "./helpers/seed.js";
import { RUN_STATE_PATH, clearRunState } from "./helpers/fixtures.js";

export default async function globalTeardown() {
  if (!fs.existsSync(RUN_STATE_PATH)) {
    console.log("[smoke-teardown] no run state; nothing to tear down.");
    return;
  }
  const config = readTargetEnv();
  const state = JSON.parse(fs.readFileSync(RUN_STATE_PATH, "utf8"));
  try {
    await teardownRun(config, state);
    console.log(`[smoke-teardown] run ${state.runId} fully torn down.`);
  } finally {
    clearRunState();
  }
}
