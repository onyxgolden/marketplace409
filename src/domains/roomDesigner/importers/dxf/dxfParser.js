/**
 * ASCII DXF reader: text → { header, layers, blocks, entities }.
 *
 * DXF is a flat stream of (group code, value) line pairs. This reader keeps
 * only what a floor-plan import needs and ignores everything else:
 *   HEADER   $INSUNITS (drawing units), $ACADVER, $EXTMIN/$EXTMAX
 *   TABLES   LAYER entries (name, off/frozen state)
 *   BLOCKS   block definitions (base point + entities) for INSERT expansion
 *   ENTITIES the drawing's model-space entities
 *
 * Each entity keeps its type, layer, and the raw group pairs it owns, plus a
 * few decoded fields; the geometry stage (dxfGeometry.js) interprets them.
 * Binary DXF and DWG are refused with a clear message — DWG is a closed
 * binary format, and DXF (ASCII) is the documented interchange path.
 *
 * Pure: no DOM, no network.
 */

import { DxfImportError } from "./dxfErrors";

/** Largest DXF accepted (characters). Plans are typically well under 20 MB. */
export const MAX_DXF_CHARS = 60 * 1024 * 1024;
/** Most entities read (model space + blocks) before refusing. */
export const MAX_DXF_ENTITIES = 300000;

const BINARY_SENTINEL = "AutoCAD Binary DXF";

/** Split into (code, value) pairs. Codes are integers; values are trimmed right. */
function* pairs(text) {
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      throw new DxfImportError(`Line ${i + 1} is not a DXF group code — the file may be damaged.`, { code: "malformed" });
    }
    // Code-0 values are structural tokens (SECTION, ENDSEC, entity types):
    // compare them trimmed so an indented file still parses. Content values
    // (TEXT strings, names) keep their leading spaces.
    const value = lines[i + 1].replace(/\s+$/, "");
    yield [code, code === 0 ? value.trim() : value];
  }
}

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Detect and refuse formats this reader can't handle.
 * Accepts a string (ASCII DXF) or bytes (decoded as UTF-8 / latin1).
 */
export function decodeDxfInput(input) {
  let text;
  if (typeof input === "string") text = input;
  else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 22));
    if (head.startsWith(BINARY_SENTINEL)) {
      throw new DxfImportError("This is a binary DXF. Save it as ASCII DXF from your CAD program and import that.", { code: "binary-dxf" });
    }
    // A DWG starts with its version string at byte 0: "AC1032" (2018),
    // "AC1015" (2000), … down to "AC1.40"/"AC2.10" for very old releases.
    if (/^AC(1\d{3}|\d\.\d\d)/.test(head)) {
      throw new DxfImportError("This is a DWG file. Save or export it as DXF (ASCII) from your CAD program and import that.", { code: "dwg" });
    }
    text = new TextDecoder("utf-8").decode(bytes);
  } else {
    throw new DxfImportError("Import needs the .dxf file contents.", { code: "bad-input" });
  }
  if (text.startsWith(BINARY_SENTINEL)) {
    throw new DxfImportError("This is a binary DXF. Save it as ASCII DXF from your CAD program and import that.", { code: "binary-dxf" });
  }
  if (text.length > MAX_DXF_CHARS) {
    throw new DxfImportError("This DXF is too large to import in the browser (over 60 MB).", { code: "too-large" });
  }
  if (!/^\s*0\s*\r?\n\s*SECTION/m.test(text.slice(0, 4096))) {
    throw new DxfImportError("This doesn't look like a DXF file (no SECTION found at the start).", { code: "not-dxf" });
  }
  return text;
}

/** Decode commonly used fields of an entity from its group pairs. */
function decodeEntity(type, groups) {
  const e = { type, layer: "0", groups };
  const pts = []; // ordered (10,20) points for LWPOLYLINE, with bulges
  let pending = null;
  for (const [code, value] of groups) {
    switch (code) {
      case 8: e.layer = value || "0"; break;
      case 2: e.name = value; break; // INSERT block name, DIMENSION block
      case 1: e.text = (e.text || "") + value; break;
      case 3: e.text = (e.text || "") + value; break; // MTEXT continuation
      case 10:
        if (type === "LWPOLYLINE") { pending = { x: num(value), y: 0, bulge: 0 }; pts.push(pending); }
        else e.x = num(value);
        break;
      case 20:
        if (type === "LWPOLYLINE" && pending) pending.y = num(value);
        else e.y = num(value);
        break;
      case 11: e.x2 = num(value); break;
      case 21: e.y2 = num(value); break;
      case 40: e.r40 = num(value); break;
      case 41: e.s41 = num(value); break;
      case 42:
        if (type === "LWPOLYLINE" && pending) pending.bulge = num(value) || 0;
        else e.s42 = num(value);
        break;
      case 50: e.a50 = num(value); break;
      case 51: e.a51 = num(value); break;
      case 70: e.flags = Number.parseInt(value, 10) || 0; break;
      case 71: e.i71 = Number.parseInt(value, 10) || 0; break; // INSERT row count
      case 72: e.h72 = Number.parseInt(value, 10) || 0; break;
      case 73: e.v73 = Number.parseInt(value, 10) || 0; break; // TEXT vertical justification
      case 44: e.s44 = num(value); break; // INSERT column spacing
      case 45: e.s45 = num(value); break; // INSERT row spacing
      default: break;
    }
  }
  if (type === "LWPOLYLINE") e.points = pts.filter((p) => p.x !== null && p.y !== null);
  return e;
}

/**
 * Read entity records from a pair stream positioned after a section/block
 * header, until `stop` (e.g. ENDSEC / ENDBLK). POLYLINE+VERTEX+SEQEND are
 * folded into one POLYLINE entity with points.
 */
function readEntities(iter, stopTypes, counter) {
  const out = [];
  let current = null;
  let poly = null;
  const flush = () => {
    if (!current) return;
    counter.n += 1;
    if (counter.n > MAX_DXF_ENTITIES) {
      throw new DxfImportError(`This DXF has more than ${MAX_DXF_ENTITIES.toLocaleString()} entities — too many to import in the browser.`, { code: "too-many-entities" });
    }
    const e = decodeEntity(current.type, current.groups);
    if (e.type === "POLYLINE") {
      poly = { ...e, points: [] };
    } else if (e.type === "VERTEX") {
      if (poly && e.x !== null && e.y !== null && e.x !== undefined) poly.points.push({ x: e.x, y: e.y, bulge: e.s42 || 0 });
    } else if (e.type === "SEQEND") {
      if (poly) out.push(poly);
      poly = null;
    } else {
      out.push(e);
    }
    current = null;
  };
  for (;;) {
    const next = iter.next();
    if (next.done) break;
    const [code, value] = next.value;
    if (code === 0) {
      flush();
      if (stopTypes.includes(value)) return { entities: out, stoppedAt: value };
      current = { type: value, groups: [] };
    } else if (current) {
      current.groups.push([code, value]);
    }
  }
  flush();
  return { entities: out, stoppedAt: null };
}

/** Parse ASCII DXF text. Throws DxfImportError on unreadable input. */
export function parseDxf(input) {
  const text = decodeDxfInput(input);
  const iter = pairs(text);
  const header = {};
  const layers = new Map();
  const blocks = new Map();
  let entities = [];
  const counter = { n: 0 };

  for (;;) {
    const next = iter.next();
    if (next.done) break;
    const [code, value] = next.value;
    if (code !== 0 || value !== "SECTION") continue;
    const nameGroup = iter.next();
    if (nameGroup.done) break;
    const section = nameGroup.value[1].trim();

    if (section === "HEADER") {
      let variable = null;
      for (;;) {
        const n = iter.next();
        if (n.done) break;
        const [c, v] = n.value;
        if (c === 0 && v === "ENDSEC") break;
        if (c === 9) variable = v;
        else if (variable === "$INSUNITS" && c === 70) header.insUnits = Number.parseInt(v, 10);
        else if (variable === "$ACADVER" && c === 1) header.acadVersion = v;
        else if (variable === "$MEASUREMENT" && c === 70) header.measurement = Number.parseInt(v, 10);
      }
    } else if (section === "TABLES") {
      let inLayer = false;
      let layer = null;
      for (;;) {
        const n = iter.next();
        if (n.done) break;
        const [c, v] = n.value;
        if (c === 0) {
          if (layer) layers.set(layer.name, layer);
          layer = null;
          if (v === "ENDSEC") break;
          if (v === "LAYER") {
            inLayer = true;
            layer = { name: "", off: false, frozen: false };
          } else {
            inLayer = false;
          }
          continue;
        }
        if (!inLayer || !layer) continue;
        if (c === 2) layer.name = v;
        else if (c === 62) layer.off = Number.parseInt(v, 10) < 0; // negative color = off
        else if (c === 70) layer.frozen = (Number.parseInt(v, 10) & 1) === 1;
      }
      layers.delete("");
    } else if (section === "BLOCKS") {
      for (;;) {
        const n = iter.next();
        if (n.done) break;
        const [c, v] = n.value;
        if (c === 0 && v === "ENDSEC") break;
        if (c === 0 && v === "BLOCK") {
          // Block header groups until the first entity.
          const blockGroups = [];
          let first = null;
          for (;;) {
            const b = iter.next();
            if (b.done) break;
            if (b.value[0] === 0) { first = b.value[1]; break; }
            blockGroups.push(b.value);
          }
          const head = decodeEntity("BLOCK", blockGroups);
          let body = { entities: [] };
          if (first && first !== "ENDBLK") {
            // Re-inject the first entity marker by reading with a primed iterator.
            const primed = (function* prime() {
              yield [0, first];
              yield* iter;
            })();
            body = readEntities(primed, ["ENDBLK"], counter);
          }
          if (head.name) {
            blocks.set(head.name, { name: head.name, base: { x: head.x || 0, y: head.y || 0 }, entities: body.entities });
          }
        }
      }
    } else if (section === "ENTITIES") {
      entities = readEntities(iter, ["ENDSEC"], counter).entities;
    }
  }

  return { header, layers, blocks, entities };
}
