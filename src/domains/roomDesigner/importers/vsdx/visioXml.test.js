/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { childElements, firstChild, getAttr, localName, parseXml, textOf } from "./visioXml";

describe("visioXml", () => {
  it("parses a namespaced Visio document", () => {
    const doc = parseXml(
      `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes><Shape ID="1"/></Shapes></PageContents>`,
      "page1.xml",
    );
    expect(localName(doc.documentElement)).toBe("PageContents");
    const shapes = firstChild(doc.documentElement, "Shapes");
    expect(childElements(shapes, "Shape")).toHaveLength(1);
  });

  it("matches on localName regardless of namespace prefix", () => {
    const doc = parseXml(
      `<v:PageContents xmlns:v="http://schemas.microsoft.com/office/visio/2012/main"><v:Shapes><v:Shape ID="7"/></v:Shapes></v:PageContents>`,
      "page1.xml",
    );
    const shape = firstChild(firstChild(doc.documentElement, "Shapes"), "Shape");
    expect(getAttr(shape, "ID")).toBe("7");
  });

  it("rejects malformed XML with a coded error", () => {
    try {
      parseXml("<PageContents><Shapes>", "page1.xml");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err.code).toBe("malformed-xml");
      expect(err.message).toContain("page1.xml");
    }
  });

  it("rejects non-XML text", () => {
    expect(() => parseXml("this is not xml <><", "doc.xml")).toThrow(/could not parse/i);
  });

  it("textOf collapses whitespace", () => {
    const doc = parseXml(`<Text>Hello   <cp/>  world</Text>`, "t.xml");
    expect(textOf(doc.documentElement)).toBe("Hello world");
  });

  it("child helpers tolerate missing parents", () => {
    expect(childElements(null, "Shape")).toEqual([]);
    expect(firstChild(null, "Shape")).toBeNull();
    expect(getAttr(null, "ID")).toBeNull();
  });
});
