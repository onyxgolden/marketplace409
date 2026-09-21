/**
 * In-memory synthetic .vsdx fixtures for importer tests.
 * Builds minimal but structurally valid VSDX packages with fflate.
 */

import { strToU8, zipSync } from "fflate";

export function cellXml(name, { v, f } = {}) {
  if (f != null) return `<Cell N="${name}" F="${f}"/>`;
  if (v != null) return `<Cell N="${name}" V="${v}"/>`;
  return `<Cell N="${name}"/>`;
}

export function cellsXml(cells = {}) {
  return Object.entries(cells)
    .map(([name, spec]) => cellXml(name, spec))
    .join("");
}

/** Axis-aligned rectangle geometry in local coords, as Geometry rows. */
export function rectGeometry(x, y, w, h) {
  return (
    `<Section N="Geometry" IX="1">` +
    `<Row T="MoveTo">${cellXml("X", { v: x })}${cellXml("Y", { v: y })}</Row>` +
    `<Row T="LineTo">${cellXml("X", { v: x + w })}${cellXml("Y", { v: y })}</Row>` +
    `<Row T="LineTo">${cellXml("X", { v: x + w })}${cellXml("Y", { v: y + h })}</Row>` +
    `<Row T="LineTo">${cellXml("X", { v: x })}${cellXml("Y", { v: y + h })}</Row>` +
    `<Row T="LineTo">${cellXml("X", { v: x })}${cellXml("Y", { v: y })}</Row>` +
    `</Section>`
  );
}

export function shapeXml({ id, nameU, master, cells = {}, geometry = "", text = "", children = "" }) {
  const masterAttr = master != null ? ` Master="${master}"` : "";
  const nameAttr = nameU ? ` NameU="${nameU}"` : "";
  const textXml = text ? `<Text>${text}</Text>` : "";
  const shapesXml = children ? `<Shapes>${children}</Shapes>` : "";
  return `<Shape ID="${id}"${nameAttr}${masterAttr}>${cellsXml(cells)}${geometry}${textXml}${shapesXml}</Shape>`;
}

export function pageContentXml({ shapes = "", pageWidth = 11, pageHeight = 8.5 }) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">` +
    `<PageSheet>${cellXml("PageWidth", { v: pageWidth })}${cellXml("PageHeight", { v: pageHeight })}</PageSheet>` +
    `<Shapes>${shapes}</Shapes>` +
    `</PageContents>`
  );
}

/**
 * Build a .vsdx package.
 * pages: [{ name, file, shapes, pageWidth, pageHeight }] — `file` is the part
 *   filename (e.g. "page2.xml"); listing order here is the DISPLAY order and
 *   may differ from filename order.
 * masters: [{ id, nameU, shapes }] — master definition shapes.
 */
export function buildVsdx({ pages = [], masters = [] } = {}) {
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types></Types>`),
    "visio/document.xml": strToU8(`<?xml version="1.0"?><VisioDocument></VisioDocument>`),
  };

  const pageEls = pages
    .map((p, i) => `<Page ID="${i}" NameU="${p.name}"/>`)
    .join("");
  files["visio/pages/pages.xml"] = strToU8(
    `<?xml version="1.0"?><Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main">${pageEls}</Pages>`,
  );
  const pageRels = pages
    .map(
      (p, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/office/2011/relationships/page" Target="${p.file}"/>`,
    )
    .join("");
  files["visio/pages/_rels/pages.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pageRels}</Relationships>`,
  );
  for (const p of pages) {
    files[`visio/pages/${p.file}`] = strToU8(
      pageContentXml({ shapes: p.shapes || "", pageWidth: p.pageWidth, pageHeight: p.pageHeight }),
    );
  }

  if (masters.length > 0) {
    const masterEls = masters.map((m) => `<Master ID="${m.id}" NameU="${m.nameU}"/>`).join("");
    files["visio/masters/masters.xml"] = strToU8(
      `<?xml version="1.0"?><Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main">${masterEls}</Masters>`,
    );
    const masterRels = masters
      .map(
        (m, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/office/2011/relationships/master" Target="master${i + 1}.xml"/>`,
      )
      .join("");
    files["visio/masters/_rels/masters.xml.rels"] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${masterRels}</Relationships>`,
    );
    masters.forEach((m, i) => {
      files[`visio/masters/master${i + 1}.xml`] = strToU8(
        `<?xml version="1.0"?><MasterContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes>${m.shapes}</Shapes></MasterContents>`,
      );
    });
  }

  return zipSync(files, { level: 6 });
}

/** A one-page drawing with a single shape — the most common fixture. */
export function singleShapeVsdx(shape, { pageName = "Page-1", masters = [] } = {}) {
  return buildVsdx({ pages: [{ name: pageName, file: "page1.xml", shapes: shape }], masters });
}
