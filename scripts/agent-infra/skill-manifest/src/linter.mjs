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
 * Conformance is derived from the FULL diagnostic set BEFORE the output
 * bound is applied: truncating the presented list can never downgrade an
 * actual error/review into a conformant result.
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
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join, resolve, relative, dirname, basename, sep } from "node:path";
import { createHash } from "node:crypto";

export const TOOL_VERSION = "1.0.0";
export const SPEC_SOURCE = "https://agentskills.io/specification";
export const SPEC_RETRIEVED = "2026-10-16";
// SHA-256 of the specification text as retrieved on SPEC_RETRIEVED (frozen
// in the implementation report; upstream structural rules follow that page).
// A retrievable exact snapshot of the retrieved page is kept at
// docs/spec-snapshot-2026-10-16.md so reviewers can reproduce the hash.
export const SPEC_SHA256 =
  "0fc7dcd9170dc07f72b7b5d93035af80e7d85c36ce3ae91aa54f6501afaeb25d";

const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_DIAGNOSTICS = 200;
const MAX_EVIDENCE_CHARS = 200;
export const MAX_SPECTRE_BYTES = 256 * 1024;
// Attachment structural bound: parsed findings deeper than this are
// refused before attachment so serialization can never blow the stack.
const MAX_SPECTRE_DEPTH = 100;
// Exact serialized-output bound: the emitted report (pretty-printed JSON)
// is never larger than this; over-bound output falls back to a bounded
// report that omits the attachment with a named status.
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
// Enumeration bounds: the linter must reach its first admission decision
// without being exhausted by a deeply nested or huge directory tree.
const MAX_DIR_DEPTH = 16;
const MAX_ENUM_ENTRIES = 100000;

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

// Scalar FORGE fields must be nonempty strings when present.
const FORGE_SCALAR_FIELDS = [
  "owner",
  "provenance",
  "license_status",
  "input_contract",
  "output_contract",
  "completion_evidence",
  "retirement_policy",
];

// Mapping keys that are refused outright: assignment through them could
// change the parsed object's prototype or shadow Object members, letting
// required fields be satisfied from an inherited prototype.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Sentinel: a scalar that failed to parse. Callers must not store it.
const PARSE_FAILED = Symbol("parse-failed");

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
// (!foo, !!str), anchors/aliases (&a, *a), dangerous mapping keys
// (__proto__/constructor/prototype), malformed quoted/flow scalars.
// All mappings are null-prototype objects; dangerous keys are refused into
// a discarded container so they can never satisfy required fields.
// One depth limit (MAX_DEPTH) applies to every accepted syntax path:
// indentation nesting and flow-sequence nesting alike.
// Never evaluates anything.

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

/**
 * Parse one scalar. diags receives MALFORMED_SCALAR / DEEP_STRUCTURE.
 *
 * One explicit depth convention: containerDepth is the depth of the
 * mapping/sequence that directly contains this scalar (the document root
 * is 0); flowDepth counts flow-sequence nesting above this scalar (0 for
 * the scalar itself). A flow sequence at combined depth
 * (containerDepth + flowDepth + 1) beyond MAX_DEPTH is refused, so mixed
 * block/flow nesting shares the single MAX_DEPTH budget instead of each
 * syntax path counting from zero independently.
 *
 * Quoted scalars are consumed completely: the closing quote must
 * terminate the scalar — trailing tokens and unescaped interior quotes
 * are MALFORMED_SCALAR. Backslash escapes (\n \t \r \" \\) decode in
 * double-quoted scalars; '' decodes to ' in single-quoted scalars;
 * unrecognized escapes are preserved verbatim.
 *
 * Returns PARSE_FAILED when the scalar is malformed — callers must not
 * store the raw text, so an unsupported form can never masquerade as a
 * valid value and bypass validation.
 */
function parseScalar(raw, diags, flowDepth = 0, containerDepth = 0) {
  const bad = (message, evidence) => {
    diags.push(makeDiag("MALFORMED_SCALAR", "error", "SKILL.md:frontmatter", message, evidence));
    return PARSE_FAILED;
  };
  const s = raw.trim();
  if (s === "") return null;
  if (s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let out = "";
    let i = 1;
    let closed = false;
    while (i < s.length) {
      const c = s[i];
      if (q === '"' && c === "\\") {
        if (i + 1 >= s.length) {
          return bad("Malformed quoted scalar: trailing backslash.", s.slice(0, 60));
        }
        const e = s[i + 1];
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else out += c + e; // preserve unrecognized escapes verbatim
        i += 2;
        continue;
      }
      if (q === "'" && c === "'" && s[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (c === q) {
        closed = true;
        i += 1;
        break;
      }
      out += c;
      i += 1;
    }
    if (!closed) {
      return bad("Malformed quoted scalar: unterminated quote.", s.slice(0, 60));
    }
    if (i < s.length) {
      return bad("Malformed quoted scalar: trailing tokens after the closing quote.", s.slice(0, 60));
    }
    return out;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  const opensFlow = s.startsWith("[");
  const closesFlow = s.endsWith("]");
  if (opensFlow !== closesFlow) {
    return bad("Malformed flow sequence: unbalanced brackets.", s.slice(0, 60));
  }
  // Flow sequence: ["a", "b"] — the single MAX_DEPTH budget covers the
  // enclosing structural depth plus flow nesting.
  if (opensFlow && closesFlow) {
    if (containerDepth + flowDepth + 1 > MAX_DEPTH) {
      diags.push(
        makeDiag("DEEP_STRUCTURE", "error", "SKILL.md:frontmatter", `Nesting exceeds the bounded depth of ${MAX_DEPTH}.`, "")
      );
      return [];
    }
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    const items = [];
    let cur = "";
    let inS = false;
    let inD = false;
    const flush = () => {
      const v = parseScalar(cur, diags, flowDepth + 1, containerDepth);
      items.push(v === PARSE_FAILED ? null : v);
      cur = "";
    };
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      if (c === "," && !inS && !inD) {
        flush();
      } else {
        cur += c;
      }
    }
    flush();
    return items;
  }
  return s;
}

function indentOf(line) {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

/** Null-prototype mapping factory. */
function newMap() {
  return Object.create(null);
}

/**
 * Parse a frontmatter block. Returns the parsed mapping (null-prototype).
 * diagnostics use location "SKILL.md:frontmatter".
 */
function parseFrontmatter(text, diags) {
  const lines = text.split("\n");
  const root = newMap();
  // Stack of {indent, container, depth}. Container is a null-prototype
  // object or an array.
  const stack = [{ indent: -1, container: root, depth: 0 }];
  let deepFlagged = false;
  let i = 0;

  const pushDiag = (code, message, evidence) =>
    diags.push(makeDiag(code, "error", "SKILL.md:frontmatter", message, evidence));

  // Consume a block scalar (| or >) starting after line i; returns the index
  // of the first unconsumed line. The value is discarded by the caller when
  // the key was dangerous.
  const consumeBlockScalar = (startIdx, indent) => {
    let j = startIdx + 1;
    let blockIndent = -1;
    while (j < lines.length) {
      const bl = lines[j];
      if (bl.trim() === "") { j++; continue; }
      const bi = indentOf(bl);
      if (blockIndent === -1) blockIndent = bi;
      if (bi < blockIndent || bi <= indent) break;
      j++;
    }
    return j;
  };

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
        const child = newMap();
        parent.container.push(child);
        stack.push({ indent, container: child, depth });
      } else if (val.includes(": ") || /:$/.test(val)) {
        // Inline map inside sequence — limited support: parse as single-pair map.
        const kv = val.match(/^([^:]+):\s?(.*)$/);
        const child = newMap();
        if (kv) {
          const k = kv[1].trim();
          if (DANGEROUS_KEYS.has(k)) {
            pushDiag(
              "DANGEROUS_MAPPING_KEY",
              `Dangerous mapping key '${k}' is refused; it cannot appear as an ordinary mapping entry.`,
              k
            );
          } else {
            const v = parseScalar(kv[2], diags, 0, depth);
            if (v !== PARSE_FAILED) child[k] = v;
          }
        }
        parent.container.push(child);
        stack.push({ indent, container: child, depth });
      } else {
        const v = parseScalar(val, diags, 0, parent.depth);
        parent.container.push(v === PARSE_FAILED ? null : v);
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

    // Dangerous keys are refused into a discarded container: they can never
    // satisfy required fields through prototype inheritance.
    if (DANGEROUS_KEYS.has(key)) {
      pushDiag(
        "DANGEROUS_MAPPING_KEY",
        `Dangerous mapping key '${key}' is refused; parsed into a discarded container so it cannot satisfy required fields.`,
        key
      );
      if (rest === "") {
        stack.push({ indent, container: newMap(), depth });
        i++;
      } else if (/^[|>][+-]?$/.test(rest)) {
        i = consumeBlockScalar(i, indent);
      } else {
        parseScalar(rest, diags, 0, parent.depth); // parse for diagnostics, discard value
        i++;
      }
      continue;
    }

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
      const child = childIsArray ? [] : newMap();
      parent.container[key] = child;
      const frame = { indent, container: child, depth };
      if (childIsArray) frame.containerIsArray = true;
      stack.push(frame);
      i++;
      continue;
    }

    if (/^[|>][+-]?$/.test(rest)) {
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

    const v = parseScalar(rest, diags, 0, parent.depth);
    if (v !== PARSE_FAILED) parent.container[key] = v;
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

/**
 * Audit every component of a lexically-in-root relative path WITHOUT
 * following symlinks. Returns null when safe, else
 * {kind: "excluded"|"symlink-hop", detail}. Excluded components (dot paths,
 * node_modules) are refused; any symlink component — intermediate or final —
 * is refused because containment cannot be verified without following it.
 */
function auditRelPath(root, rel) {
  const parts = rel.split(sep);
  let acc = root;
  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    if (part === "" || part === ".") continue;
    if (part === "..") return { kind: "escapes", detail: rel };
    if (part.startsWith(".") || part === "node_modules") {
      return { kind: "excluded", detail: parts.slice(0, idx + 1).join(sep) };
    }
    acc = join(acc, part);
    let st = null;
    try {
      st = lstatSync(acc);
    } catch {
      st = null;
    }
    if (st && st.isSymbolicLink()) {
      return { kind: "symlink-hop", detail: parts.slice(0, idx + 1).join(sep) };
    }
  }
  return null;
}

/**
 * Walk and return sorted relative file paths (symlinks listed, not
 * followed). Bounded: directory depth and total enumerated entries are
 * capped so a hostile tree cannot exhaust the linter before its first
 * admission decision. Bounds violations are recorded in diags.
 */
function enumerateFiles(root, diags) {
  const out = [];
  const state = { entries: 0, aborted: false };
  const walk = (dir, depth) => {
    if (state.aborted) return;
    if (depth > MAX_DIR_DEPTH) {
      diags.push(
        makeDiag(
          "ENUM_DIR_TOO_DEEP",
          "error",
          relative(root, dir),
          `Directory nesting exceeds ${MAX_DIR_DEPTH}; enumeration stopped (bounded).`,
          ""
        )
      );
      state.aborted = true;
      return;
    }
    const entries = readdirSync(dir).sort();
    for (const e of entries) {
      if (state.aborted) return;
      if (++state.entries > MAX_ENUM_ENTRIES) {
        diags.push(
          makeDiag(
            "ENUM_BUDGET_EXCEEDED",
            "error",
            ".",
            `Enumeration exceeded ${MAX_ENUM_ENTRIES} entries; stopped (bounded).`,
            ""
          )
        );
        state.aborted = true;
        return;
      }
      const full = join(dir, e);
      const rel = relative(root, full);
      if (isExcludedRel(rel)) continue;
      const st = lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        walk(full, depth + 1);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root, 0);
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

/**
 * Bounded UTF-8 read: never materializes more than maxBytes + 1 bytes from
 * the file, so an oversized attachment is refused on its bounded prefix
 * without ever loading the full input into memory. Returns
 * {ok:true, text, truncated} or {ok:false, error}.
 */
export function readBoundedUtf8(path, maxBytes) {
  let fd = -1;
  try {
    fd = openSync(path, "r");
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buf, total, maxBytes + 1 - total, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) break;
    }
    return { ok: true, text: buf.subarray(0, total).toString("utf8"), truncated: total > maxBytes };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Structural depth of a parsed JSON value, measured iteratively (no
 * recursion, so adversarial nesting cannot overflow the stack). The root
 * counts as depth 1. Exits early past MAX_SPECTRE_DEPTH.
 */
function structuralDepth(value) {
  let max = 0;
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [v, d] = stack.pop();
    if (d > max) {
      max = d;
      if (max > MAX_SPECTRE_DEPTH) return max;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e = v[i];
        if (e !== null && typeof e === "object") stack.push([e, d + 1]);
      }
    } else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) {
        const e = v[k];
        if (e !== null && typeof e === "object") stack.push([e, d + 1]);
      }
    }
  }
  return max;
}

export function lintSkill(skillRoot, options = {}) {
  const diags = [];
  const root = resolve(skillRoot);
  const dirName = basename(root);

  // Declared-root containment: the root itself must be a real directory.
  // A symlinked root is refused outright — containment is declared against
  // the real directory, and resolving an arbitrary symlink chain is out of
  // scope for this narrow packaging slice.
  let rootLst;
  try {
    rootLst = lstatSync(root);
  } catch {
    return fatalResult(root, dirName, "Skill root does not exist or is not a directory.");
  }
  if (rootLst.isSymbolicLink()) {
    return fatalResult(
      root,
      dirName,
      "Skill root is a symlink; refused (declared-root containment requires a real directory)."
    );
  }
  if (!rootLst.isDirectory()) {
    return fatalResult(root, dirName, "Skill root does not exist or is not a directory.");
  }

  // 1. Enumerate within budget; stop before opening the first excess file.
  let relFiles;
  try {
    relFiles = enumerateFiles(root, diags);
  } catch (e) {
    return fatalResult(root, dirName, `Enumeration failed: ${e.message}`);
  }

  const admitted = []; // {rel, bytes}
  let seenCount = 0; // admitted files + symlink metadata entries (both bounded)
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
      // Symlink metadata only; never followed. The target is audited
      // lexically AND component-wise: escaping targets, targets crossing
      // excluded paths, and targets whose intermediate components are
      // symlinks (hidden chains) are all refused.
      let target = null;
      let escapes = false;
      let reason = "";
      try {
        target = readlinkSync(full);
        const resolvedTarget = resolve(dirname(full), target);
        const relTarget = relative(root, resolvedTarget);
        if (relTarget === ".." || relTarget.startsWith(".." + sep)) {
          escapes = true;
          reason = "resolves outside the skill root";
        } else {
          const audit = auditRelPath(root, relTarget);
          if (audit) {
            escapes = true;
            reason =
              audit.kind === "excluded"
                ? `resolves through excluded path '${audit.detail}'`
                : `resolves through symlink component '${audit.detail}' (hidden chain)`;
          }
        }
      } catch {
        escapes = true;
        reason = "unreadable symlink";
      }
      if (seenCount + 1 > MAX_FILES || admittedBytes > MAX_TOTAL_BYTES) {
        truncated = true;
        diags.push(
          makeDiag(
            "FILE_BUDGET_EXCEEDED",
            "error",
            rel,
            `Admission stopped before recording '${rel}': cap is ${MAX_FILES} files / ${MAX_TOTAL_BYTES} bytes.`,
            rel
          )
        );
        break;
      }
      seenCount++;
      symlinks.push({ rel, target, escapes });
      if (escapes) {
        diags.push(
          makeDiag("ESCAPING_SYMLINK", "error", rel, `Symlink ${reason} and is refused.`, target)
        );
      }
      continue;
    }
    if (!st.isFile()) continue;
    const size = st.size;
    if (seenCount + 1 > MAX_FILES || admittedBytes + size > MAX_TOTAL_BYTES) {
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
    seenCount++;
    admitted.push({ rel, bytes: size });
    admittedBytes += size;
  }

  // 2. SKILL.md frontmatter.
  const skillMd = admitted.find((f) => f.rel === "SKILL.md");
  let frontmatter = null;
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
    const fmMatch = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/);
    if (!fmMatch) {
      diags.push(
        makeDiag("MISSING_FRONTMATTER", "error", "SKILL.md", "SKILL.md has no YAML frontmatter block (--- ... ---).", "")
      );
      bodyText = raw;
    } else {
      const frontmatterText = fmMatch[1];
      bodyText = raw.slice(fmMatch[0].length);
      if (Buffer.byteLength(frontmatterText, "utf8") > MAX_FRONTMATTER_BYTES) {
        diags.push(
          makeDiag("FRONTMATTER_TOO_LARGE", "error", "SKILL.md:frontmatter", `Frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes.`, "")
        );
        frontmatter = newMap();
      } else {
        frontmatter = parseFrontmatter(frontmatterText, diags);
      }
    }
  }

  // 3. Upstream field validation.
  if (frontmatter) {
    validateUpstream(frontmatter, dirName, diags, root);
    validateForgeExtensions(frontmatter, diags);
  }

  // 4. Link checks across admitted markdown files (SKILL.md depth 0, others depth 1).
  const mdFiles = admitted.filter((f) => f.rel.toLowerCase().endsWith(".md"));
  for (const f of mdFiles) {
    let text;
    try {
      text = readFileSync(join(root, f.rel), "utf8");
    } catch {
      continue;
    }
    for (const link of extractLinks(text)) {
      checkLink(link.target, f.rel, root, diags);
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

  // 6. Skill Spectre attachment — read BEFORE conformance is derived, so an
  //    explicitly requested but missing/malformed/oversize attachment has an
  //    honest unavailable outcome instead of a conformant result with a
  //    hidden error. Findings are copied verbatim within a size bound;
  //    packaging conformance and Spectre security disposition stay separate.
  //    Admission is bounded before materialization: the raw read never
  //    exceeds MAX_SPECTRE_BYTES + 1 bytes, and parsed structure deeper
  //    than MAX_SPECTRE_DEPTH is refused before attachment, so a hostile
  //    input can never exhaust input memory or the serializer's stack.
  let spectre = null;
  let attachmentStatus = "not_requested";
  if (options.spectreFindingsPath) {
    const sp = options.spectreFindingsPath;
    const read = readBoundedUtf8(sp, MAX_SPECTRE_BYTES);
    if (!read.ok) {
      attachmentStatus = "unavailable";
      diags.push(
        makeDiag(
          "SPECTRE_INPUT_UNREADABLE",
          "error",
          sp,
          "Could not read the Skill Spectre findings file; it is not attached.",
          read.error
        )
      );
    } else if (read.truncated) {
      attachmentStatus = "rejected_oversize";
      diags.push(
        makeDiag(
          "SPECTRE_INPUT_TOO_LARGE",
          "error",
          sp,
          `Spectre findings exceed the ${MAX_SPECTRE_BYTES}-byte attachment bound; not attached.`,
          ""
        )
      );
    } else {
      let parsed;
      try {
        parsed = JSON.parse(read.text);
      } catch (e) {
        parsed = PARSE_FAILED;
      }
      if (parsed === PARSE_FAILED || parsed === null || typeof parsed !== "object") {
        attachmentStatus = "malformed";
        diags.push(
          makeDiag(
            "SPECTRE_INPUT_MALFORMED",
            "error",
            sp,
            "Spectre findings file is not valid JSON object data; not attached.",
            ""
          )
        );
      } else if (structuralDepth(parsed) > MAX_SPECTRE_DEPTH) {
        attachmentStatus = "rejected_overdeep";
        diags.push(
          makeDiag(
            "SPECTRE_INPUT_TOO_DEEP",
            "error",
            sp,
            `Spectre findings exceed the ${MAX_SPECTRE_DEPTH}-level structural depth bound; not attached.`,
            ""
          )
        );
      } else {
        attachmentStatus = "attached";
        spectre = parsed;
      }
    }
  }

  // 7. Deterministic ordering. Conformance is derived from the FULL
  //    diagnostic set BEFORE the output bound is applied — an omitted
  //    error/review can never produce a conformant result. The omitted
  //    summary keeps severity/count totals so nothing is silently lost.
  diags.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.location < b.location ? -1 : a.location > b.location ? 1 : 0
  );
  const hasError = diags.some((d) => d.severity === "error");
  const hasReview = diags.some((d) => d.severity === "review");
  const conformance = hasError ? "nonconformant" : hasReview ? "review_required" : "conformant";

  const capped = finalizeDiagnostics(diags);

  return {
    tool: "skill-manifest-linter",
    tool_version: TOOL_VERSION,
    spec: { source: SPEC_SOURCE, retrieved: SPEC_RETRIEVED, sha256: SPEC_SHA256 },
    skill: { name: dirName, root },
    conformance,
    diagnostics: capped.diagnostics,
    diagnostics_truncated: capped.truncated,
    diagnostics_omitted: capped.omitted,
    files: {
      admitted: admitted.length,
      admitted_bytes: admittedBytes,
      truncated,
      symlinks: symlinks.map((s) => ({ path: s.rel, target: s.target, escapes_root: s.escapes })),
    },
    security_composition: {
      note: "Packaging conformance only — never a security approval. Security decisions compose with Skill Spectre findings in the PROMPT_INJECTION / SUPPLY_CHAIN / MALWARE classes; this linter adds no new high/critical security block categories.",
      attachment_status: attachmentStatus,
      spectre_findings: spectre,
    },
  };
}

/**
 * Apply the diagnostic presentation cap: at most MAX_DIAGNOSTICS entries
 * are presented; the omitted summary keeps severity/count totals so
 * nothing is silently lost. Shared by the linter and the serialized-output
 * fallback so both stay within the same bound.
 */
function finalizeDiagnostics(diags) {
  const truncated = diags.length > MAX_DIAGNOSTICS;
  const finalDiags = diags.slice(0, MAX_DIAGNOSTICS);
  const omitted = diags.slice(MAX_DIAGNOSTICS);
  const omittedBySeverity = { error: 0, review: 0, note: 0 };
  const omittedByCode = {};
  for (const d of omitted) {
    if (omittedBySeverity[d.severity] !== undefined) omittedBySeverity[d.severity]++;
    omittedByCode[d.code] = (omittedByCode[d.code] || 0) + 1;
  }
  return {
    diagnostics: finalDiags,
    truncated,
    omitted: {
      total: omitted.length,
      by_severity: omittedBySeverity,
      by_code: omittedByCode,
    },
  };
}

/**
 * Serialize a report within the exact MAX_REPORT_BYTES output bound. When
 * the full pretty-printed report exceeds the bound (or cannot be
 * serialized), emit a bounded nonconformant report whose attachment slot
 * is replaced by the named "rejected_output_bound" status — the accepted
 * findings are preserved verbatim whenever the bound holds, and an
 * over-bound/unserializable report never escapes as an uncaught
 * exception or a stack trace.
 */
function serializeReportBounded(report) {
  let text = null;
  try {
    text = JSON.stringify(report, null, 2);
  } catch {
    text = null;
  }
  if (text !== null && Buffer.byteLength(text, "utf8") <= MAX_REPORT_BYTES) {
    return { report, text };
  }
  const capped = finalizeDiagnostics([
    ...report.diagnostics,
    makeDiag(
      "REPORT_OUTPUT_TOO_LARGE",
      "error",
      ".",
      `Serialized report exceeds the ${MAX_REPORT_BYTES}-byte output bound; the attachment was omitted from the emitted report.`,
      ""
    ),
  ]);
  const fallback = {
    tool: report.tool,
    tool_version: report.tool_version,
    spec: report.spec,
    skill: report.skill,
    conformance: "nonconformant",
    diagnostics: capped.diagnostics,
    diagnostics_truncated: capped.truncated,
    diagnostics_omitted: capped.omitted,
    files: report.files,
    security_composition: {
      ...(report.security_composition || {}),
      attachment_status: "rejected_output_bound",
      spectre_findings: null,
    },
  };
  // Bounded by construction: diagnostics capped at 200 with 200-char
  // evidence, findings omitted.
  return { report: fallback, text: JSON.stringify(fallback, null, 2) };
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
    diagnostics_omitted: { total: 0, by_severity: { error: 0, review: 0, note: 0 }, by_code: {} },
    files: { admitted: 0, admitted_bytes: 0, truncated: false, symlinks: [] },
    security_composition: {
      note: "Packaging conformance only — never a security approval.",
      attachment_status: "not_requested",
      spectre_findings: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Upstream (Agent Skills spec) validation
// ---------------------------------------------------------------------------

function validateUpstream(fm, dirName, diags, root) {
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

  // license — optional upstream; FORGE policy: unknown => REVIEW_REQUIRED.
  // File existence establishes a reference only, never known rights: a
  // bundled license file still leaves the license REVIEW_REQUIRED until a
  // reviewer verifies the text.
  const lic = fm.license;
  if (lic === undefined || lic === null || String(lic).trim() === "") {
    diags.push(
      makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), "No license declared. FORGE policy: unknown license becomes REVIEW_REQUIRED, never an inferred permissive license.", "")
    );
  } else if (typeof lic !== "string") {
    diags.push(makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), "License field is not a string; treated as unknown.", ""));
  } else {
    const v = lic.trim();
    if (RECOGNIZED_LICENSES.has(v)) {
      // known permissive license — no diagnostic
    } else {
      const ref = v.replace(/^(see|file:)\s+/i, "").trim();
      const looksLocal = ref !== "" && !ref.startsWith("/") && !/^(https?:|mailto:)/i.test(ref);
      let bundled = false;
      if (looksLocal) {
        const candidate = join(root, ref);
        const candRel = relative(root, resolve(candidate));
        const escapes = candRel === ".." || candRel.startsWith(".." + sep);
        // Same root/exclusion policy as every other path use: no escaping
        // targets, no excluded components, no symlink hops — and the final
        // entry must be a real file, never a symlink (never followed).
        if (!escapes && !auditRelPath(root, candRel)) {
          try {
            const lst = lstatSync(candidate);
            bundled = lst.isFile() && !lst.isSymbolicLink();
          } catch {
            bundled = false;
          }
        }
      }
      if (bundled) {
        diags.push(makeDiag("LICENSE_FILE_REFERENCE", "note", at("license"), "License references a bundled file; file existence does not establish rights — verify its text independently.", ref));
      }
      diags.push(
        makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license"), "FORGE policy: unknown license stays REVIEW_REQUIRED until reviewed, even when its text is bundled. Never an inferred permissive license.", v.slice(0, 80))
        );
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
  // Missing policy metadata is at least REVIEW_REQUIRED — a note alongside
  // an authoritative fully-conformant result would misstate the policy.
  for (const field of FORGE_FIELDS) {
    const v = forge[field];
    const deliberatelyEmptyList =
      Array.isArray(v) &&
      v.length === 0 &&
      (field === "permitted_data_classes" || field === "requested_capabilities");
    if (deliberatelyEmptyList) continue; // explicit "none" declaration, not missing
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      diags.push(
        makeDiag("FORGE_FIELD_MISSING", "review", at(field), `FORGE extension field '${field}' is missing; FORGE policy requires it for install review.`, "")
      );
    }
  }
  // Typed nonempty values for scalar fields: structurally invalid data is
  // nonconformant, not merely unreviewed.
  for (const field of FORGE_SCALAR_FIELDS) {
    const v = forge[field];
    if (v !== undefined && v !== null && typeof v !== "string") {
      diags.push(
        makeDiag("INVALID_FORGE_FIELD", "error", at(field), `forge.${field} must be a nonempty string.`, typeof v)
      );
    }
  }
  if (forge.license_status !== undefined && forge.license_status !== null) {
    const ls = String(forge.license_status);
    if (!["verified", "review_required", "unknown"].includes(ls)) {
      diags.push(makeDiag("INVALID_FORGE_FIELD", "error", at("license_status"), "forge.license_status must be one of: verified, review_required, unknown.", ls.slice(0, 40)));
    } else if (ls === "unknown" || ls === "review_required") {
      // An explicit review_required is honored; unknown is never verified.
      diags.push(
        makeDiag("LICENSE_REVIEW_REQUIRED", "review", at("license_status"), `FORGE policy: license_status '${ls}' becomes REVIEW_REQUIRED, never an inferred verified license.`, "")
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
// Link checks — declared-root containment on every path use
// ---------------------------------------------------------------------------

function checkLink(target, fromRel, root, diags) {
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
  // Same root/exclusion policy as every other path use: excluded components
  // and symlink hops (hidden chains through intermediate symlinks) are
  // refused WITHOUT following them, and no stat/read is issued against an
  // excluded or out-of-root target.
  const audit = auditRelPath(root, rel);
  if (audit) {
    if (audit.kind === "excluded") {
      diags.push(
        makeDiag("EXCLUDED_PATH_LINK", "error", loc, `Link target crosses excluded path '${audit.detail}'; refused.`, target.slice(0, 100))
      );
    } else {
      diags.push(
        makeDiag("ESCAPING_SYMLINK", "error", loc, `Link target crosses symlink component '${audit.detail}'; refused without following (declared-root containment).`, target.slice(0, 100))
      );
    }
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
// CLI — proper option parsing with validated values and no extra positionals
// ---------------------------------------------------------------------------

function parseCliArgs(args) {
  const positional = [];
  let spectreFindingsPath = null;
  let error = null;
  for (let i = 0; i < args.length && !error; i++) {
    const a = args[i];
    if (a === "--spectre-findings") {
      if (spectreFindingsPath !== null) {
        error = "Duplicate --spectre-findings option.";
        break;
      }
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) {
        error = "Option --spectre-findings requires a value.";
        break;
      }
      spectreFindingsPath = v;
      i++;
    } else if (a.startsWith("--")) {
      error = `Unknown option '${a}'.`;
    } else {
      positional.push(a);
    }
  }
  return { positional, spectreFindingsPath, error };
}

function main() {
  const args = process.argv.slice(2);
  const { positional, spectreFindingsPath, error } = parseCliArgs(args);

  if (error || positional.length !== 1) {
    console.error("Usage: node src/linter.mjs <skill-root> [--spectre-findings findings.json]");
    if (error) console.error(`Error: ${error}`);
    process.exit(2);
  }
  const report = lintSkill(positional[0], { spectreFindingsPath });
  const { report: emitted, text } = serializeReportBounded(report);
  const code = emitted.conformance === "conformant"
    ? 0
    : emitted.diagnostics.some((d) => d.code === "OPERATIONAL_ERROR")
      ? 2
      : 1;
  // SM-005: a forced process.exit() discards the unwritten tail when a
  // large report goes to a pipe, emitting truncated JSON at exit 0. Stage
  // the status via process.exitCode and let the event loop drain the full
  // stdout write (including pipe backpressure) before terminating. A
  // write failure is reported honestly: the intended status is moot once
  // the output is lost, so exit non-zero with an stderr diagnostic.
  process.exitCode = code;
  process.stdout.write(text + "\n", (err) => {
    if (err) {
      process.stderr.write(`Error: failed to write report to stdout: ${err.message}\n`, () => process.exit(2));
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) main();
