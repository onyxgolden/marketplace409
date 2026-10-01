import { describe, expect, it } from "vitest";
import {
  detectDocDrift,
  extractBacktickLiterals,
  extractDocLinks,
  extractNpmRunRefs,
  listDocFiles,
  looksLikeRepoPath,
  DRIFT_DEAD_PATH,
  DRIFT_DEAD_SCRIPT,
  DRIFT_DEAD_LINK,
} from "../detectDocDrift.mjs";

const DOC = "docs/engineering-brain/sample.md";

function seams(overrides = {}) {
  return {
    docPath: DOC,
    text: "",
    pathExists: () => true,
    scriptNames: ["build", "test"],
    docFileSet: new Set([DOC]),
    ...overrides,
  };
}

describe("looksLikeRepoPath", () => {
  it("accepts repo-relative paths", () => {
    expect(looksLikeRepoPath("scripts/engineering-brain/run.mjs")).toBe(true);
    expect(looksLikeRepoPath("docs/a/*.md")).toBe(true);
    expect(looksLikeRepoPath("scripts/engineering-brain/")).toBe(true);
  });
  it("rejects urls, absolute paths, bare words, and git refs", () => {
    expect(looksLikeRepoPath("https://example.com/a")).toBe(false);
    expect(looksLikeRepoPath("/usr/bin/node")).toBe(false);
    expect(looksLikeRepoPath("~/x")).toBe(false);
    expect(looksLikeRepoPath("build")).toBe(false);
    expect(looksLikeRepoPath("has space/x")).toBe(false);
    expect(looksLikeRepoPath("origin/main")).toBe(false);
    expect(looksLikeRepoPath("feat/forge-health-private")).toBe(false);
    expect(looksLikeRepoPath("scripts/engineering-brain")).toBe(false);
    expect(looksLikeRepoPath("./ImportWarning.js")).toBe(false);
    expect(looksLikeRepoPath("./sub/file.md")).toBe(true);
  });
});

describe("extractors", () => {
  it("extracts backtick literals with line numbers", () => {
    const out = extractBacktickLiterals("see `a/b.mjs`\nand `c`");
    expect(out).toEqual([
      { literal: "a/b.mjs", line: 1 },
      { literal: "c", line: 2 },
    ]);
  });
  it("extracts npm run refs", () => {
    const out = extractNpmRunRefs("run `npm run build` then\nnpm run-script test:x");
    expect(out).toEqual([
      { name: "build", line: 1 },
      { name: "test:x", line: 2 },
    ]);
  });
  it("extracts relative doc links, skipping urls and anchors-only", () => {
    const out = extractDocLinks("[a](./other.md) [b](https://x/y.md) [c](#frag) [d](../z.md#s)");
    expect(out).toEqual([
      { target: "./other.md", line: 1 },
      { target: "../z.md", line: 1 },
    ]);
  });
});

describe("detectDocDrift", () => {
  it("flags a dead backtick path (D1)", () => {
    const f = detectDocDrift(
      seams({ text: "Run `scripts/old/run.mjs` now.", pathExists: (p) => p !== "scripts/old/run.mjs" }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ driftClass: DRIFT_DEAD_PATH, docPath: DOC, line: 1, literal: "scripts/old/run.mjs" });
  });
  it("does not flag existing paths", () => {
    const f = detectDocDrift(seams({ text: "Run `scripts/engineering-brain/run.mjs`." }));
    expect(f).toHaveLength(0);
  });
  it("flags a dead npm script ref (D2)", () => {
    const f = detectDocDrift(seams({ text: "Then `npm run deply`." }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ driftClass: DRIFT_DEAD_SCRIPT, literal: "deply" });
  });
  it("does not flag known scripts", () => {
    const f = detectDocDrift(seams({ text: "`npm run build`" }));
    expect(f).toHaveLength(0);
  });
  it("flags a dead relative doc link (D3)", () => {
    const f = detectDocDrift(
      seams({
        text: "See [design](./missing.md).",
        docFileSet: new Set([DOC]),
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ driftClass: DRIFT_DEAD_LINK, literal: "./missing.md" });
  });
  it("resolves existing relative links", () => {
    const f = detectDocDrift(
      seams({
        text: "See [design](./sample.md).",
        docFileSet: new Set([DOC, "docs/engineering-brain/sample.md"]),
      }),
    );
    expect(f).toHaveLength(0);
  });
  it("resolves doc-relative literals against the doc's directory", () => {
    const docPath = "docs/forge-security/README.md";
    const seen = [];
    const f = detectDocDrift({
      docPath,
      text: "See `../product/x.md` and `../missing/y.md`.",
      pathExists: (p) => {
        seen.push(p);
        return p === "docs/product/x.md";
      },
    });
    expect(seen).toContain("docs/product/x.md");
    expect(seen).toContain("docs/missing/y.md");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ driftClass: DRIFT_DEAD_PATH, literal: "../missing/y.md" });
  });
  it("dedupes identical findings and caps per doc", () => {
    const text = Array(40).fill("`nope/deep/x.mjs`").join("\n");
    const f = detectDocDrift(seams({ text, pathExists: () => false }));
    expect(f.length).toBeLessThanOrEqual(25);
  });
});

describe("listDocFiles", () => {
  it("lists md files under given dirs", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "docdrift-"));
    try {
      mkdirSync(join(root, "docs", "sub"), { recursive: true });
      writeFileSync(join(root, "docs", "a.md"), "# a");
      writeFileSync(join(root, "docs", "sub", "b.md"), "# b");
      writeFileSync(join(root, "docs", "sub", "c.txt"), "nope");
      const files = listDocFiles(root, ["docs"]);
      expect(files).toEqual(["docs/a.md", "docs/sub/b.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
