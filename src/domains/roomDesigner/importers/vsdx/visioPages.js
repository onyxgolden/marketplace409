/**
 * VSDX page discovery.
 *
 * Pages are enumerated from visio/pages/pages.xml and matched to their
 * content parts through the package relationships in
 * visio/pages/_rels/pages.xml.rels. The match is positional (Nth <Page>
 * element ↔ Nth page relationship in document order) because Visio does not
 * store an explicit relationship id on <Page> elements. A count mismatch is
 * a hard error, not a guess.
 *
 * The filename of a page part (page1.xml) is NEVER assumed to correspond to
 * the first displayed page — ordering comes from pages.xml document order.
 */

import { VsdxImportError } from "./vsdxErrors";
import { childElements, firstChild, getAttr, parseXml } from "./visioXml";

const PAGES_XML = "visio/pages/pages.xml";
const PAGES_RELS = "visio/pages/_rels/pages.xml.rels";

function relTypeIsPage(type) {
  return typeof type === "string" && /(^|\/)page$/.test(type);
}

/** Resolve a relationship Target against the source part's directory
 * (OPC: targets are relative to the part the .rels file belongs to). */
export function resolveTarget(sourcePart, target) {
  const dir = sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1);
  const parts = [];
  for (const seg of `${dir}${target}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function readRelationships(pkg, relsPath, sourcePart, kindLabel) {
  if (!pkg.has(relsPath)) {
    throw new VsdxImportError(`Package is missing relationships part '${relsPath}'.`, {
      provenance: relsPath,
      code: "missing-part",
    });
  }
  const doc = parseXml(pkg.getText(relsPath), relsPath);
  const out = [];
  for (const rel of childElements(doc.documentElement, "Relationship")) {
    const type = getAttr(rel, "Type");
    if (!relTypeIsPage(type)) continue;
    const target = getAttr(rel, "Target");
    if (!target) continue;
    out.push({ id: getAttr(rel, "Id"), target: resolveTarget(sourcePart, target) });
  }
  if (out.length === 0) {
    throw new VsdxImportError(`No ${kindLabel} relationships found in '${relsPath}'.`, {
      provenance: relsPath,
      code: "no-pages",
    });
  }
  return out;
}

/**
 * List the drawing's pages in display order.
 * Returns [{ id, name, index, contentPath, backPageId }].
 */
export function listVisioPages(pkg) {
  const doc = parseXml(pkg.getText(PAGES_XML), PAGES_XML);
  const pagesEl = firstChild(doc.documentElement, "Pages") || doc.documentElement;
  const pageEls = childElements(pagesEl, "Page");
  if (pageEls.length === 0) {
    throw new VsdxImportError("The drawing contains no pages.", {
      provenance: PAGES_XML,
      code: "no-pages",
    });
  }
  const rels = readRelationships(pkg, PAGES_RELS, PAGES_XML, "page");
  if (rels.length !== pageEls.length) {
    throw new VsdxImportError(
      `Page list (${pageEls.length} pages) does not match page relationships (${rels.length}) — refusing to guess the mapping.`,
      { provenance: PAGES_XML, code: "page-rel-mismatch" },
    );
  }
  return pageEls.map((el, index) => {
    const id = getAttr(el, "ID");
    const name = getAttr(el, "NameU") || getAttr(el, "Name") || `Page ${index + 1}`;
    const contentPath = rels[index].target;
    if (!pkg.has(contentPath)) {
      throw new VsdxImportError(`Page '${name}' points at missing part '${contentPath}'.`, {
        provenance: PAGES_XML,
        code: "missing-part",
      });
    }
    return {
      id: id == null ? String(index) : String(id),
      name,
      index,
      contentPath,
      backPageId: getAttr(el, "BackPage") || null,
    };
  });
}
