/**
 * Test entry: authenticate the source manifest BEFORE any test byte
 * runs (same trust bootstrap pattern as the slice-1 prototypes), then
 * run the node:test suites.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifest } from "../runner/bootstrap.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { ok, failures } = verifyManifest();
if (!ok) {
  console.error(`trust authentication failed — ${failures.join("; ")}`);
  process.exit(3);
}
const files = readdirSync(HERE).filter((f) => f.endsWith(".test.js")).sort().map((f) => join(HERE, f));
execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
