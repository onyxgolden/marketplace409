/**
 * Test entry: authenticate the source manifest BEFORE any test byte
 * runs (same trust bootstrap pattern as the slice-1 prototypes), then
 * run the node:test suites.
 *
 * Test executables are discovered ONLY from the authenticated
 * manifest: a .test.js file present on disk but absent from the
 * manifest is refused (exit 3) before any test byte runs — unlisted
 * executables never execute.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifest } from "../runner/bootstrap.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { ok, failures } = verifyManifest();
if (!ok) {
  console.error(`trust authentication failed — ${failures.join("; ")}`);
  process.exit(3);
}
const manifest = JSON.parse(readFileSync(join(HERE, "..", "runner", "manifest.json"), "utf8"));
const listed = Object.keys(manifest.files)
  .filter((f) => f.startsWith("tests/") && f.endsWith(".test.js"))
  .sort();
const onDisk = readdirSync(HERE).filter((f) => f.endsWith(".test.js")).sort();
const unlisted = onDisk.filter((f) => !listed.includes(`tests/${f}`));
if (unlisted.length > 0) {
  console.error(`trust authentication failed — unlisted test executables refused: ${unlisted.join(", ")}`);
  process.exit(3);
}
if (listed.length === 0) {
  console.error("trust authentication failed — manifest lists no test executables");
  process.exit(3);
}
execFileSync(process.execPath, ["--test", ...listed.map((f) => join(HERE, "..", f))], { stdio: "inherit" });
