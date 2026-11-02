// Shared run-state plumbing for the smoke suite.
//
// Global setup writes the run state (ids, emails, run id — never secrets)
// to RUN_STATE_PATH; specs read it; global teardown reads it to delete
// everything seeded. The file is gitignored: it exists only for the life
// of one run, on one runner.
import fs from "node:fs";
import path from "node:path";

// Run state lives at <repo-root>/e2e/.e2e-run.json, resolved from the
// working directory — not from import.meta.url. The repo package is
// CommonJS, so Playwright loads these .js files through its CJS transform,
// which cannot handle import.meta; cwd resolution is consistent across
// global setup, specs, and teardown because all run in one invocation.
// Always run the suite from the repo root (see e2e/docs/e2e-smoke-run.md).
export const RUN_STATE_PATH = path.join(process.cwd(), "e2e", ".e2e-run.json");

// Per-run throwaway password for scratch-project auth users. Derived from
// the run id so specs can recompute it without the state file ever holding
// a password. Scratch accounts only; deleted in teardown.
export function passwordFor(runId) {
  return `Smk-${runId}-!9x`;
}

export function readRunState() {
  if (!fs.existsSync(RUN_STATE_PATH)) {
    throw new Error(
      "Smoke run state not found: global setup did not run. Run the suite through the Playwright config, not by file.",
    );
  }
  return JSON.parse(fs.readFileSync(RUN_STATE_PATH, "utf8"));
}

export function userFor(state, key) {
  const user = state.users[key];
  if (!user) throw new Error(`No seeded user for key: ${key}`);
  return { ...user, password: passwordFor(state.runId) };
}

export function writeRunState(state) {
  fs.writeFileSync(RUN_STATE_PATH, JSON.stringify(state, null, 2));
}

export function clearRunState() {
  if (fs.existsSync(RUN_STATE_PATH)) fs.unlinkSync(RUN_STATE_PATH);
}
