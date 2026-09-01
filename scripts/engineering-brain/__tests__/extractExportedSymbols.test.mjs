import { describe, expect, it } from "vitest";
import { extractExportedSymbols } from "../extractExportedSymbols.mjs";

describe("extractExportedSymbols", () => {
  it("finds an exported function declaration", () => {
    const symbols = extractExportedSymbols("export function resolveEffectiveOwnerId() { return 1; }", "file.js");
    expect(symbols.map((s) => s.name)).toEqual(["resolveEffectiveOwnerId"]);
    expect(symbols[0].kind).toBe("function");
  });

  it("finds an exported const and an exported class", () => {
    const source = "export const FOO = 1;\nexport class Bar {}\n";
    const symbols = extractExportedSymbols(source, "file.js");
    expect(symbols.map((s) => s.name).sort()).toEqual(["Bar", "FOO"]);
  });

  it("finds a default export function", () => {
    const symbols = extractExportedSymbols("export default function WorkspaceMembersPanel() {}", "file.jsx");
    expect(symbols.map((s) => s.name)).toEqual(["WorkspaceMembersPanel"]);
  });

  it("finds named re-exports, including aliases", () => {
    const symbols = extractExportedSymbols("const a = 1; const b = 2;\nexport { a, b as c };", "file.js");
    expect(symbols.map((s) => s.name).sort()).toEqual(["a", "c"]);
  });

  it("does not report non-exported declarations", () => {
    const symbols = extractExportedSymbols("function privateHelper() {}\nconst secret = 1;", "file.js");
    expect(symbols).toEqual([]);
  });

  it("captures each symbol's own text span for independent hashing", () => {
    const symbols = extractExportedSymbols("export function foo() { return 42; }", "file.js");
    expect(symbols[0].text).toContain("return 42");
  });

  it("parses .jsx and .ts source without throwing", () => {
    expect(() => extractExportedSymbols("export default function App() { return null; }", "file.jsx")).not.toThrow();
    expect(() => extractExportedSymbols("export function typed(): number { return 1; }", "file.ts")).not.toThrow();
  });
});
