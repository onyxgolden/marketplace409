#!/usr/bin/env node
/**
 * linter.mjs — portable skill-manifest packaging linter (read-only).
 *
 * Validates a skill directory's SKILL.md frontmatter against the open
 * Agent Skills format (https://agentskills.io/specification) plus FORGE
 * policy extensions, and checks packaging hygiene (links, symlinks,
 * file/byte budgets). It NEVER executes skill scripts, NEVER touches the
 * network, NEVER resolves secrets, NEVER changes permissions, and NEVER
 * rewrites the skill. It reports packaging conformance only — never a
 * security approval. Security findings compose through the reserved
 * Skill Spectre slot (PROMPT_INJECTION / SUPPLY_CHAIN / MALWARE); this
 * linter adds no new high/critical security block categories.
 *
 * Usage:
 *   node src/linter.mjs <skill-root> [--spectre-findings findings.json]
 *
 * Exit codes: 0 conformant · 1 nonconformant or review_required ·
 * 2 operational error.
 *
 * Pure Node 24 ESM, node:fs / node:path / node:crypto only.
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
  existsSync,
} from "node:fs";
import { join, resolve, relative, dirname, basename, sep } from "node:path";
import { createHash } from "node:crypto";

export const TOOL_VERSION = "1.0.0";
export const SPEC_SOURCE = "https://agentskills.io/specification";
export const SPEC_RETRIEVED = "2026-10-16";
// SHA-256 of the specification text as retrieved on SPEC_RETRIEVED (frozen
// in the implementation report; upstream structural rules follow that page).
export const SPEC_SHA256 =
  "0fc7dcd9170dc07f72b7b5d93035af80e7d85c36ce3ae91aa54f6501afaeb25d";

const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_DIAGNOSTICS = 200;
const MAX_EVIDENCE_CHARS = 200;

const RECOGNIZED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "Unlicense",
  "0BSD",
]);

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Capabilities that conflict with synthetic/offline packaging policy when
// requested alongside synthetic-only data classes. Deterministic rule:
// membership in this list while permitted_data_classes is synthetic-only.
const DENIED_CAPABILITIES = new Set([
  "production.write",
  "credential.read",
  "secret.disclose",
  "tenant.pii.read",
]);

const FORGE_FIELDS = [
  "owner",
  "provenance",
  "license_status",
  "input_contract",
  "output_contract",
  "permitted_data_classes",
  "requested_capabilities",
  "completion_evidence",
  "retirement_policy",
];

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function makeDiag(code, severity, location, message, evidence) {
  const d = { code, severity, location, message };
  if (evidence !== undefined && evidence !== null && evidence !== "") {
    d.evidence = String(evidence).slice(0, MAX_EVIDENCE_CHARS);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Bounded YAML subset parser
// ---------------------------------------------------------------------------
// Supports: nested mappings via indentation, sequences via "- ", plain /
// single-quoted / double-quoted scalars, literal (|) and folded (>) block
// scalars, comments, true/false/null/~ and numbers. REJECTS: explicit tags
// (!foo, !!str), anchors/aliases (&a, *a). Never evaluates anything.

function stripComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) {
      if (i > 0 && line[i - 1] === "\\") continue;
      inD = !inD;
    } else if (c === "#" && !inS && !inD) {
      const prev = i === 0 ? " " : line[i - 1];
      if (prev === " " || prev === "\t") return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  // Flow sequence: ["a", "b"] — bounded, no nesting, no tags.
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    const items = [];
    let cur = "";
    let inS = false;
    let inD = false;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      if (c === "," && !inS && !inD) {
        items.push(parseScalar(cur));
        cur = "";
      } else {
        cur += c;
      }
    }
    items.push(parseScalar(cur));
    return items;
  }
  return s;
}

function indentOf(line) {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

/**
 * Parse a frontmatter block. Returns { data, diagnostics }.
 * diagnostics use location "SKILL.md:frontmatter".
 */
function parseFrontmatter(text, diags) {
  const lines = text.split("\n");
  const root = {};
  // Stack of {indent, container, key, depth}. Container is object or array.
  const stack = [{ indent: -1, container: root, depth: 0 }];
  let deepFlagged = false;
  let i = 0;

  const pushDiag = (code, message, evidence) =>
    diags.push(makeDiag(code, "error", "SKILL.md:frontmatter", message, evidence));

  while (i < lines.length) {
    const rawLine = lines[i];
    const stripped = stripComment(rawLine);
    if (stripped.trim() === "") {
      i++;
      continue;
    }
    const indent = indentOf(stripped);
    const content = stripped.slice(indent);

    // Pop stack to the parent whose indent is strictly less.
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    // Explicit YAML tags are never evaluated.
    if (/^!\S/.test(content) || /:\s*!\S/.test(content) || /\s!\S/.test(" " + content)) {
      const m = content.match(/!\S+/);
      pushDiag(
        "UNSUPPORTED_YAML_TAG",
        "Explicit YAML tags are not supported by the bounded subset parser; remove the tag.",
        m ? m[0] : content.slice(0, 40)
      );
      i++;
      continue;
    }
    if (/[&*][A-Za-z0-9_-]+/.test(content)) {
      pushDiag(
        "UNSUPPORTED_YAML_TAG",
        "Anchors/aliases are not supported by the bounded subset parser; inline the value.",
        content.slice(0, 40)
      );
      i++;
      continue;
    }

    if (parent.containerIsArray) {
      // Sequence item expected.
      const m = content.match(/^-\s?(.*)$/);
      if (!m) {
        pushDiag("MALFORMED_FRONTMATTER", "Expected a sequence item ('- ') at this indent.", content.slice(0, 60));
        i++;
        continue;
      }
      const val = m[1];
      const depth = parent.depth + 1;
      if (depth > MAX_DEPTH && !deepFlagged) {
        deepFlagged = true;
        pushDiag("DEEP_STRUCTURE", `Nesting exceeds the bounded depth of ${MAX_DEPTH}.`, "");
      }
      if (val === "") {
        const child = {};
        parent.container.push(child);
        stack.push({ indent, container: child, depth });
      } else if (val.includes(": ") || /:$/.test(val)) {
        // Inline map inside sequence — limited support: parse as single-pair map.
        const kv = val.match(/^([^:]+):\s?(.*)$/);
        const child = {};
        if (kv) child[kv[1].trim()] = parseScalar(kv[2]);
        parent.container.push(child);
        stack.push({ indent, container: child, depth });
      } else {
        parent.container.push(parseScalar(val));
      }
      i++;
      continue;
    }

    // Mapping line: key: value  OR  key: (nested)  OR  key: | / >
    const kv = content.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!kv) {
      pushDiag("MALFORMED_FRONTMATTER", "Unparseable frontmatter line.", content.slice(0, 60));
      i++;
      continue;
    }
    let key = kv[1].trim();
    // Strip quotes from key if present.
    if (key.length >= 2 && ((key[0] === '"' && key[key.length-1] === '"') || (key[0] === "'" && key[key.length-1] === "'"))) {
      key = key.slice(1, -1);
    }
    const rest = kv[2] === undefined ? "" : kv[2].trim();
    const depth = parent.depth + 1;

    if (Object.prototype.hasOwnProperty.call(parent.container, key)) {
      pushDiag("DUPLICATE_KEY", `Duplicate mapping key '${key}'.`, key);
    }

    if (depth > MAX_DEPTH && !deepFlagged) {
      deepFlagged = true;
      pushDiag("DEEP_STRUCTURE", `Nesting exceeds the bounded depth of ${MAX_DEPTH}.`, "");
    }

    if (rest === "" ) {
      // Nested block: could be a map or a sequence; decide by peeking.
      let j = i + 1;
      let childIsArray = false;
      let childIndent = indent + 1;
      while (j < lines.length) {
        const pl = stripComment(lines[j]);
        if (pl.trim() === "") { j++; continue; }
        childIndent = indentOf(pl);
        childIsArray = /^\s*-\s/.test(pl);
        break;
      }
      const child = childIsArray ? [] : {};
      parent.container[key] = child;
      const frame = { indent, container: child, depth };
      if (childIsArray) frame.containerIsArray = true;
      stack.push(frame);
      i++;
      continue;
    }

    if (rest === "|" || rest === ">" || rest === "|+" || rest === "|-" || rest === ">+" || rest === ">-") {
      // Block scalar: consume more-indented lines.
      const literal = rest[0] === "|";
      const blockLines = [];
      let j = i + 1;
      let blockIndent = -1;
      while (j < lines.length) {
        const bl = lines[j];
        if (bl.trim() === "") { blockLines.push(""); j++; continue; }
        const bi = indentOf(bl);
        if (blockIndent === -1) blockIndent = bi;
        if (bi < blockIndent || bi <= indent) break;
        blockLines.push(bl.slice(blockIndent));
        j++;
      }
      parent.container[key] = literal ? blockLines.join("\n") : blockLines.join(" ").replace(/\n/g, " ");
      i = j;
      continue;
    }

    parent.container[key] = parseScalar(rest);
    i++;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Skill root enumeration (bounded, symlink-safe, no excluded paths)
// ---------------------------------------------------------------------------

function isExcludedRel(rel) {
  const parts = rel.split(sep);
  return parts.some((p) => p.startsWith(".") || p === "node_modules");
}

/** Walk and return sorted relative file paths (symlinks listed, not followed). */
function enumerateFiles(root) {
  const out = [];
  const walk = (dir) => {
    const entries = readdirSync(dir).sort();
    for (const e of entries) {
      const full = join(dir, e);
      const rel = relative(root, full);
      if (isExcludedRel(rel)) continue;
      const st = lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        walk(full);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Markdown link extraction (inline + reference definitions, text only)
// ---------------------------------------------------------------------------

function extractLinks(mdText) {
  const links = [];
  const inline = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = inline.exec(mdText)) !== null) {
    links.push({ target: m[2], kind: m[0][0] === "!" ? "image" : "link" });
  }
  const refdef = /^[ \t]*\[[^\]]+\]:[ \t]*(\S+)/gm;
  while ((m = refdef.exec(mdText)) !== null) {
    links.push({ target: m[1], kind: "refdef" });
  }
  return links;
}

// ---------------------------------------------------------------------------
// Main lint
// ---------------------------------------------------------------------------

export function lintSkill(skillRoot, options = {}) {
  const diags = [];
  const root = resolve(skillRoot);
  const dirName = basename(root);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return fatalResult(root, dirName, "Skill root does not exist or is not a directory.");
  }

  // 1. Enumerate within budget; stop before opening the first excess file.
  let relFiles;
  try {
    relFiles = enumerateFiles(root);
  } catch (e) {
    return fatalResult(root, dirName, `Enumeration failed: ${e.message}`);
  }

  const admitted = []; // {rel, bytes, symlink, symlinkTarget}
  let admittedBytes = 0;
  let truncated = false;
  const symlinks = [];

  for (const rel of relFiles) {
    const full = join(root, rel);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      let target = null;
      let escapes = false;
      try {
        target = readlinkSync(full);
        const resolvedTarget = resolve(dirname(full), target);
        const relTarget = relative(root, resolvedTarget);
        escapes = relTarget === ".." || relTarget.startsWith(".." + sep);
      } catch {
        escapes = true;
      }
      symlinks.push({ rel, target, escapes });
      if (escapes) {
        diags.push(
          makeDiag("ESCAPING_SYMLINK", "error", rel, "Symlink resolves outside the skill root and is refused.", target)
        );
      }
      continue; // symlinks are metadata only; never followed or read
    }
    if (!st.isFile()) continue;
    const size = st.size;
    if (admitted.length + 1 > MAX_FILES || admittedBytes + size > MAX_TOTAL_BYTES) {
      truncated = true;
      diags.push(
        makeDiag(
          "FILE_BUDGET_EXCEEDED",
          "error",
          rel,
          `Admission stopped before opening '${rel}': cap is ${MAX_FILES} files / ${MAX_TOTAL_BYTES} bytes.`,
          rel
        )
      );
      break;
    }
    admitted.push({ rel, bytes: size });
    admittedBytes += size;
  }

  // 2. SKILL.md frontmatter.
  const skillMd = admitted.find((f) => f.rel === "SKILL.md");
  let frontmatter = null;
  let frontmatterText = null;
  let bodyText = "";
  if (!skillMd) {
    diags.push(makeDiag("MISSING_SKILL_MD", "error", "SKILL.md", "Skill root has no SKILL.md.", ""));
  } else {
    let raw;
    try {
      raw = readFileSync(join(root, "SKILL.md"), "utf8");
    } catch (e) {
      return fatalResult(root, dirName, `Cannot read SKILL.md: ${e.message}`);
    }
    if (raw.length > MAX_FRONTMATTER_BYTES * 4) {
      // crude early guard; precise check below on the frontmatter block
    }
    const fmMatch = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/);
    if (!fmMatch) {
      diags.push(
        makeDiag("MISSING_FRONTMATTER", "error", "SKILL.md", "SKILL.md has no YAML frontmatter block (--- ... ---).", "")
      );
      bodyText = raw;
    } else {
      frontmatterText = fmMatch[1];
      bodyText = raw.slice(fmMatch[0].length);
      if (Buffer.byteLength(frontmatterText, "utf8") > MAX_FRONTMATTER_BYTES) {
        diags.push(
          makeDiag("FRONTMATTER_TOO_LARGE", "error", "SKILL.md:frontmatter", `Frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes.`, "")
        );
        frontmatter = {};
      } else {
        frontmatter = parseFrontmatter(frontmatterText, diags);
      }
    }
  }

  // 3. Upstream field validation.
  if (frontmatter) {
    validateUpstream(frontmatter, dirName, diags, root, admitted);
    validateForgeExtensions(frontmatter, diags);
  }

  // 4. Link checks across admitted markdown files (SKILL.md depth 0, others depth 1).
  const mdFiles = admitted.filter((f) => f.rel.toLowerCase().endsWith(".md"));
  const skillMdTargets = new Set();
  for (const f of mdFiles) {
    let text;
    try {
      text = readFileSync(join(root, f.rel), "utf8");
    } catch {
      continue;
    }
    const isSkillMd = f.rel === "SKILL.md";
    for (const link of extractLinks(text)) {
      checkLink(link.target, f.rel, isSkillMd, root, diags);
      if (isSkillMd && link.target.endsWith(".md")) skillMdTargets.add(link.target);
    }
  }
  // Deep reference chains: references inside depth-1 md files (spec: keep
  // references one level deep from SKILL.md).
  for (const f of mdFiles) {
    if (f.rel === "SKILL.md") continue;
    let text;
    try {
      text = readFileSync(join(root, f.rel), "utf8");
    } catch {
      continue;
    }
    for (const link of extractLinks(text)) {
      if (/\.md(#|$)/.test(link.target) && !/^(https?:|mailto:)/.test(link.target)) {
        diags.push(
          makeDiag(
            "DEEP_REFERENCE_CHAIN",
            "note",
            `${f.rel}`,
            "Nested markdown reference chain deeper than one level from SKILL.md (spec recommends one level).",
            link.target
          )
        );
        break;
      }
    }
  }

  // 5. Embedded-instruction observation (packaging note only — never a
  //    security block; compose with Skill Spectre for security decisions).
  const overridePatterns = [
    /ignor(e|ing)\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    /disregard\s+(the\s+)?(system|all)\s+(instructions|rules|prompt)/i,
    /override\s+(your|the)\s+(system|core)\s+instructions/i,
    /you\s+are\s+now\s+(a|an|operating)\b/i,
  ];
  for (const pat of overridePatterns) {
    const m = bodyText.match(pat);
    if (m) {
      diags.push(
        makeDiag(
          "INSTRUCTION_OVERRIDE_NOTE",
          "note",
          "SKILL.md:body",
          "Packaging observation only: body contains agent instruction-override phrasing. This linter issues no security verdict; compose with Skill Spectre PROMPT_INJECTION findings for a security decision.",
          m[0].slice(0, 80)
        )
      );
      break;
    }
  }

  // 6. Deterministic ordering + output bound.
  diags.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.location < b.location ? -1 : a.location > b.location ? 1 : 0
  );
  const truncatedDiags = diags.length > MAX_DIAGNOSTICS;
  const finalDiags = diags.slice(0, MAX_DIAGNOSTICS);

  const hasError = finalDiags.some((d) => d.severity === "error");
  const hasReview = finalDiags.some((d) => d.severity === "review");
  const conformance = hasError ? "nonconformant" : hasReview ? "review_required" : "conformant";

  let spectre = null;
  if (options.spectreFindingsPath) {
    try {
      const raw = readFileSync(options.spectreFindingsPath, "utf8");
      spectre = JSON.parse(raw);
    } catch (e) {
      finalDiags.push(
        makeDiag("SPECTRE_INPUT_UNREADABLE", "error", options.spectreFindingsPath, "Could not read/parse the Skill Spectre findings file; it is attached verbatim, not evaluated.", e.message)
      );
      finalDiags.sort((a, b) => (a.code < b.code ? -1 : 1));
    }
  }

  return {
    tool: "skill-manifest-linter",
    tool_version: TOOL_VERSION,
    spec: { source: SPEC_SOURCE, retrieved: SPEC_RETRIEVED, sha256: SPEC_SHA256 },
    skill: { name: dirName, root },
    conformance,
    diagnostics: finalDiags,
    diagnostics_truncated: truncatedDiags,
    files: {
      admitted: admitted.length,
      admitted_bytes: admittedBytes,
      truncated,
      symlinks: symlinks.map((s) => ({ path: s.rel, target: s.target, escapes_root: s.escapes })),
    },
    security_composition: {
      note: "Packaging conformance only — never a security approval. Security decisions compose with Skill Spectre findings in the PROMPT_INJECTION / SUPPLY_CHAIN / MALWARE classes; this linter adds no new high/critical security block categories.",
      spectre_findings: spectre,
    },
  };
}

function fatalResult(root, dirName, message) {
  return {
    tool: "skill-manifest-linter",
    tool_version: TOOL_VERSION,
    spec: { source: SPEC_SOURCE, retrieved: SPEC_RETRIEVED, sha256: SPEC_SHA256 },
    skill: { name: dirName, root },
    conformance: "nonconformant",
    diagnostics: [makeDiag("OPERATIONAL_ERROR", "error", ".", message, "")],
    diagnostics_truncated: false,
    files: { admitted: 0, admitted_bytes: 0, truncated: false, symlinks: [] },
    security_composition: { note: "Packaging conformance only — never a security approval.", spectre_findings: null },
  };
}

// ---------------------------------------------------------------------------
// Upstream (Agent Skills spec) validation
// ---------------------------------------------------------------------------

function validateUpstream(fm, dirName, diags, root, admitted) {
  const at = (field) => `SKILL.md:frontmatter.${field}`;

  // name — required
  const name = fm.name;
  if (name === undefined || name === null || String(name).trim() === "") {
    diags.push(makeDiag("MISSING_NAME", "error", at("name"), "Required field 'name' is missing or empty.", ""));
  } else if (typeof name !== "string" || !NAME_RE.test(name) || name.length > 64) {
    diags.push(
      makeDiag("INVALID_NAME", "error", at("name"), "Field 'name' must be 1-64 chars: lowercase letters, numbers, hyphens; no leading/trailing or consecutive hyphens.", String(name).slice(0, 70))
    );
  } else if (name !== dirName) {
    diags.push(
      makeDiag("NAME_DIR_MISMATCH", "error", at("name"), `Field 'name' ('${name}') must match the parent directory name ('${dirName}').`, "")
    );
  }

  // description — required
  const desc = fm.description;
  if (desc === undefined || desc === null || String(desc).trim() === "") {
    diags.push(makeDiag("MISSING_DESCRIPTION", "error", at("description"), "Required field 'description' is missing or empty.", ""));
  } else if (typeof desc !== "string" || desc.length > 1024) {
    diags.push(
      makeDiag("DESCRIPTION_TOO_LONG", "error", at("description"), `Field 'description' must be 1-1024 characters (got ${String(desc).length}).`, "")
    );
  }

  // license — optional upstream; FORGE policy: unknown => REVIEW_REQUIRED
  const lic = fm.license;
  let licenseOk = false;
  if (lic === undefined || lic === null || String(lic).trim() === "") {
    diags.push(
      makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), "No license declared. FORGE policy: unknown license becomes REVIEW_REQUIRED, never an inferred permissive license.", "")
    );
  } else if (typeof lic !== "string") {
    diags.push(makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), "License field is not a string; treated as unknown.", ""));
  } else {
    const v = lic.trim();
    if (RECOGNIZED_LICENSES.has(v)) {
      licenseOk = true;
    } else {
      // Reference to a bundled license file?
      const ref = v.replace(/^(see|file:)\s+/i, "").trim();
      const candidate = join(root, ref);
      const inside = relative(root, resolve(candidate)) !== ".." && !relative(root, resolve(candidate)).startsWith(".." + sep);
      if (inside && existsSync(candidate) && statSync(candidate).isFile()) {
        licenseOk = true;
        diags.push(makeDiag("LICENSE_FILE_REFERENCE", "note", at("license"), "License references a bundled file; verify its text independently.", ref));
      } else {
        diags.push(
          makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), `Unrecognized license '${v}'. FORGE policy: unknown license becomes REVIEW_REQUIRED, never an inferred permissive license.`, v.slice(0, 80))
        );
      }
    }
  }

  // compatibility — optional, <= 500 chars
  if (fm.compatibility !== undefined && fm.compatibility !== null) {
    if (typeof fm.compatibility !== "string" || fm.compatibility.length > 500 || fm.compatibility.length < 1) {
      diags.push(
        makeDiag("COMPATIBILITY_TOO_LONG", "error", at("compatibility"), "Field 'compatibility' must be 1-500 characters when provided.", "")
      );
    }
  }

  // metadata — optional, map of string -> string
  if (fm.metadata !== undefined && fm.metadata !== null) {
    if (typeof fm.metadata !== "object" || Array.isArray(fm.metadata)) {
      diags.push(makeDiag("INVALID_METADATA_VALUE", "error", at("metadata"), "Field 'metadata' must be a mapping of string keys to string values.", ""));
    } else {
      for (const [k, v] of Object.entries(fm.metadata)) {
        if (typeof v !== "string") {
          diags.push(
            makeDiag("INVALID_METADATA_VALUE", "error", at(`metadata.${k}`), "metadata values must be strings per the Agent Skills spec.", typeof v)
          );
        }
      }
    }
  }

  // allowed-tools — optional, space-separated string; metadata only, never grants
  if (fm["allowed-tools"] !== undefined && fm["allowed-tools"] !== null) {
    if (typeof fm["allowed-tools"] !== "string") {
      diags.push(makeDiag("INVALID_ALLOWED_TOOLS", "error", at("allowed-tools"), "Field 'allowed-tools' must be a space-separated string.", ""));
    } else if (fm["allowed-tools"].trim() !== "") {
      diags.push(
        makeDiag("ALLOWED_TOOLS_METADATA_ONLY", "note", at("allowed-tools"), "Requested/allowed-tools metadata never grants actual tool permission; it is packaging metadata only.", fm["allowed-tools"].slice(0, 80))
      );
    }
  }

  // Unknown top-level fields (besides the documented FORGE extension block)
  const known = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools", "forge"]);
  for (const k of Object.keys(fm)) {
    if (!known.has(k)) {
      diags.push(makeDiag("UNKNOWN_TOP_LEVEL_FIELD", "note", at(k), `Unknown top-level field '${k}' is not part of the Agent Skills spec or the documented FORGE extensions.`, k));
    }
  }

  return licenseOk;
}

// ---------------------------------------------------------------------------
// FORGE policy extensions (labeled as extensions, not upstream requirements)
// ---------------------------------------------------------------------------

function validateForgeExtensions(fm, diags) {
  const at = (field) => `SKILL.md:frontmatter.forge${field ? "." + field : ""}`;
  const forge = fm.forge;
  if (forge === undefined || forge === null) {
    diags.push(
      makeDiag("FORGE_EXTENSIONS_MISSING", "review", at(""), "FORGE policy extensions block ('forge:') is absent. FORGE requires provenance/license status, owner, input/output contract, permitted data classes, requested capabilities, completion evidence and retirement policy; these are FORGE extensions, not upstream spec fields.", "")
    );
    return;
  }
  if (typeof forge !== "object" || Array.isArray(forge)) {
    diags.push(makeDiag("INVALID_FORGE_BLOCK", "error", at(""), "The 'forge:' block must be a mapping.", ""));
    return;
  }
  for (const field of FORGE_FIELDS) {
    const v = forge[field];
    // An explicitly empty list is a deliberate "none" declaration, not missing.
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      diags.push(
        makeDiag("FORGE_FIELD_MISSING", "note", at(field), `FORGE extension field '${field}' is missing; recommended for install review.`, "")
      );
    }
  }
  if (forge.license_status !== undefined && forge.license_status !== null) {
    const ls = String(forge.license_status);
    if (!["verified", "review_required", "unknown"].includes(ls)) {
      diags.push(makeDiag("INVALID_FORGE_FIELD", "error", at("license_status"), "forge.license_status must be one of: verified, review_required, unknown.", ls.slice(0, 40)));
    } else if (ls === "unknown") {
      diags.push(
        makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license_status"), "FORGE policy: unknown license becomes REVIEW_REQUIRED, never an inferred permissive license.", "")
      );
    }
  }
  for (const listField of ["permitted_data_classes", "requested_capabilities"]) {
    const v = forge[listField];
    if (v !== undefined && v !== null && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) {
      diags.push(makeDiag("INVALID_FORGE_FIELD", "error", at(listField), `forge.${listField} must be a list of strings.`, ""));
    }
  }

  // Capability conflict: denied capabilities requested under synthetic-only data classes.
  const req = Array.isArray(forge.requested_capabilities) ? forge.requested_capabilities : [];
  const classes = Array.isArray(forge.permitted_data_classes) ? forge.permitted_data_classes : [];
  const syntheticOnly = classes.length > 0 && classes.every((c) => /synthetic/i.test(c));
  for (const cap of req) {
    if (DENIED_CAPABILITIES.has(cap) && (syntheticOnly || classes.length === 0)) {
      diags.push(
        makeDiag("CAPABILITY_CONFLICT", "error", at("requested_capabilities"), `Requested capability '${cap}' conflicts with declared data classes [${classes.join(", ")}].`, cap)
      );
    }
  }
  // Contradiction: allowed-tools non-empty while requested_capabilities explicitly empty.
  const allowedTools = typeof fm["allowed-tools"] === "string" ? fm["allowed-tools"].trim() : "";
  if (allowedTools !== "" && Array.isArray(forge.requested_capabilities) && forge.requested_capabilities.length === 0) {
    diags.push(
      makeDiag("CAPABILITY_CONFLICT", "error", at("requested_capabilities"), "allowed-tools lists tools while forge.requested_capabilities is explicitly empty: contradictory capability metadata.", allowedTools.slice(0, 60))
    );
  }
}

// ---------------------------------------------------------------------------
// Link checks
// ---------------------------------------------------------------------------

function checkLink(target, fromRel, isSkillMd, root, diags) {
  const loc = `${fromRel}`;
  if (/^(https?:|mailto:)/i.test(target)) {
    diags.push(makeDiag("EXTERNAL_LINK", "note", loc, "External link is packaging metadata; never fetched by this linter (no network).", target.slice(0, 100)));
    return;
  }
  if (target.startsWith("#") || target.trim() === "") return;
  if (target.startsWith("/")) {
    diags.push(makeDiag("ABSOLUTE_PATH_LINK", "error", loc, "Absolute filesystem path link is not portable.", target.slice(0, 100)));
    return;
  }
  // Strip fragment for path resolution.
  const hashIdx = target.indexOf("#");
  const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  if (pathPart === "") return;
  const resolved = resolve(root, dirname(fromRel), pathPart);
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(".." + sep)) {
    diags.push(makeDiag("PATH_TRAVERSAL_LINK", "error", loc, "Link escapes the skill root.", target.slice(0, 100)));
    return;
  }
  let st;
  try {
    st = lstatSync(resolved);
  } catch {
    st = null;
  }
  if (!st) {
    diags.push(makeDiag("BROKEN_REFERENCE", "error", loc, "Local link target does not exist inside the skill root.", target.slice(0, 100)));
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const spectreIdx = args.indexOf("--spectre-findings");
  const spectreFindingsPath = spectreIdx !== -1 ? args[spectreIdx + 1] : null;

  if (positional.length !== 1) {
    console.error("Usage: node src/linter.mjs <skill-root> [--spectre-findings findings.json]");
    process.exit(2);
  }
  const report = lintSkill(positional[0], { spectreFindingsPath });
  console.log(JSON.stringify(report, null, 2));
  if (report.conformance === "conformant") process.exit(0);
  if (report.diagnostics.some((d) => d.code === "OPERATIONAL_ERROR")) process.exit(2);
  process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) main();
