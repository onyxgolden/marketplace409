import { describe, it, expect } from "vitest";
import { normalizePath, validateTargetPath, validateNewParent } from "../src/paths.mjs";

describe("normalizePath", () => {
  it("strips leading ./ and dot segments", () => {
    expect(normalizePath("./src/a.mjs")).toBe("src/a.mjs");
    expect(normalizePath("src/./a.mjs")).toBe("src/a.mjs");
  });
  it("returns null for absolute paths", () => {
    expect(normalizePath("/etc/passwd")).toBeNull();
  });
  it("returns null for parent traversal", () => {
    expect(normalizePath("src/../../etc/passwd")).toBeNull();
    expect(normalizePath("..")).toBeNull();
  });
  it("returns null for empty / non-string input", () => {
    expect(normalizePath("")).toBeNull();
    expect(normalizePath(null)).toBeNull();
  });
});

describe("validateTargetPath", () => {
  it("accepts a plain in-repo path", () => {
    expect(validateTargetPath("src/a.mjs").ok).toBe(true);
  });
  it("rejects absolute and traversal paths", () => {
    expect(validateTargetPath("/etc/passwd").ok).toBe(false);
    expect(validateTargetPath("../x").ok).toBe(false);
  });
  it("rejects .git paths", () => {
    expect(validateTargetPath(".git/config").ok).toBe(false);
  });
  it("rejects oracle and test paths (oracle-tamper guard)", () => {
    expect(validateTargetPath("oracles/lit-acceptance-v1.mjs").ok).toBe(false);
    expect(validateTargetPath("src/a.test.mjs").ok).toBe(false);
  });
  it("rejects sensitive names", () => {
    expect(validateTargetPath("src/.env").ok).toBe(false);
  });
});

describe("validateNewParent", () => {
  it("accepts an allowlisted existing dir", () => {
    const r = validateNewParent("lib", new Set(["lib"]), ["lib"]);
    expect(r.ok).toBe(true);
  });
  it("rejects a parent that is not allowlisted", () => {
    const r = validateNewParent("evil", new Set(["evil"]), ["lib"]);
    expect(r.ok).toBe(false);
  });
  it("rejects a parent missing from the snapshot", () => {
    const r = validateNewParent("lib", new Set(["src"]), ["lib"]);
    expect(r.ok).toBe(false);
  });
});
