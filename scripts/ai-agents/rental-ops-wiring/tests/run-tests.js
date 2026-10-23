/**
 * Test entry: runs the node:test suites.
 *
 * Trust note (P666-004A): this file MUST NOT statically import any
 * candidate module. It is executed only through
 * runner/trust-entry.mjs, which authenticates the entire closure
 * against the host trust root BEFORE this file is imported — a
 * canary in any pinned file stops the run before a single test byte
 * runs. The previous static `import ... from "../runner/bootstrap.mjs"`
 * executed candidate code pre-auth and is the defect this removes.
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

const HERE = dirname(fileURLToPath(import.meta.url));
// The trust entry authenticated runner/manifest.json against the host
// root before importing this file; re-read it for discovery only.
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
