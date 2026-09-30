import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  proposePatch,
  tryWrongIdentifier,
  tryWrongConfigKey,
  tryVersionPinDrift,
  extractBadIdentifier,
  extractDeclaredIdentifiers,
  applyWholeWord,
  replaceIdentifierReferences,
  extractBadConfigKey,
  applyQuotedKey,
  extractBadVersionPin,
  readLockfileVersion,
  splitVersionSpec,
  applyVersionPin,
  levenshtein,
  uniqueCloseMatch,
  wholeWordRegExp,
  KNOWN_CONFIG_KEYS,
  REPAIR_CLASS_WRONG_IDENTIFIER,
  REPAIR_CLASS_WRONG_CONFIG_KEY,
  REPAIR_CLASS_VERSION_PIN_DRIFT,
  REPAIR_CLASS_WRONG_PATH_LITERAL,
} from "../proposePatch.mjs";

const tmpDirs = [];
function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice4-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

const bundleFor = (source_path) => ({ facets: { implicated_code: [{ source_path }] } });
const noGrep = () => [];

describe("levenshtein / uniqueCloseMatch", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("getElementByID", "getElementById")).toBe(1);
  });

  it("matches a unique close candidate", () => {
    expect(uniqueCloseMatch("getElementByID", ["getElementById", "querySelector"]).matched)
      .toBe("getElementById");
  });

  it("refuses ambiguous candidates", () => {
    const r = uniqueCloseMatch("cat", ["cot", "cut"]);
    expect(r.matched).toBeNull();
    expect(r.reason).toBe("ambiguous-match");
  });

  it("excludes identical strings and different first characters", () => {
    expect(uniqueCloseMatch("id", ["id", "identifier"]).reason).toBe("no-close-match");
    expect(uniqueCloseMatch("xid", ["yid"]).reason).toBe("no-close-match");
    expect(uniqueCloseMatch("abc", ["abcdef"]).reason).toBe("no-close-match");
  });
});

describe("extractBadIdentifier", () => {
  it("matches ReferenceError", () => {
    expect(extractBadIdentifier(["ReferenceError: getElementByID is not defined"]).bad)
      .toBe("getElementByID");
  });

  it("matches ESLint no-undef", () => {
    expect(extractBadIdentifier(["  3:9  error  'fooBar' is not defined  no-undef"]).bad).toBe("fooBar");
  });

  it("matches tsc Cannot find name", () => {
    expect(extractBadIdentifier(["error TS2304: Cannot find name 'baz'."]).bad).toBe("baz");
  });

  it("flags several distinct identifiers as ambiguous, none as absent", () => {
    expect(extractBadIdentifier(["'a' is not defined", "'b' is not defined"]).ambiguous).toBe(true);
    expect(extractBadIdentifier(["all good"]).bad).toBeNull();
    expect(extractBadIdentifier([]).bad).toBeNull();
  });
});

describe("extractDeclaredIdentifiers", () => {
  it("finds imports, functions, variables, classes", () => {
    const src = `import def from "./x.mjs";
import { a, b as bee } from "./y.mjs";
import * as ns from "./z.mjs";
export async function fetchIt() {}
const myConst = 1;
let myLet = 2;
var myVar = 3;
export class MyClass {}
`;
    const names = extractDeclaredIdentifiers(src);
    for (const n of ["def", "a", "bee", "ns", "fetchIt", "myConst", "myLet", "myVar", "MyClass"]) {
      expect(names).toContain(n);
    }
  });
});

describe("applyWholeWord", () => {
  it("replaces standalone occurrences only", () => {
    expect(applyWholeWord("const identifier = id;", "id", "idx"))
      .toBe("const identifier = idx;");
  });

  it("replaces every standalone occurrence", () => {
    expect(applyWholeWord("id + id", "id", "idx")).toBe("idx + idx");
  });

  it("returns null when the name never occurs standalone", () => {
    expect(applyWholeWord("const identifier = 1;", "id", "idx")).toBeNull();
  });

  it("wholeWordRegExp never matches inside longer identifiers", () => {
    expect(wholeWordRegExp("id").test("identifier")).toBe(false);
    expect(wholeWordRegExp("id").test("my_id")).toBe(false);
    expect(wholeWordRegExp("id").test("(id)")).toBe(true);
  });
});

describe("replaceIdentifierReferences", () => {
  const BAD = "getElementByID";
  const GOOD = "getElementById";

  it("leaves strings, comments, member access, and object keys alone", () => {
    const src = [
      "// getElementByID legacy spelling",
      "const note = \"getElementByID\";",
      "const tpl2 = 'getElementByID';",
      "obj.getElementByID();",
      "other?.getElementByID();",
      "const cfg = { getElementByID: 1 };",
      "/* block getElementByID */",
      "console.log(getElementByID);",
    ].join("\n");
    const out = replaceIdentifierReferences(src, BAD, GOOD);
    expect(out).toContain("// getElementByID legacy spelling");
    expect(out).toContain("const note = \"getElementByID\";");
    expect(out).toContain("const tpl2 = 'getElementByID';");
    expect(out).toContain("obj.getElementByID();");
    expect(out).toContain("other?.getElementByID();");
    expect(out).toContain("const cfg = { getElementByID: 1 };");
    expect(out).toContain("/* block getElementByID */");
    expect(out).toContain("console.log(getElementById);");
  });

  it("still fixes real references: template interpolation, spread, shorthand, ternary", () => {
    const src = [
      "const a = `x ${getElementByID} y`;",
      "foo(...getElementByID);",
      "const s = { getElementByID };",
      "const t = cond ? getElementByID : other;",
    ].join("\n");
    const out = replaceIdentifierReferences(src, BAD, GOOD);
    expect(out).toContain("const a = `x ${getElementById} y`;");
    expect(out).toContain("foo(...getElementById);");
    expect(out).toContain("const s = { getElementById };");
    expect(out).toContain("const t = cond ? getElementById : other;");
  });

  it("returns null when every occurrence is a string, comment, or member", () => {
    expect(replaceIdentifierReferences("// getElementByID\n", BAD, GOOD)).toBeNull();
    expect(replaceIdentifierReferences("obj.getElementByID();\n", BAD, GOOD)).toBeNull();
    expect(replaceIdentifierReferences("const s = \"getElementByID\";\n", BAD, GOOD)).toBeNull();
  });

  it("leaves regex literals alone but fixes the real reference (reviewer example)", () => {
    const src = [
      "import { getElementById } from \"./dom.mjs\";",
      "const legacy = /getElementByID/;",
      "const el = getElementByID(\"main\");",
    ].join("\n");
    const out = replaceIdentifierReferences(src, BAD, GOOD);
    expect(out).toContain("const legacy = /getElementByID/;");
    expect(out).toContain("const el = getElementById(\"main\");");
  });

  it("skips regex bodies in expression positions: if-test, flags, escapes, classes, return", () => {
    const src = [
      "if (/getElementByID/.test(s)) { touch(getElementByID); }",
      "const hit = str.replace(/getElementByID/gi, \"x\");",
      "const re = /a\\/b[getElementByID]/;",
      "function f() { return /getElementByID/; }",
      "const el = getElementByID(\"x\");",
    ].join("\n");
    const out = replaceIdentifierReferences(src, BAD, GOOD);
    expect(out).toContain("if (/getElementByID/.test(s)) { touch(getElementById); }");
    expect(out).toContain("const hit = str.replace(/getElementByID/gi, \"x\");");
    expect(out).toContain("const re = /a\\/b[getElementByID]/;");
    expect(out).toContain("function f() { return /getElementByID/; }");
    expect(out).toContain("const el = getElementById(\"x\");");
  });

  it("still treats division as code, including chained division", () => {
    const src = [
      "const q = getElementByID(8) / 2;",
      "const r = (a + b) / getElementByID;",
      "const t = width / getElementByID / scale;",
    ].join("\n");
    const out = replaceIdentifierReferences(src, BAD, GOOD);
    expect(out).toContain("const q = getElementById(8) / 2;");
    expect(out).toContain("const r = (a + b) / getElementById;");
    expect(out).toContain("const t = width / getElementById / scale;");
  });

  it("returns null when the only occurrences are inside regex literals", () => {
    const src = [
      "const legacy = /getElementByID/;",
      "const hit = str.replace(/getElementByID/gi, \"x\");",
    ].join("\n") + "\n";
    expect(replaceIdentifierReferences(src, BAD, GOOD)).toBeNull();
  });
});

describe("tryWrongIdentifier end to end", () => {
  const APP = `import { getElementById } from "./dom.mjs";
const el = getElementById("main");
const side = getElementByID("side");
`;

  it("proposes the one-line typo correction", () => {
    const dir = mkrepo({ "src/app.js": APP });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { failed_step: "eslint", error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_WRONG_IDENTIFIER);
    expect(r.patch.hunks).toHaveLength(1);
    expect(r.patch.patched).toContain('getElementById("side")');
    expect(r.patch.patched).not.toContain("getElementByID");
    expect(r.patch.application).toBe("direct");
  });

  it("refuses when the bad identifier is already declared", () => {
    const dir = mkrepo({ "src/app.js": "const getElementByID = 1;\nconsole.log(getElementByID);\n" });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("identifier-already-declared");
  });

  it("refuses ambiguous corrections", () => {
    const dir = mkrepo({ "src/app.js": "const cat1 = 1;\nconst cat2 = 2;\nconsole.log(cta);\n" });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { error_lines: ["'cta' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("ambiguous-identifier-match");
  });

  it("refuses when the typo sits in two files", () => {
    const dir = mkrepo({
      "src/a.js": "const getElementById = 1;\nconsole.log(getElementByID);\n",
      "src/b.js": "const getElementById = 1;\nconsole.log(getElementByID);\n",
    });
    const r = tryWrongIdentifier({
      bundle: { facets: { implicated_code: [] } },
      evidence: { error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: () => ["src/a.js", "src/b.js"] },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("ambiguous-identifier");
  });

  it("returns trigger-absent when no error names an identifier", () => {
    const dir = mkrepo({ "src/app.js": APP });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { error_lines: ["build passed"] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("trigger-absent");
  });

  it("only rewrites the identifier reference, not strings/comments/members", () => {
    const src = [
      "import { getElementById } from \"./dom.mjs\";",
      "// getElementByID is the legacy spelling",
      "const label = \"getElementByID\";",
      "widget.getElementByID();",
      "const el = getElementByID(\"main\");",
    ].join("\n") + "\n";
    const dir = mkrepo({ "src/app.js": src });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { failed_step: "eslint", error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.patched).toContain("// getElementByID is the legacy spelling");
    expect(r.patch.patched).toContain("const label = \"getElementByID\";");
    expect(r.patch.patched).toContain("widget.getElementByID();");
    expect(r.patch.patched).toContain("const el = getElementById(\"main\");");
  });

  it("leaves regex literals alone end to end", () => {
    const src = [
      "import { getElementById } from \"./dom.mjs\";",
      "const legacy = /getElementByID/;",
      "const el = getElementByID(\"main\");",
    ].join("\n") + "\n";
    const dir = mkrepo({ "src/app.js": src });
    const r = tryWrongIdentifier({
      bundle: bundleFor("src/app.js"),
      evidence: { failed_step: "eslint", error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_WRONG_IDENTIFIER);
    expect(r.patch.patched).toContain("const legacy = /getElementByID/;");
    expect(r.patch.patched).toContain("const el = getElementById(\"main\");");
    expect(r.patch.patched).not.toContain("/getElementById/;");
  });
});

describe("extractBadConfigKey", () => {
  it("matches tsc unknown compiler option", () => {
    expect(extractBadConfigKey(["error TS5023: Unknown compiler option 'strictNullCheck'."]).bad)
      .toBe("strictNullCheck");
  });

  it("matches AJV additional-properties errors", () => {
    expect(extractBadConfigKey(["must NOT have additional properties 'dependancies'"]).bad)
      .toBe("dependancies");
  });

  it("flags several distinct keys as ambiguous", () => {
    const r = extractBadConfigKey([
      "Unknown compiler option 'aaa'.",
      "Unknown compiler option 'bbb'.",
    ]);
    expect(r.ambiguous).toBe(true);
    expect(extractBadConfigKey(["ok"]).bad).toBeNull();
  });
});

describe("applyQuotedKey", () => {
  it("replaces the key, never a value containing the same text", () => {
    const src = `{\n  "strictNullCheck": true,\n  "note": "strictNullCheck is wrong"\n}`;
    const out = applyQuotedKey(src, "strictNullCheck", "strictNullChecks");
    expect(out).toContain('"strictNullChecks": true');
    expect(out).toContain('"note": "strictNullCheck is wrong"');
  });

  it("returns null when the key is absent", () => {
    expect(applyQuotedKey(`{"a": 1}`, "b", "c")).toBeNull();
  });
});

describe("tryWrongConfigKey end to end", () => {
  it("fixes a tsconfig typo", () => {
    const dir = mkrepo({
      "tsconfig.json": `{\n  "compilerOptions": {\n    "strictNullCheck": true,\n    "target": "es2020"\n  }\n}\n`,
    });
    const r = tryWrongConfigKey({
      bundle: bundleFor("tsconfig.json"),
      evidence: {
        failed_step: "tsc",
        error_lines: ["error TS5023: Unknown compiler option 'strictNullCheck'."],
      },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_WRONG_CONFIG_KEY);
    expect(r.patch.patched).toContain('"strictNullChecks": true');
    expect(r.patch.hunks).toHaveLength(1);
  });

  it("refuses files outside the known-config dictionary", () => {
    const dir = mkrepo({ "webpack.config.js": `module.exports = { "ruls": [] };\n` });
    const r = tryWrongConfigKey({
      bundle: bundleFor("webpack.config.js"),
      evidence: { error_lines: ["Unknown compiler option 'ruls'."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("unknown-config-file");
  });

  it("refuses when no known key is close", () => {
    const dir = mkrepo({ "tsconfig.json": `{\n  "compilerOptions": {\n    "zzzzzz": true\n  }\n}\n` });
    const r = tryWrongConfigKey({
      bundle: bundleFor("tsconfig.json"),
      evidence: { error_lines: ["error TS5023: Unknown compiler option 'zzzzzz'."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("no-close-match");
  });

  it("known keys include the common tsconfig and package.json sets", () => {
    expect(KNOWN_CONFIG_KEYS["tsconfig.json"]).toContain("strictNullChecks");
    expect(KNOWN_CONFIG_KEYS["package.json"]).toContain("dependencies");
  });
});

describe("extractBadVersionPin", () => {
  it("extracts package and version", () => {
    const r = extractBadVersionPin(["npm error No matching version found for left-pad@9.9.9."]);
    expect(r.bad).toEqual({ pkg: "left-pad", version: "9.9.9" });
  });

  it("handles scoped packages", () => {
    const r = extractBadVersionPin(["npm error No matching version found for @scope/pkg@1.2.3."]);
    expect(r.bad).toEqual({ pkg: "@scope/pkg", version: "1.2.3" });
  });

  it("flags several distinct pins as ambiguous", () => {
    const r = extractBadVersionPin([
      "npm error No matching version found for a@1.0.0.",
      "npm error No matching version found for b@2.0.0.",
    ]);
    expect(r.ambiguous).toBe(true);
    expect(extractBadVersionPin(["npm install ok"]).bad).toBeNull();
  });
});

describe("splitVersionSpec / applyVersionPin", () => {
  it("splits operator from version", () => {
    expect(splitVersionSpec("^9.9.9")).toEqual({ operator: "^", version: "9.9.9" });
    expect(splitVersionSpec("~1.2.3")).toEqual({ operator: "~", version: "1.2.3" });
    expect(splitVersionSpec("1.2.3")).toEqual({ operator: "", version: "1.2.3" });
    expect(splitVersionSpec(">=1.0.0")).toEqual({ operator: ">=", version: "1.0.0" });
  });

  it("preserves the range operator", () => {
    const src = `{\n  "dependencies": {\n    "left-pad": "^9.9.9"\n  }\n}`;
    expect(applyVersionPin(src, "left-pad", "9.9.9", "1.3.0"))
      .toContain('"left-pad": "^1.3.0"');
  });

  it("refuses when the manifest version differs from the evidence", () => {
    const src = `{"dependencies": {"left-pad": "^1.0.0"}}`;
    expect(applyVersionPin(src, "left-pad", "9.9.9", "1.3.0")).toBeNull();
  });

  it("refuses several declarations of the same package", () => {
    const src = `{"dependencies": {"left-pad": "9.9.9"}, "peerDependencies": {"left-pad": "9.9.9"}}`;
    expect(applyVersionPin(src, "left-pad", "9.9.9", "1.3.0")).toBeNull();
  });
});

describe("readLockfileVersion", () => {
  it("reads the modern packages map", () => {
    const dir = mkrepo({
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    });
    expect(readLockfileVersion(dir, "left-pad")).toBe("1.3.0");
  });

  it("reads the legacy dependencies map", () => {
    const dir = mkrepo({
      "package-lock.json": JSON.stringify({
        lockfileVersion: 1,
        dependencies: { "left-pad": { version: "1.3.0" } },
      }),
    });
    expect(readLockfileVersion(dir, "left-pad")).toBe("1.3.0");
  });

  it("returns null when the lockfile or package is missing", () => {
    const dir = mkrepo({});
    expect(readLockfileVersion(dir, "left-pad")).toBeNull();
    const dir2 = mkrepo({ "package-lock.json": `{"packages":{}}` });
    expect(readLockfileVersion(dir2, "left-pad")).toBeNull();
  });
});

describe("tryVersionPinDrift end to end", () => {
  const files = {
    "package.json": `{\n  "name": "demo",\n  "dependencies": {\n    "left-pad": "^9.9.9"\n  }\n}\n`,
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
    }),
  };
  const evidence = {
    failed_step: "npm ci",
    error_lines: ["npm error No matching version found for left-pad@9.9.9."],
  };

  it("aligns the pin with the lockfile, keeping the range operator", () => {
    const dir = mkrepo(files);
    const r = tryVersionPinDrift({ evidence, repoRoot: dir, deps: {} });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_VERSION_PIN_DRIFT);
    expect(r.patch.patched).toContain('"left-pad": "^1.3.0"');
    expect(r.patch.hunks).toHaveLength(1);
  });

  it("refuses when the lockfile already agrees", () => {
    const dir = mkrepo({
      ...files,
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "9.9.9" } },
      }),
    });
    const r = tryVersionPinDrift({ evidence, repoRoot: dir, deps: {} });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("lockfile-agrees-with-pin");
  });

  it("refuses when the package is absent from the lockfile", () => {
    const dir = mkrepo({
      "package.json": files["package.json"],
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
    });
    const r = tryVersionPinDrift({ evidence, repoRoot: dir, deps: {} });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("package-not-in-lockfile");
  });

  it("refuses when the manifest no longer carries the evidence version", () => {
    const dir = mkrepo({
      "package.json": `{"dependencies": {"left-pad": "^1.0.0"}}`,
      "package-lock.json": files["package-lock.json"],
    });
    const r = tryVersionPinDrift({ evidence, repoRoot: dir, deps: {} });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("pin-not-found-or-ambiguous");
  });
});

describe("proposePatch dispatcher", () => {
  it("falls through class 1 to the identifier class", () => {
    const dir = mkrepo({ "src/app.js": `const getElementById = 1;\nconsole.log(getElementByID);\n` });
    const r = proposePatch({
      bundle: bundleFor("src/app.js"),
      evidence: { error_lines: ["'getElementByID' is not defined."] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_WRONG_IDENTIFIER);
  });

  it("class 1 still wins when its own trigger fires", () => {
    const dir = mkrepo({
      "scripts/config.mjs": `export const p = "forge-capture-app/app/x";\n`,
      "forge-capture-app/x": "real\n",
    });
    const r = proposePatch({
      bundle: bundleFor("scripts/config.mjs"),
      evidence: {
        mentioned_paths: ["forge-capture-app/app/x"],
        error_lines: ["missing forge-capture-app/app/x"],
      },
      repoRoot: dir,
      pathIndex: ["forge-capture-app/x"],
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBeFalsy();
    expect(r.patch.repairClass).toBe(REPAIR_CLASS_WRONG_PATH_LITERAL);
  });

  it("reports no-repair-trigger when nothing fires", () => {
    const dir = mkrepo({});
    const r = proposePatch({
      bundle: { facets: { implicated_code: [] } },
      evidence: { error_lines: ["all green"] },
      repoRoot: dir,
      deps: { grepLiteral: noGrep },
    });
    expect(r.noPatch).toBe(true);
    expect(r.reason).toBe("no-repair-trigger");
  });
});
