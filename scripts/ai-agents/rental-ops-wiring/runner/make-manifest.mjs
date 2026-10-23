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
delete files["runner/make-manifest.mjs"];
delete files["runner/manifest.json"];
addTree(join(REPO_ROOT, "src", "application", "ai-lab", "rental-ops"));
const manifest = {
  schema: "rental-ops-wiring-manifest@1",
  note: "SHA-256 pins for every executable byte the bootstrap may import. Re-pin with runner/make-manifest.mjs after source changes.",
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
};
writeFileSync(join(HERE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest pinned: ${Object.keys(manifest.files).length} files`);
