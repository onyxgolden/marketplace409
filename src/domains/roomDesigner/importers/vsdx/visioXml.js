/**
 * XML parsing boundary for the VSDX importer.
 *
 * All DOMParser/XMLSerializer mechanics live here so geometry and transform
 * code never touches XML directly. Parsing is namespace-tolerant: Visio
 * namespace prefixes are aliases, so element access matches on localName,
 * never on prefixed selectors.
 *
 * XML security: DOMParser never fetches external entities or remote
 * resources; package relationships resolve to package-local parts only
 * (enforced by vsdxPackage's entry-name rules). Documents that fail to
 * parse are rejected outright — never partially interpreted.
 */

import { VsdxImportError } from "./vsdxErrors";

function getParser() {
  const Parser = globalThis.DOMParser;
  if (typeof Parser !== "function") {
    throw new VsdxImportError("This browser cannot parse XML (no DOMParser).", {
      code: "no-domparser",
    });
  }
  return new Parser();
}

/**
 * Parse an XML part into a Document.
 * `what` is a provenance label like "visio/pages/pages.xml".
 */
export function parseXml(text, what) {
  const parser = getParser();
  const doc = parser.parseFromString(text, "application/xml");
  const errors = doc.getElementsByTagName("parsererror");
  if (errors.length > 0) {
    const detail = (errors[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
    throw new VsdxImportError(`Could not parse '${what}' as XML${detail ? `: ${detail}` : "."}`, {
      provenance: what,
      code: "malformed-xml",
    });
  }
  return doc;
}

/** Local (namespace-free) name of an element. */
export function localName(el) {
  return el.localName || el.tagName.split(":").pop();
}

/** Direct child elements of `parent` whose localName is `name`. */
export function childElements(parent, name) {
  const out = [];
  if (!parent || !parent.childNodes) return out;
  for (const child of parent.childNodes) {
    if (child.nodeType === 1 && localName(child) === name) out.push(child);
  }
  return out;
}

/** First direct child element with localName `name`, or null. */
export function firstChild(parent, name) {
  const found = childElements(parent, name);
  return found.length > 0 ? found[0] : null;
}

export function getAttr(el, name) {
  if (!el || typeof el.getAttribute !== "function") return null;
  return el.getAttribute(name);
}

/** Concatenated text content of an element, whitespace-collapsed and trimmed. */
export function textOf(el) {
  if (!el) return "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}
