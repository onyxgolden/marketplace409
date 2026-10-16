#!/usr/bin/env node
/**
 * inventory.mjs — read-only inventory of existing FORGE engineering playbooks.
 *
 * Never modifies the inventoried skills. Emits a JSON inventory describing
 * each skill root: file count, byte total, SKILL.md frontmatter presence,
 * frontmatter SHA-256, declared fields, license status, and FORGE-extension
 * presence. Used to produce the checked-in inventory.json.
 *
 * Usage:
 *   node src/inventory.mjs --out inventory.json label=path [label=path ...]
 *
 * Pure Node 24 ESM, node:fs / node:path / node:crypto only.
 */

import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";

function walkFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir).sort()) {
      const full = join(dir, e);
      const rel = relative(root, full);
      if (rel.split(sep).some((p) => p.startsWith(".") || p === "node_modules")) continue;
      const st = lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(full);
      else out.push({ rel, bytes: st.isFile() ? st.size : 0, symlink: st.isSymbolicLink() });
    }
  };
  walk(root);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function inventoryOne(label, root) {
  const abs = resolve(root);
  const rec = {
    label,
    path: abs,
    exists: existsSync(abs),
    file_count: 0,
    total_bytes: 0,
    symlink_count: 0,
    has_skill_md: false,
    frontmatter_present: false,
    frontmatter_sha256: null,
    frontmatter_fields: [],
    license_declared: null,
    forge_block_present: false,
    notes: [],
  };
  if (!rec.exists || !statSync(abs).isDirectory()) {
    rec.notes.push("path missing or not a directory");
    return rec;
  }
  const files = walkFiles(abs);
  rec.file_count = files.length;
  rec.total_bytes = files.reduce((n, f) => n + f.bytes, 0);
  rec.symlink_count = files.filter((f) => f.symlink).length;

  const skillMd = join(abs, "SKILL.md");
  if (existsSync(skillMd) && statSync(skillMd).isFile()) {
    rec.has_skill_md = true;
    const raw = readFileSync(skillMd, "utf8");
    const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/);
    if (m) {
      rec.frontmatter_present = true;
      rec.frontmatter_sha256 = sha256Hex(m[1]);
      const fields = [];
      for (const line of m[1].split("\n")) {
        const kv = line.match(/^([A-Za-z0-9_-]+):/);
        if (kv && !line.startsWith(" ") && !line.startsWith("\t")) fields.push(kv[1]);
      }
      rec.frontmatter_fields = fields;
      const lic = m[1].match(/^license:\s*(.+)$/m);
      rec.license_declared = lic ? lic[1].trim() : null;
      rec.forge_block_present = /^forge:/m.test(m[1]);
    } else {
      rec.notes.push("SKILL.md has no frontmatter block");
    }
  } else {
    rec.notes.push("no SKILL.md at skill root");
  }
  return rec;
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const pairs = args.filter((a) => a.includes("=") && !a.startsWith("--"));
  if (pairs.length === 0) {
    console.error("Usage: node src/inventory.mjs --out inventory.json label=path [label=path ...]");
    process.exit(2);
  }
  const items = pairs.map((p) => {
    const i = p.indexOf("=");
    return inventoryOne(p.slice(0, i), p.slice(i + 1));
  });
  const doc = {
    tool: "skill-manifest-inventory",
    generated_at: new Date().toISOString(),
    note: "Read-only inventory. Paths are host-local observations, not portable identities.",
    skills: items,
  };
  const json = JSON.stringify(doc, null, 2) + "\n";
  if (outPath) writeFileSync(outPath, json);
  else console.log(json);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) main();

export { inventoryOne };
