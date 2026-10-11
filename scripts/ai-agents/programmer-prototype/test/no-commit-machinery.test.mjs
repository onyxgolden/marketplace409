/**
 * Static guard: the prototype must never reach the commit/push machinery.
 * scripts/engineering-brain/patch/prepareFixPr.mjs (and the patch/ tree)
 * must not be importable from anything under programmer-prototype/, and no
 * prototype code may invoke `git push` / `gh pr create` as a subprocess.
 *
 * Note: src/corpus.mjs legitimately contains adversarial ticket *text*
 * (e.g. "git push …") used to exercise the injection detectors — string
 * literals are stripped before the subprocess-invocation check. Likewise
 * src/fixture-store.mjs runs `git init/add/commit` to *build* the synthetic
 * fixture corpus (operator-run, host-side); it never pushes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else if (/\.(mjs|js|cjs|py)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip single/double-quoted string literals and line comments (naive but
 *  adequate for this guard: template literals are left intact). */
function stripStringsAndComments(src) {
  return src
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("no commit/push machinery reachable", () => {
  const files = walk(PROTO).filter((f) => !f.startsWith(HERE + path.sep));

  it("scans a non-empty prototype tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no source file references prepareFixPr or the engineering-brain patch tree", () => {
    const hits = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (src.includes("prepareFixPr")) hits.push(path.relative(PROTO, f));
      if (/engineering-brain\/patch/.test(src)) hits.push(path.relative(PROTO, f));
    }
    expect(hits).toEqual([]);
  });

  it("no source file invokes git push / gh pr create outside string literals", () => {
    const hits = [];
    for (const f of files) {
      const stripped = stripStringsAndComments(fs.readFileSync(f, "utf8"));
      if (/\bgit\s+push\b/.test(stripped)) hits.push(`${path.relative(PROTO, f)}:git push`);
      if (/\bgh\s+pr\s+create\b/.test(stripped)) hits.push(`${path.relative(PROTO, f)}:gh pr create`);
      if (/\bopenPullRequest\b|\bcreatePullRequest\b/.test(stripped))
        hits.push(`${path.relative(PROTO, f)}:pr-api`);
    }
    expect(hits).toEqual([]);
  });
});
