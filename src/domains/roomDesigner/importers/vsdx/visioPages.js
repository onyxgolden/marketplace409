/**
 * VSDX page discovery.
 *
 * Pages are enumerated from visio/pages/pages.xml and matched to their
 * content parts through the package relationships in
 * visio/pages/_rels/pages.xml.rels. Each <Page> element carries a <Rel>
 * child holding the OPC relationship id (r:id), and that id — not document
 * position — selects the matching <Relationship> entry. Relationship XML
 * ordering is not a semantic guarantee, so a valid package whose .rels
 * entries are reordered still resolves each page to its own content part.
 *
 * The filename of a page part (page1.xml) is NEVER assumed to correspond to
 * the first displayed page — ordering comes from pages.xml document order.
 */

import { VsdxImportError } from "./vsdxErrors";
import { childElements, firstChild, getAttr, getAttrLocal, parseXml } from "./visioXml";

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

/** Read the page relationships into a Map<relationshipId, resolvedTarget>. */
function readRelationshipMap(pkg, relsPath, sourcePart, kindLabel) {
  if (!pkg.has(relsPath)) {
    throw new VsdxImportError(`Package is missing relationships part '${relsPath}'.`, {
      provenance: relsPath,
      code: "missing-part",
    });
  }
  const doc = parseXml(pkg.getText(relsPath), relsPath);
  const map = new Map();
  for (const rel of childElements(doc.documentElement, "Relationship")) {
    const type = getAttr(rel, "Type");
    if (!relTypeIsPage(type)) continue;
    const id = getAttr(rel, "Id");
    const target = getAttr(rel, "Target");
    if (!id || !target) continue;
    if (map.has(id)) {
      throw new VsdxImportError(`Duplicate ${kindLabel} relationship id '${id}' in '${relsPath}'.`, {
        provenance: relsPath,
        code: "page-rel-mismatch",
      });
    }
    map.set(id, resolveTarget(sourcePart, target));
  }
  if (map.size === 0) {
    throw new VsdxImportError(`No ${kindLabel} relationships found in '${relsPath}'.`, {
      provenance: relsPath,
      code: "no-pages",
    });
  }
  return map;
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
  const relById = readRelationshipMap(pkg, PAGES_RELS, PAGES_XML, "page");
  return pageEls.map((el, index) => {
    const id = getAttr(el, "ID");
    const name = getAttr(el, "NameU") || getAttr(el, "Name") || `Page ${index + 1}`;
    const relId = getAttrLocal(firstChild(el, "Rel"), "id");
    if (relId == null || relId === "") {
      throw new VsdxImportError(
        `Page '${name}' has no relationship reference — cannot resolve its content part without guessing.`,
        { provenance: PAGES_XML, code: "page-rel-mismatch" },
      );
    }
    if (!relById.has(relId)) {
      throw new VsdxImportError(`Page '${name}' references unknown relationship '${relId}'.`, {
        provenance: PAGES_XML,
        code: "page-rel-mismatch",
      });
    }
    const contentPath = relById.get(relId);
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
