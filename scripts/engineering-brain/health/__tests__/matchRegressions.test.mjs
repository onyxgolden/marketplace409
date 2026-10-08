import { describe, expect, it } from "vitest";
import { matchRegressions } from "../matchRegressions.mjs";

const catalog = [
  { sha: "aaa111", date: "2026-10-01", subject: "Fix auth redirect", pr: 100, class: "auth", files: ["src/auth/login.js", "src/auth/session.js"] },
  { sha: "bbb222", date: "2026-10-05", subject: "Fix cart total", pr: 101, class: "cart", files: ["src/cart/total.js"] },
];

describe("matchRegressions", () => {
  it("surfaces exposure on exact file overlap", () => {
    const e = matchRegressions({ changedPaths: ["src/auth/login.js"], bugCatalog: catalog, revision: "abc" });
    expect(e.length).toBe(1);
    expect(e[0].priorFix.sha).toBe("aaa111");
    expect(e[0].matchedFiles).toEqual(["src/auth/login.js"]);
    expect(e[0].revision).toBe("abc");
  });

  it("returns empty when no files overlap (no false positive)", () => {
    const e = matchRegressions({ changedPaths: ["src/totally/unrelated.js"], bugCatalog: catalog });
    expect(e).toEqual([]);
  });

  it("returns empty for empty changed paths", () => {
    expect(matchRegressions({ changedPaths: [], bugCatalog: catalog })).toEqual([]);
  });

  it("never claims a regression occurred", () => {
    const e = matchRegressions({ changedPaths: ["src/auth/login.js"], bugCatalog: catalog });
    expect(e[0].reason).toMatch(/potential/i);
    expect(e[0].reason).toMatch(/advisory/i);
    expect(e[0].reason.toLowerCase()).not.toMatch(/regression (occurred|detected|confirmed)/);
  });

  it("matches multiple files from the same fix", () => {
    const e = matchRegressions({
      changedPaths: ["src/auth/login.js", "src/auth/session.js"],
      bugCatalog: catalog,
    });
    expect(e.length).toBe(1);
    expect(e[0].matchedFiles).toEqual(["src/auth/login.js", "src/auth/session.js"]);
  });

  it("orders by most matched files first", () => {
    const e = matchRegressions({
      changedPaths: ["src/auth/login.js", "src/auth/session.js", "src/cart/total.js"],
      bugCatalog: catalog,
    });
    expect(e[0].priorFix.sha).toBe("aaa111"); // 2 files beats 1
    expect(e[1].priorFix.sha).toBe("bbb222");
  });

  it("normalizes ./ prefixes and duplicate slashes", () => {
    const e = matchRegressions({ changedPaths: ["./src//auth/login.js"], bugCatalog: catalog });
    expect(e.length).toBe(1);
  });
});
