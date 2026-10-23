/**
 * Authoring tool: (re)pin runner/manifest.json with the SHA-256 of
 * every executable wiring source file. Run after any source change;
 * the battery and tests verify the manifest before executing.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const REPO_ROOT = join(WIRING_ROOT, "..", "..", "..");

const files = {};
const addTree = (dir, { tests = false } = {}) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") addTree(path, { tests }); continue; }
    if (!/\.(js|mjs)$/.test(entry.name)) continue;
    if (!tests && /\.test\.js$/.test(entry.name)) continue;
    const rel = relative(WIRING_ROOT, path).split("\\").join("/");
    files[rel] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
};
addTree(join(WIRING_ROOT, "src"));
addTree(join(WIRING_ROOT, "fixtures"));
addTree(join(WIRING_ROOT, "runner"));
delete files["runner/make-manifest.mjs"]; // authoring tool, not part of the runtime closure
delete files["runner/manifest.json"];
addTree(join(WIRING_ROOT, "tests"), { tests: true }); // test executables are pinned too
addTree(join(WIRING_ROOT, "battery"));
delete files["battery/make-battery.js"]; // authoring tool, not part of the runtime closure
delete files["battery/cases.json"]; // pinned by the battery manifest instead
// P2a-2: the Maintenance Manager battery is a parallel frozen battery
// with its own case/oracle manifest (battery-mm/manifest-mm.json).
addTree(join(WIRING_ROOT, "battery-mm"));
delete files["battery-mm/make-battery-mm.js"]; // authoring tool, not part of the runtime closure
delete files["battery-mm/cases-mm.json"]; // pinned by the battery-mm manifest instead
// battery/manifest.json STAYS pinned here (P666-004A): it is the root
// of the battery's case/oracle pins, so tampering with it must break
// the host trust chain, not just the battery's self-check. (addTree
// only walks .js/.mjs, so JSON roots are pinned explicitly.)
files["battery/manifest.json"] = createHash("sha256")
  .update(readFileSync(join(WIRING_ROOT, "battery", "manifest.json")))
  .digest("hex");
// P2a-2: the battery-mm manifest is the root of the MM battery's
// case/oracle pins — same trust rationale.
files["battery-mm/manifest-mm.json"] = createHash("sha256")
  .update(readFileSync(join(WIRING_ROOT, "battery-mm", "manifest-mm.json")))
  .digest("hex");
addTree(join(REPO_ROOT, "src", "application", "ai-lab", "rental-ops"));
// The shared classifier is a transitive executable dependency of
// propertyManagerJob.js — an unpinned import is an unauthenticated
// import (P666-004A probe 2).
files["../../../src/application/rental/isChargeForgeCollectible.js"] = createHash("sha256")
  .update(readFileSync(join(REPO_ROOT, "src", "application", "rental", "isChargeForgeCollectible.js")))
  .digest("hex");
// Package metadata governs module type and entry points — part of the closure.
files["package.json"] = createHash("sha256").update(readFileSync(join(WIRING_ROOT, "package.json"))).digest("hex");
const manifest = {
  schema: "rental-ops-wiring-manifest@2",
  note: "SHA-256 pins for the complete transitive executable closure: wiring sources, fixtures, runner, test executables, the battery launcher and package metadata. Re-pin with runner/make-manifest.mjs after source changes.",
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
};
writeFileSync(join(HERE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest pinned: ${Object.keys(manifest.files).length} files`);
