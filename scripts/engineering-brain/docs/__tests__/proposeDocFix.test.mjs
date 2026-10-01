import { describe, expect, it } from "vitest";
import {
  proposeDocFix,
  isDocRewriteTarget,
  sectionBounds,
  replaceInSection,
  REPAIR_CLASS_DOC_DEAD_PATH,
  REPAIR_CLASS_DOC_DEAD_SCRIPT,
  REPAIR_CLASS_DOC_DEAD_LINK,
} from "../proposeDocFix.mjs";
import {
  DRIFT_DEAD_PATH,
  DRIFT_DEAD_SCRIPT,
  DRIFT_DEAD_LINK,
} from "../detectDocDrift.mjs";

const DOC = "docs/engineering-brain/sample.md";

describe("isDocRewriteTarget", () => {
  it("allows docs md, rejects everything else", () => {
    expect(isDocRewriteTarget("docs/a.md")).toBe(true);
    expect(isDocRewriteTarget("src/a.md")).toBe(false);
    expect(isDocRewriteTarget("docs/a.txt")).toBe(false);
    expect(isDocRewriteTarget("docs/engineering-brain/index-manifest.json")).toBe(false);
  });
});

describe("sectionBounds", () => {
  const lines = ["# Top", "", "## A", "a1", "### A1", "a2", "## B", "b1"];
  it("scopes to the enclosing section", () => {
    expect(sectionBounds(lines, 3)).toEqual({ start: 2, end: 6 });
    expect(sectionBounds(lines, 5)).toEqual({ start: 4, end: 6 });
  });
  it("treats the preamble as its own section", () => {
    const pre = ["intro line", "", "# Top", "body"];
    expect(sectionBounds(pre, 0)).toEqual({ start: 0, end: 2 });
  });
});

describe("proposeDocFix D1 dead path", () => {
  const text = [
    "# Guide",
    "",
    "## Runner",
    "",
    "Run `scripts/oldrunner.mjs` nightly.",
    "",
    "## Other",
    "",
    "Unrelated `scripts/oldrunner.mjs` mention stays.",
    "",
  ].join("\n");
  const candidates = [
    "scripts/engineering-brain/patch/oldrunner.mjs",
    "docs/a.md",
    "src/b.mjs",
  ];
  const finding = { driftClass: DRIFT_DEAD_PATH, docPath: DOC, line: 5, literal: "scripts/oldrunner.mjs" };

  it("rewrites the dead path within its section only", () => {
    const { patch, explanation } = proposeDocFix({ finding, docText: text, candidates });
    expect(patch.noPatch).toBeUndefined();
    expect(patch.repairClass).toBe(REPAIR_CLASS_DOC_DEAD_PATH);
    expect(patch.path).toBe(DOC);
    expect(patch.patched).toContain("`scripts/engineering-brain/patch/oldrunner.mjs`");
    // The identical literal in the "Other" section is untouched.
    expect(patch.patched).toContain("Unrelated `scripts/oldrunner.mjs` mention stays.");
    expect(explanation).toContain("oldrunner.mjs");
    expect(patch.unifiedDiff).toContain("@@");
  });

  it("noPatch on ambiguous matches", () => {
    const amb = proposeDocFix({
      finding: { ...finding, literal: "x/old-runner.mjs" },
      docText: text.replaceAll("scripts/oldrunner.mjs", "x/old-runner.mjs"),
      candidates: ["a/old-runner.mjs", "b/old-runner.mjs"],
    });
    expect(amb.patch.noPatch).toBe(true);
    expect(amb.patch.reason).toBe("ambiguous-match");
  });

  it("noPatch when no close match exists", () => {
    const { patch } = proposeDocFix({ finding, docText: text, candidates: ["totally/unrelated.mjs"] });
    expect(patch.noPatch).toBe(true);
    expect(patch.reason).toBe("no-close-match");
  });

  it("rewrites doc-relative literals when the basename matches", () => {
    const doc = "docs/forge-security/README.md";
    const t = ["# Guide", "", "## Refs", "", "See `../archive/design.md` for details.", ""].join("\n");
    const { patch } = proposeDocFix({
      finding: { driftClass: DRIFT_DEAD_PATH, docPath: doc, line: 5, literal: "../archive/design.md" },
      docText: t,
      candidates: ["docs/product/design.md", "src/other.mjs"],
    });
    expect(patch.noPatch).toBeUndefined();
    expect(patch.patched).toContain("`../product/design.md`");
    expect(patch.patched).not.toContain("../archive/design.md");
  });

  it("noPatch when the match yields no sane replacement", () => {
    const { patch } = proposeDocFix({
      finding: { ...finding, literal: "docs/architecture/FORGE_CONSTITUTION.md" },
      docText: text.replaceAll("scripts/oldrunner.mjs", "docs/architecture/FORGE_CONSTITUTION.md"),
      candidates: ["FORGE_CONSTITUTION.md"],
    });
    expect(patch.noPatch).toBe(true);
    expect(patch.reason).toBe("no-sane-replacement");
  });

  it("noPatch for non-doc targets", () => {
    const { patch } = proposeDocFix({ finding: { ...finding, docPath: "src/x.md" }, docText: text, candidates });
    expect(patch.noPatch).toBe(true);
    expect(patch.reason).toBe("not-a-doc-target");
  });
});

describe("proposeDocFix D2 dead script", () => {
  const text = ["# Guide", "", "## Install", "", "Run `npm run deply` to ship.", ""].join("\n");
  const finding = { driftClass: DRIFT_DEAD_SCRIPT, docPath: DOC, line: 5, literal: "deply" };

  it("rewrites the dead script ref", () => {
    const { patch } = proposeDocFix({ finding, docText: text, scriptNames: ["deploy", "build"] });
    expect(patch.noPatch).toBeUndefined();
    expect(patch.repairClass).toBe(REPAIR_CLASS_DOC_DEAD_SCRIPT);
    expect(patch.patched).toContain("npm run deploy");
    expect(patch.patched).not.toContain("deply");
  });

  it("noPatch when ambiguous", () => {
    const { patch } = proposeDocFix({ finding, docText: text, scriptNames: ["deploy", "deplo"] });
    expect(patch.noPatch).toBe(true);
  });
});

describe("proposeDocFix D3 dead doc link", () => {
  const text = ["# Guide", "", "## Links", "", "See [design](./archive/design.md) for details.", ""].join("\n");
  const docFiles = ["docs/engineering-brain/sample.md", "docs/engineering-brain/design.md"];
  const finding = { driftClass: DRIFT_DEAD_LINK, docPath: DOC, line: 5, literal: "./archive/design.md" };

  it("rewrites the dead link, preserving relativity", () => {
    const { patch } = proposeDocFix({ finding, docText: text, docFiles });
    expect(patch.noPatch).toBeUndefined();
    expect(patch.repairClass).toBe(REPAIR_CLASS_DOC_DEAD_LINK);
    expect(patch.patched).toContain("[design](./design.md)");
  });

  it("noPatch when no close match", () => {
    const { patch } = proposeDocFix({ finding, docText: text, docFiles: [DOC] });
    expect(patch.noPatch).toBe(true);
  });
});

describe("replaceInSection", () => {
  it("returns null when the literal is absent from the section", () => {
    expect(replaceInSection("# A\n\nhello\n", 3, "missing", "x")).toBeNull();
  });
});
