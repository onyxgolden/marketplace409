/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { openVsdxPackage } from "./vsdxPackage";
import { listVisioPages, resolveTarget } from "./visioPages";
import { buildVsdx } from "./testUtils/vsdxFixture";

describe("visioPages", () => {
  it("resolves pages through relationships when filename order differs from page order", () => {
    // pages.xml lists "Second" first, but its content lives in page2.xml.
    const bytes = buildVsdx({
      pages: [
        { name: "Second", file: "page2.xml", shapes: "" },
        { name: "First", file: "page1.xml", shapes: "" },
      ],
    });
    const pages = listVisioPages(openVsdxPackage(bytes));
    expect(pages.map((p) => p.name)).toEqual(["Second", "First"]);
    expect(pages[0].contentPath).toBe("visio/pages/page2.xml");
    expect(pages[1].contentPath).toBe("visio/pages/page1.xml");
    expect(pages[0].index).toBe(0);
  });

  it("rejects a page list whose relationship count mismatches", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    // Corrupt the rels part after opening: two relationships for one page.
    const hacked = { ...pkg };
    const origGetText = pkg.getText.bind(pkg);
    const rel = (id, target) =>
      `<Relationship Id="${id}" Type="http://schemas.microsoft.com/office/2011/relationships/page" Target="${target}"/>`;
    hacked.getText = (path) =>
      path === "visio/pages/_rels/pages.xml.rels"
        ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "page1.xml")}${rel("rId2", "page2.xml")}</Relationships>`
        : origGetText(path);
    expect(() => listVisioPages(hacked)).toThrow(/does not match/i);
  });

  it("rejects a drawing with no pages", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    const hacked = { ...pkg };
    const origGetText = pkg.getText.bind(pkg);
    hacked.getText = (path) =>
      path === "visio/pages/pages.xml"
        ? `<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"></Pages>`
        : origGetText(path);
    expect(() => listVisioPages(hacked)).toThrow(/no pages/i);
  });

  it("resolveTarget resolves against the source part's directory (OPC)", () => {
    expect(resolveTarget("visio/pages/pages.xml", "page1.xml")).toBe("visio/pages/page1.xml");
    expect(resolveTarget("visio/pages/pages.xml", "../drawings/p1.xml")).toBe("visio/drawings/p1.xml");
    expect(resolveTarget("visio/masters/masters.xml", "master1.xml")).toBe("visio/masters/master1.xml");
  });
});
