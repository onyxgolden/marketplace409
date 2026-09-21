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

  it("resolves pages by relationship id when .rels order is reversed", () => {
    // Relationship entries are reordered in the .rels part; each <Page>
    // still resolves through its <Rel r:id>. Positional pairing would map
    // "Second" (index 0) to page1.xml — wrong content under the right name.
    const bytes = buildVsdx({
      pages: [
        { name: "Second", file: "page2.xml", shapes: "" },
        { name: "First", file: "page1.xml", shapes: "" },
      ],
      reversedRels: true,
    });
    const pages = listVisioPages(openVsdxPackage(bytes));
    expect(pages.map((p) => p.name)).toEqual(["Second", "First"]);
    expect(pages[0].contentPath).toBe("visio/pages/page2.xml");
    expect(pages[1].contentPath).toBe("visio/pages/page1.xml");
  });

  it("rejects a page with no Rel reference instead of guessing", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    const hacked = { ...pkg };
    const origGetText = pkg.getText.bind(pkg);
    hacked.getText = (path) =>
      path === "visio/pages/pages.xml"
        ? `<?xml version="1.0"?><Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Page ID="0" NameU="P"/></Pages>`
        : origGetText(path);
    expect(() => listVisioPages(hacked)).toThrow(/no relationship reference/i);
  });

  it("rejects a page referencing an unknown relationship id", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    const hacked = { ...pkg };
    const origGetText = pkg.getText.bind(pkg);
    hacked.getText = (path) =>
      path === "visio/pages/pages.xml"
        ? `<?xml version="1.0"?><Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Page ID="0" NameU="P"><Rel r:id="rId9"/></Page></Pages>`
        : origGetText(path);
    expect(() => listVisioPages(hacked)).toThrow(/unknown relationship 'rId9'/i);
  });

  it("rejects duplicate relationship ids in the .rels part", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    const hacked = { ...pkg };
    const origGetText = pkg.getText.bind(pkg);
    const rel = (id, target) =>
      `<Relationship Id="${id}" Type="http://schemas.microsoft.com/office/2011/relationships/page" Target="${target}"/>`;
    hacked.getText = (path) =>
      path === "visio/pages/_rels/pages.xml.rels"
        ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "page1.xml")}${rel("rId1", "page2.xml")}</Relationships>`
        : origGetText(path);
    expect(() => listVisioPages(hacked)).toThrow(/duplicate.*relationship id 'rId1'/i);
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
