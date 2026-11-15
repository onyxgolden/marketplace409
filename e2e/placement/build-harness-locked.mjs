// Serialize placement-harness builds across Playwright workers: two
// spec files running in parallel would otherwise run build-harness.mjs
// concurrently into the same dist/ directory — and one worker's server
// could serve the other's half-written bundle. The lock serializes
// only the build; the tests themselves still run in parallel.
// A lock older than 5 minutes is stale (a crashed builder) and is
// removed instead of blocking the suite.
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export function buildHarnessLocked(repoRoot, placementDir) {
  const distDir = path.join(placementDir, "dist");
  mkdirSync(distDir, { recursive: true });
  const lockPath = path.join(distDir, ".build-lock");
  const deadline = Date.now() + 120000;
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5 * 60 * 1000) rmSync(lockPath, { force: true });
      } catch {
        // The lock vanished between the failed open and the stat — retry.
      }
      if (Date.now() > deadline) throw new Error("placement harness build lock timed out");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try {
    execFileSync("node", [path.join(placementDir, "build-harness.mjs")], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}
