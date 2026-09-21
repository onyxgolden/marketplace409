import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { openVsdxPackage, VSDX_LIMITS } from "./vsdxPackage";
import { buildVsdx, pageContentXml, shapeXml } from "./testUtils/vsdxFixture";

const minimalParts = () => ({
  "[Content_Types].xml": strToU8("<Types/>"),
  "visio/document.xml": strToU8("<VisioDocument/>"),
});

describe("vsdxPackage", () => {
  it("opens a valid minimal package", () => {
    const bytes = buildVsdx({
      pages: [{ name: "Page-1", file: "page1.xml", shapes: "" }],
    });
    const pkg = openVsdxPackage(bytes);
    expect(pkg.has("visio/pages/pages.xml")).toBe(true);
    expect(pkg.list("visio/pages/")).toContain("visio/pages/page1.xml");
    expect(pkg.getText("visio/document.xml")).toContain("VisioDocument");
  });

  it("rejects a truncated ZIP", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    expect(() => openVsdxPackage(bytes.slice(0, 40))).toThrow(/readable ZIP/i);
  });

  it("rejects a valid ZIP that is not a VSDX package", () => {
    const bytes = zipSync({ "hello.txt": strToU8("hello") });
    expect(() => openVsdxPackage(bytes)).toThrow(/not a Visio drawing/i);
  });

  it("rejects traversal-style entry names", () => {
    const bytes = zipSync({ ...minimalParts(), "../evil.xml": strToU8("x") });
    expect(() => openVsdxPackage(bytes)).toThrow(/unsafe name/i);
  });

  it("rejects when the entry-count cap is exceeded", () => {
    const files = { ...minimalParts() };
    for (let i = 0; i < VSDX_LIMITS.maxEntries + 1; i += 1) {
      files[`visio/pages/filler${i}.txt`] = strToU8("x");
    }
    const bytes = zipSync(files, { level: 1 });
    expect(() => openVsdxPackage(bytes)).toThrow(/more than 2000 entries/i);
  });

  it("enforces a caller-supplied entry cap", () => {
    const files = { ...minimalParts() };
    for (let i = 0; i < 11; i += 1) files[`f${i}.txt`] = strToU8("x");
    const bytes = zipSync(files);
    expect(() => openVsdxPackage(bytes, { ...VSDX_LIMITS, maxEntries: 10 })).toThrow(/more than 10 entries/i);
  });

  it("rejects an entry whose declared size exceeds the per-entry cap", () => {
    const big = new Uint8Array(VSDX_LIMITS.maxEntryUncompressedBytes + 1);
    const bytes = zipSync({ ...minimalParts(), "visio/pages/big.bin": big }, { level: 1 });
    expect(() => openVsdxPackage(bytes)).toThrow(/cap/i);
  });

  it("rejects a ZIP bomb via the compression-ratio cap", () => {
    // 3 x 16 MB of zeros compress to ~50 KB: overall ratio >> 200 while
    // every per-entry and total streaming cap stays green, so the overall
    // ratio check (not the streaming caps) must fire.
    const zeros = new Uint8Array(16 * 1024 * 1024);
    const bytes = zipSync(
      {
        ...minimalParts(),
        "visio/pages/z0.bin": zeros,
        "visio/pages/z1.bin": zeros,
        "visio/pages/z2.bin": zeros,
      },
      { level: 9 },
    );
    expect(() => openVsdxPackage(bytes)).toThrow(/compression ratio/i);
    // The guard must fire on DECLARED sizes before expansion — not only
    // after the archive has been decompressed.
    try {
      openVsdxPackage(bytes);
      expect.unreachable("expected openVsdxPackage to throw");
    } catch (err) {
      expect(err.code).toBe("compression-ratio-cap");
      expect(err.message).toMatch(/before expansion/i);
    }
  });

  it("rejects a high-ratio archive whose declared entries fit the streaming caps", () => {
    // 4 x 10 MB of zeros: every entry fits the per-entry cap and the 40 MB
    // total fits the streaming total cap, so only the declared-size ratio
    // projection can reject it — before any entry is expanded.
    const zeros = new Uint8Array(10 * 1024 * 1024);
    const bytes = zipSync(
      {
        ...minimalParts(),
        "visio/pages/z0.bin": zeros,
        "visio/pages/z1.bin": zeros,
        "visio/pages/z2.bin": zeros,
        "visio/pages/z3.bin": zeros,
      },
      { level: 9 },
    );
    try {
      openVsdxPackage(bytes);
      expect.unreachable("expected openVsdxPackage to throw");
    } catch (err) {
      expect(err.code).toBe("compression-ratio-cap");
      expect(err.message).toMatch(/before expansion/i);
    }
  });

  it("rejects runaway expansion during streaming", () => {
    // Declared metadata can lie; the streaming guard must abort anyway.
    // Build entries that expand past the total cap.
    const chunk = new Uint8Array(20 * 1024 * 1024); // 20 MB zeros each
    const files = { ...minimalParts() };
    for (let i = 0; i < 6; i += 1) files[`visio/pages/z${i}.bin`] = chunk;
    const bytes = zipSync(files, { level: 9 });
    expect(() => openVsdxPackage(bytes)).toThrow(/safety caps|expansion/i);
  });

  it("rejects an XML part larger than the XML byte cap", () => {
    // Deterministic pseudo-random payload: incompressible, so the
    // compression-ratio cap does not fire before the XML cap is reached.
    let seed = 123456789;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return String.fromCharCode(33 + (seed % 94));
    };
    const size = VSDX_LIMITS.maxXmlBytes + 1024;
    const chars = new Array(size);
    for (let i = 0; i < size; i += 1) chars[i] = rand();
    const huge = `<PageContents>${chars.join("")}</PageContents>`;
    const bytes = zipSync({ ...minimalParts(), "visio/pages/pages.xml": strToU8(huge) }, { level: 1 });
    const pkg = openVsdxPackage(bytes);
    expect(() => pkg.getText("visio/pages/pages.xml")).toThrow(/XML cap/i);
  });

  it("throws a missing-part error for unknown paths", () => {
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: "" }] });
    const pkg = openVsdxPackage(bytes);
    expect(() => pkg.getText("visio/pages/nope.xml")).toThrow(/missing required part/i);
  });

  it("round-trips a real shape page through getText", () => {
    const shape = shapeXml({ id: "1", nameU: "Rect", cells: { PinX: { v: "2.5" } } });
    void pageContentXml;
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: shape }] });
    const pkg = openVsdxPackage(bytes);
    expect(pkg.getText("visio/pages/page1.xml")).toContain('NameU="Rect"');
  });
});
