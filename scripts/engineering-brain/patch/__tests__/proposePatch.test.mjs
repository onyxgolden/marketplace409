import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  proposePatch,
  selectBadPath,
  findUniqueMatch,
  buildReplacement,
  applyWrongPathLiteral,
  diffHunks,
  renderUnifiedDiff,
  isExcludedPath,
  isWorkflowPath,
  syntaxCheck,
  extractAddedPaths,
  buildPathIndex,
  pathExistsInRepo,
  REPAIR_CLASS_WRONG_PATH_LITERAL,
} from "../proposePatch.mjs";

const BAD = "forge-capture-app/app/target/release/bundle/nsis/*.exe";
const GOOD = "forge-capture-app/target/release/bundle/nsis/*.exe";

// Pre-PR-#433 workflow content (git show 800f9efd^:...), the acceptance fixture.
const PRE_FIX_WORKFLOW = `name: Build FORGE Capture (Windows)

# Manual builds of the FORGE Capture desktop app for Windows.

on:
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    defaults:
      run:
        shell: pwsh
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build Tauri app (NSIS bundle)
        working-directory: forge-capture-app/app
        run: cargo tauri build

      - name: Upload installer
        uses: actions/upload-artifact@v4
        with:
          name: forge-capture-windows-installer
          path: ${BAD}
          if-no-files-found: error
`;

const CAPTURE_EVIDENCE = {
  failed_step: "actions/upload-artifact@v4",
  error_lines: [
    "##[error]No files were found with the provided path: forge-capture-app/app/target/release/bundle/nsis/*.exe. No artifacts will be uploaded.",
  ],
  mentioned_paths: [BAD],
};

const INDEX_WITH_FIX = [
  GOOD, // recorded PR #433 correction
  "forge-capture-app/app/tauri.conf.json",
  "forge-capture-app/app/Cargo.toml",
  "scripts/engineering-brain/query/rerankImplicatedCode.mjs",
];

function workflowBundle() {
  return {
    facets: {
      implicated_code: [
        {
          source_path: ".github/workflows/build-capture-windows.yml",
          source_type: "workflow",
          symbol_or_section: "Upload installer",
        },
      ],
    },
    past_fixes: [],
  };
}

let tmpRoot;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patch-test-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function write(rel, content) {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function run({ files = {}, evidence = CAPTURE_EVIDENCE, bundle = workflowBundle(), pathIndex = INDEX_WITH_FIX }) {
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return proposePatch({
    bundle,
    evidence,
    repoRoot: tmpRoot,
    pathIndex,
    deps: { grepLiteral: () => [] },
  });
}

describe("selectBadPath", () => {
  it("picks the single path missing from the repo", () => {
    const { badPath } = selectBadPath([BAD, "exists/real.js"], (p) => p !== BAD);
    expect(badPath).toBe(BAD);
  });
  it("noPatch when nothing is missing", () => {
    expect(selectBadPath([BAD], () => true).badPath).toBeNull();
  });
  it("noPatch when several paths are missing", () => {
    const r = selectBadPath([BAD, "other/missing.js"], () => false);
    expect(r.badPath).toBeNull();
    expect(r.reason).toBe("multiple-missing-paths");
  });
  it("ignores bare filenames without a directory", () => {
    expect(selectBadPath(["installer.exe"], () => false).badPath).toBeNull();
  });
});

describe("findUniqueMatch", () => {
  it("matches the recorded correction via the shared directory chain", () => {
    const { matched } = findUniqueMatch(BAD, INDEX_WITH_FIX);
    expect(matched).toBe(GOOD);
  });
  it("noPatch on ambiguity", () => {
    const r = findUniqueMatch(BAD, [GOOD, "other/target/release/bundle/nsis/*.exe"]);
    expect(r.matched).toBeNull();
    expect(r.reason).toBe("ambiguous-match");
  });
  it("noPatch when nothing is close", () => {
    const r = findUniqueMatch(BAD, ["src/app.js", "docs/readme.md"]);
    expect(r.matched).toBeNull();
    expect(r.reason).toBe("no-close-match");
  });
});

describe("buildReplacement", () => {
  it("preserves the trailing glob while substituting the matched directory", () => {
    expect(buildReplacement(BAD, GOOD)).toBe(GOOD);
    expect(buildReplacement(BAD, "forge-capture-app/target/release/bundle/nsis/setup.exe")).toBe(GOOD);
  });
});

describe("proposePatch — Capture acceptance (PR #433)", () => {
  it("proposes exactly the historical fix, flagged manual for the workflow file", () => {
    const result = run({
      files: { ".github/workflows/build-capture-windows.yml": PRE_FIX_WORKFLOW },
    });
    expect(result.noPatch).toBeUndefined();
    const { patch, explanation } = result;
    expect(patch.repairClass).toBe(REPAIR_CLASS_WRONG_PATH_LITERAL);
    expect(patch.path).toBe(".github/workflows/build-capture-windows.yml");
    expect(patch.application).toBe("manual");
    expect(patch.applicationReason).toMatch(/web UI/);
    expect(patch.evidenceRef.badPath).toBe(BAD);
    expect(patch.evidenceRef.matchedPath).toBe(GOOD);
    // Exactly the PR #433 change: one line, nothing else.
    expect(patch.hunks).toHaveLength(1);
    expect(patch.patched).toContain(`path: ${GOOD}`);
    expect(patch.patched).not.toContain(BAD);
    expect(patch.unifiedDiff).toContain(`-          path: ${BAD}`);
    expect(patch.unifiedDiff).toContain(`+          path: ${GOOD}`);
    expect(explanation).toContain(BAD);
    expect(explanation).toContain(GOOD);
  });

  it("direct application for non-workflow files", () => {
    const result = run({
      files: { "scripts/config.mjs": `export const p = "${BAD}";\n` },
      bundle: {
        facets: {
          implicated_code: [{ source_path: "scripts/config.mjs", source_type: "code", symbol_or_section: "p" }],
        },
        past_fixes: [],
      },
    });
    expect(result.patch.application).toBe("direct");
    expect(result.patch.patched).toContain(`"${GOOD}"`);
  });
});

describe("proposePatch — no-patch rails", () => {
  it("ambiguous close match -> noPatch", () => {
    const result = run({
      files: { ".github/workflows/build-capture-windows.yml": PRE_FIX_WORKFLOW },
      pathIndex: [GOOD, "x/target/release/bundle/nsis/*.exe"],
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("ambiguous-match");
  });

  it("literal in several files -> noPatch", () => {
    const result = run({
      files: {
        ".github/workflows/build-capture-windows.yml": PRE_FIX_WORKFLOW,
        "scripts/other.mjs": `const p = "${BAD}";\n`,
      },
      bundle: {
        facets: {
          implicated_code: [
            { source_path: ".github/workflows/build-capture-windows.yml", source_type: "workflow", symbol_or_section: "x" },
            { source_path: "scripts/other.mjs", source_type: "code", symbol_or_section: "p" },
          ],
        },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("ambiguous-literal");
  });

  it("literal absent from implicated files and repo search -> noPatch", () => {
    const result = run({
      files: { ".github/workflows/build-capture-windows.yml": PRE_FIX_WORKFLOW.replace(BAD, GOOD) },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("bad-path-literal-not-found");
  });

  it("occurrences on distant lines -> multi-hunk noPatch", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const content = `const a = "${BAD}";\n${filler}\nconst b = "${BAD}";\n`;
    const result = run({
      files: { "scripts/config.mjs": content },
      bundle: {
        facets: { implicated_code: [{ source_path: "scripts/config.mjs", source_type: "code", symbol_or_section: "a" }] },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("multi-hunk");
  });

  it("more than 20 changed lines -> noPatch", () => {
    const content = Array.from({ length: 21 }, (_, i) => `const p${i} = "${BAD}";`).join("\n") + "\n";
    const result = run({
      files: { "scripts/config.mjs": content },
      bundle: {
        facets: { implicated_code: [{ source_path: "scripts/config.mjs", source_type: "code", symbol_or_section: "p" }] },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("patch-too-large");
  });

  it("manifest files are never proposed", () => {
    const result = run({
      files: { "engineering-brain/index-manifest.json": JSON.stringify({ path: BAD }) },
      bundle: {
        facets: { implicated_code: [{ source_path: "engineering-brain/index-manifest.json", source_type: "data", symbol_or_section: "x" }] },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
  });

  it("node_modules is never proposed", () => {
    const result = run({
      files: { "node_modules/pkg/index.js": `const p = "${BAD}";\n` },
      bundle: {
        facets: { implicated_code: [{ source_path: "node_modules/pkg/index.js", source_type: "code", symbol_or_section: "p" }] },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
  });

  it("unsupported extension fails the parse rail", () => {
    const result = run({
      files: { "notes.txt": `path: ${BAD}\n` },
      bundle: {
        facets: { implicated_code: [{ source_path: "notes.txt", source_type: "doc", symbol_or_section: "x" }] },
        past_fixes: [],
      },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("unparseable-patch");
  });

  it("no missing path -> noPatch", () => {
    write("real.txt", "hello");
    const result = proposePatch({
      bundle: workflowBundle(),
      evidence: { ...CAPTURE_EVIDENCE, mentioned_paths: ["real.txt"] },
      repoRoot: tmpRoot,
      pathIndex: INDEX_WITH_FIX,
      deps: { grepLiteral: () => [] },
    });
    expect(result.noPatch).toBe(true);
    expect(result.reason).toBe("no-missing-path");
  });
});

describe("syntaxCheck", () => {
  it("accepts valid YAML/JSON/JS", () => {
    expect(syntaxCheck("a.yml", "k: v\n").ok).toBe(true);
    expect(syntaxCheck("a.json", '{"k":"v"}').ok).toBe(true);
    expect(syntaxCheck("a.mjs", 'export const x = 1;\n').ok).toBe(true);
  });
  it("rejects broken YAML/JSON/JS", () => {
    expect(syntaxCheck("a.yml", "k: [unclosed\n").ok).toBe(false);
    expect(syntaxCheck("a.json", '{"k":}').ok).toBe(false);
    expect(syntaxCheck("a.mjs", "export const = ;\n").ok).toBe(false);
  });
  it("rejects unsupported extensions", () => {
    const r = syntaxCheck("a.txt", "anything");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unsupported extension/);
  });
});

describe("diffHunks / renderUnifiedDiff", () => {
  it("groups nearby changes into one hunk with context", () => {
    const a = ["l0", "l1", "l2", "l3", "l4", "l5", "l6"].join("\n");
    const b = ["l0", "l1", "L2", "l3", "l4", "l5", "l6"].join("\n");
    const hunks = diffHunks(a, b);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].changedLines).toBe(1);
    const diff = renderUnifiedDiff("f.txt", a, hunks);
    expect(diff).toContain("-l2");
    expect(diff).toContain("+L2");
    expect(diff).toMatch(/@@ -1,6 \+1,6 @@/);
  });

  it("applyWrongPathLiteral returns null when the literal is absent", () => {
    expect(applyWrongPathLiteral("nope", BAD, GOOD)).toBeNull();
  });
});

describe("path guards", () => {
  it("isExcludedPath blocks manifests, node_modules, .git", () => {
    expect(isExcludedPath("engineering-brain/index-manifest.json")).toBe(true);
    expect(isExcludedPath("node_modules/x/index.js")).toBe(true);
    expect(isExcludedPath(".git/config")).toBe(true);
    expect(isExcludedPath("src/app.js")).toBe(false);
    expect(isExcludedPath(".github/workflows/x.yml")).toBe(false);
  });
  it("isWorkflowPath identifies workflow files", () => {
    expect(isWorkflowPath(".github/workflows/build-capture-windows.yml")).toBe(true);
    expect(isWorkflowPath("src/app.js")).toBe(false);
  });
  it("pathExistsInRepo treats globs by their non-glob prefix", () => {
    write("realdir/file.txt", "x");
    expect(pathExistsInRepo(tmpRoot, "realdir/*.txt")).toBe(true);
    expect(pathExistsInRepo(tmpRoot, "missing/*.txt")).toBe(false);
    expect(pathExistsInRepo(tmpRoot, "../escape.txt")).toBe(false);
  });
});

describe("extractAddedPaths", () => {
  it("pulls path literals from added diff lines only", () => {
    const diff = [
      "--- a/f",
      "+++ b/f",
      `-  path: ${BAD}`,
      `+  path: ${GOOD}`,
      " context line",
    ].join("\n");
    const paths = extractAddedPaths(diff);
    expect(paths).toContain(GOOD);
    expect(paths).not.toContain(BAD);
  });
});

describe("buildPathIndex against a real git repo", () => {
  it("indexes tracked files and corrected paths from a past fix diff", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patch-idx-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
      execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "app.js"), "x\n");
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["commit", "-qm", "init"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "wf.yml"), `path: ${BAD}\n`);
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["commit", "-qm", "bad"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "wf.yml"), `path: ${GOOD}\n`);
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["commit", "-qm", "fix: correct path (#433)"], { cwd: repo });
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      const index = buildPathIndex({ repoRoot: repo, bundle: { past_fixes: [{ record: { sha } }] } });
      expect(index).toContain("app.js");
      expect(index).toContain(GOOD);
      expect(index).not.toContain(BAD);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
