// FORGE Capture — PPTX text + notes extraction (ui/pptx-extract-core.js).
//
// DOM-free pure logic. Runs unmodified under vitest (node) and in the
// Tauri webview.
//
// Two rules from the Slice 1 brief, implemented literally here:
//   1. Speaker notes come from the notes slide reached through the
//      slide's own relationships (ppt/slides/_rels -> notesSlide),
//      never from slide XML. Only the notes slide's `body`
//      placeholder is read; its slide-number / slide-image
//      placeholders are not narration.
//   2. Slide text extraction skips footer / date / slide-number /
//      slide-image placeholder shapes, so master boilerplate is never
//      misread as narration. Text is collected in document order
//      (paragraphs, then bullets), tables cell by cell, chart titles
//      from the chart part.
//
// External relationships are never dereferenced: an external notes
// target yields an empty note plus a warning, not a fetch.
import {
  parseRelationships,
  parseXmlPart,
  resolvePartPath,
  xmlAttr,
  xmlChildren,
  xmlFind,
  xmlFirst,
  xmlKids,
  xmlText,
} from "./pptx-import-core.js";

// Placeholder types that are never narration (brief §2.2).
const EXCLUDED_PLACEHOLDER_TYPES = new Set(["ftr", "dt", "sldNum", "sldImg"]);

// Field types whose cached text is boilerplate, not content.
const EXCLUDED_FIELD_TYPES = new Set(["slidenum", "datetimeFigureOut", "datetime1", "datetime2"]);

/** Placeholder type of a shape's <p:ph>, or null when it has none. */
export function shapePlaceholderType(shapeNode) {
  const nvSpPr = xmlFirst(shapeNode, "p:nvSpPr");
  if (!nvSpPr) return null;
  const nvPr = xmlFirst(nvSpPr, "p:nvPr");
  if (!nvPr) return null;
  const ph = xmlFirst(nvPr, "p:ph");
  if (!ph) return null;
  return xmlAttr(ph, "type") || "body";
}

/** Plain text of one <a:p> paragraph entry, in document order. */
export function paragraphText(paragraphEntry) {
  let out = "";
  for (const entry of xmlKids(paragraphEntry)) {
    if (!entry || typeof entry !== "object") continue;
    for (const [tag, children] of Object.entries(entry)) {
      if (tag === ":@") continue;
      if (tag === "a:r") {
        out += xmlText(xmlFirst(children, "a:t") || []);
      } else if (tag === "a:br") {
        out += "\n";
      } else if (tag === "a:fld") {
        const type = xmlAttr(entry, "type");
        if (type && EXCLUDED_FIELD_TYPES.has(type)) continue;
        out += xmlText(xmlFirst(children, "a:t") || []);
      }
    }
  }
  return out;
}

/** All non-empty paragraphs of a <p:txBody>, in order. */
export function textBodyParagraphs(txBodyNode) {
  const paragraphs = [];
  for (const p of xmlChildren(txBodyNode, "a:p")) {
    const text = paragraphText(p).replace(/[ \t]+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function shapeTextBody(shapeNode) {
  return xmlFirst(shapeNode, "p:txBody");
}

/**
 * Walk a slide's shape tree in document order, calling `visit` for each
 * shape (<p:sp>) and graphic frame (<p:graphicFrame>). Group shapes
 * (<p:grpSp>) are recursed in place.
 */
export function walkShapeTree(spTreeNode, visit) {
  for (const entry of spTreeNode) {
    if (!entry || typeof entry !== "object") continue;
    for (const [tag, children] of Object.entries(entry)) {
      if (tag === ":@") continue;
      if (tag === "p:sp" || tag === "p:cxnSp" || tag === "p:graphicFrame") {
        visit(tag, children);
      } else if (tag === "p:grpSp") {
        // Group children live directly under the group node.
        walkShapeTree(children, visit);
      }
    }
  }
}

/**
 * Extract the speaker notes for one slide.
 * Returns { notes, warnings }. `notes` is "" when the slide has none.
 */
export function extractSlideNotes(pkg, slidePart) {
  const warnings = [];
  const relsPath = slidePart.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
  const relsBytes = pkg.parts.get(relsPath);
  if (!relsBytes) return { notes: "", warnings };
  let rels;
  try {
    rels = parseXmlPart(relsBytes, relsPath);
  } catch (e) {
    warnings.push({
      code: "bad-relationships",
      message: `The links for slide ${slidePart} could not be read; its notes were skipped.`,
      part: relsPath,
    });
    return { notes: "", warnings };
  }
  let relMap;
  try {
    relMap = parseRelationships(rels, relsPath);
  } catch {
    warnings.push({
      code: "bad-relationships",
      message: `The links for slide ${slidePart} are broken; its notes were skipped.`,
      part: relsPath,
    });
    return { notes: "", warnings };
  }
  let notesRel = null;
  for (const rel of relMap.values()) {
    if (rel.type.endsWith("/notesSlide")) {
      notesRel = rel;
      break;
    }
  }
  if (!notesRel) return { notes: "", warnings };
  if (notesRel.targetMode === "External") {
    warnings.push({
      code: "external-notes",
      message: "This slide links its notes to a web address. Capture does not open web links, so the notes were skipped.",
      part: slidePart,
    });
    return { notes: "", warnings };
  }
  const notesPart = resolvePartPath("ppt/slides/", notesRel.target);
  const notesBytes = pkg.parts.get(notesPart);
  if (!notesBytes) {
    warnings.push({
      code: "missing-notes",
      message: "This slide links to a notes page that is missing from the file.",
      part: slidePart,
    });
    return { notes: "", warnings };
  }
  let notesXml;
  try {
    notesXml = parseXmlPart(notesBytes, notesPart);
  } catch {
    warnings.push({
      code: "bad-notes",
      message: "This slide's notes page could not be read.",
      part: slidePart,
    });
    return { notes: "", warnings };
  }
  const notesRoot = xmlFirst(notesXml, "p:notes");
  const cSld = notesRoot ? xmlFirst(notesRoot, "p:cSld") : null;
  const spTree = cSld ? xmlFirst(cSld, "p:spTree") : null;
  if (!spTree) return { notes: "", warnings };
  let notes = "";
  walkShapeTree(xmlKids(spTree), (tag, node) => {
    if (tag !== "p:sp") return;
    if (shapePlaceholderType(node) !== "body") return;
    const txBody = shapeTextBody(node);
    if (!txBody) return;
    notes = textBodyParagraphs(txBody).join("\n");
  });
  return { notes, warnings };
}

/**
 * Extract readable text from one slide, in document order.
 * Returns { title, paragraphs, tables, chartTitles, fonts, warnings }.
 * - title: the title placeholder's text, else the first paragraph.
 * - paragraphs: body text, placeholder boilerplate excluded.
 * - tables: one entry per table, rows of cell strings.
 * - chartTitles: chart titles found through chart relationships.
 * - fonts: typeface names used by runs on this slide.
 */
export function extractSlideText(pkg, slidePart) {
  const warnings = [];
  const slideBytes = pkg.parts.get(slidePart);
  if (!slideBytes) return { title: "", paragraphs: [], tables: [], chartTitles: [], fonts: [], warnings };
  let slideXml;
  try {
    slideXml = parseXmlPart(slideBytes, slidePart);
  } catch {
    warnings.push({
      code: "bad-slide",
      message: `Slide ${slidePart} could not be read; its text was skipped.`,
      part: slidePart,
    });
    return { title: "", paragraphs: [], tables: [], chartTitles: [], fonts: [], warnings };
  }
  const cSld = xmlFind(slideXml, "p:sld", "p:cSld");
  const spTree = cSld ? xmlFirst(cSld, "p:spTree") : null;
  if (!spTree) return { title: "", paragraphs: [], tables: [], chartTitles: [], fonts: [], warnings };

  const paragraphs = [];
  const tables = [];
  const chartTitles = [];
  const fonts = new Set();
  let title = "";

  const collectFontsFrom = (node) => {
    if (!Array.isArray(node)) return;
    for (const entry of node) {
      if (!entry || typeof entry !== "object") continue;
      for (const [key, value] of Object.entries(entry)) {
        if (key === ":@") {
          const latin = entry[":@"]["@_typeface"];
          if (latin) fonts.add(latin);
          continue;
        }
        if (key === "a:rPr" || key === "a:defRPr" || key === "a:endParaRPr") {
          const latin = xmlFirst(value, "a:latin");
          const face = latin ? xmlAttr(latin, "typeface") : undefined;
          if (face) fonts.add(face);
        }
        collectFontsFrom(value);
      }
    }
  };

  walkShapeTree(xmlKids(spTree), (tag, node) => {
    if (tag === "p:sp" || tag === "p:cxnSp") {
      const phType = shapePlaceholderType(node);
      if (phType && EXCLUDED_PLACEHOLDER_TYPES.has(phType)) return;
      const txBody = shapeTextBody(node);
      if (!txBody) return;
      collectFontsFrom(node);
      const paras = textBodyParagraphs(txBody);
      if ((phType === "title" || phType === "ctrTitle") && paras.length > 0 && !title) {
        title = paras[0];
      }
      paragraphs.push(...paras);
      return;
    }
    if (tag === "p:graphicFrame") {
      const graphic = xmlFirst(node, "a:graphic");
      const graphicData = graphic ? xmlFirst(graphic, "a:graphicData") : null;
      if (!graphicData) return;
      const tbl = xmlFirst(graphicData, "a:tbl");
      if (tbl) {
        const rows = [];
        for (const tr of xmlChildren(tbl, "a:tr")) {
          const cells = [];
          for (const tc of xmlChildren(tr, "a:tc")) {
            const cellBody = xmlFirst(tc, "a:txBody");
            cells.push(cellBody ? textBodyParagraphs(cellBody).join(" ") : "");
          }
          rows.push(cells);
        }
        tables.push(rows);
        return;
      }
      const chart = xmlFirst(graphicData, "c:chart");
      if (chart) {
        const chartTitle = extractChartTitle(pkg, slidePart, chart);
        if (chartTitle) chartTitles.push(chartTitle);
      }
    }
  });

  if (!title && paragraphs.length > 0) title = paragraphs[0];
  return {
    title,
    paragraphs,
    tables,
    chartTitles,
    fonts: [...fonts],
    warnings,
  };
}

/** Chart title text, resolved through the slide's chart relationship. */
function extractChartTitle(pkg, slidePart, chartNode) {
  const rId = xmlAttr(chartNode, "r:id");
  if (!rId) return "";
  const relsPath = slidePart.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
  const relsBytes = pkg.parts.get(relsPath);
  if (!relsBytes) return "";
  let relMap;
  try {
    relMap = parseRelationships(parseXmlPart(relsBytes, relsPath), relsPath);
  } catch {
    return "";
  }
  const rel = relMap.get(rId);
  if (!rel || rel.targetMode === "External") return "";
  const chartPart = resolvePartPath("ppt/slides/", rel.target);
  const chartBytes = pkg.parts.get(chartPart);
  if (!chartBytes) return "";
  let chartXml;
  try {
    chartXml = parseXmlPart(chartBytes, chartPart);
  } catch {
    return "";
  }
  const title = xmlFind(chartXml, "c:chartSpace", "c:chart", "c:title");
  if (!title) return "";
  const tx = xmlFirst(title, "c:tx");
  const rich = tx ? xmlFirst(tx, "c:rich") : null;
  if (!rich) return "";
  const paras = [];
  for (const p of xmlChildren(rich, "a:p")) {
    const text = paragraphText(p).trim();
    if (text) paras.push(text);
  }
  return paras.join(" ");
}
