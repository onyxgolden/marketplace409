/**
 * schemas.js — strict runtime validation of the distiller input snapshot.
 *
 * Input schema `dom-distill/1` (documented in README.md):
 *
 * {
 *   schema_version: "dom-distill/1",
 *   fixture_id: string,            // frozen fixture identity
 *   build_id: string,              // fixture build identity
 *   snapshot_digest: 64-hex,       // sha256 of canonicalJson(nodes)
 *   document: { url: string, title: string },
 *   frames: [ { frame_id: string, root_refs: [ref...] } ],
 *   nodes: [ node ],
 *   task: { id: string, goal: string }
 * }
 *
 * node = {
 *   ref: "e12",                    // stable observation reference
 *   frame_id: string,              // must name a declared frame
 *   role: string,                  // closed role vocabulary (below)
 *   name: string,                  // accessible name/label (may be "")
 *   value: string|null,
 *   text: string|null,             // static text content (may be null)
 *   state: { disabled, checked, expanded, hidden, invalid, readonly,
 *            selected, pressed, offscreen } — booleans, all required
 *   validation_error: string|null,
 *   warning: string|null,         // confirmation / payment / destructive warnings
 *   bounds: { x,y,w,h } | null,
 *   children: [ref]
 * }
 *
 * Unknown properties are rejected. Refs must be unique across the snapshot,
 * child refs must resolve within the SAME frame (cross-frame references
 * refuse), and every node must belong to a declared frame.
 */

import { HEX64 } from "./canonical.js";

export const SCHEMA_VERSION = "dom-distill/1";

const ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option",
  "checkbox", "radio", "switch", "slider", "spinbutton", "tab", "tablist",
  "tabpanel", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "dialog", "alertdialog", "alert", "heading", "banner", "main", "navigation",
  "form", "region", "generic", "text", "image", "separator", "progressbar",
  "status", "tooltip", "tree", "treeitem", "grid", "row", "columnheader",
  "rowheader", "gridcell", "table", "cell",
]);

const STATE_KEYS = ["disabled", "checked", "expanded", "hidden", "invalid", "readonly", "selected", "pressed", "offscreen"];

function isStr(v) { return typeof v === "string"; }
function isStrOrNull(v) { return v === null || typeof v === "string"; }

function fail(path, why) {
  throw new Error(`schema: ${path}: ${why}`);
}

function checkState(st, path) {
  if (st === null || typeof st !== "object" || Array.isArray(st)) fail(path, "state must be an object");
  for (const k of Object.keys(st)) {
    if (!STATE_KEYS.includes(k)) fail(path, `unknown state key ${JSON.stringify(k)}`);
  }
  for (const k of STATE_KEYS) {
    if (typeof st[k] !== "boolean") fail(path, `state.${k} must be boolean`);
  }
}

function checkBounds(b, path) {
  if (b === null) return;
  if (b === null || typeof b !== "object" || Array.isArray(b)) fail(path, "bounds must be an object or null");
  for (const k of ["x", "y", "w", "h"]) {
    if (typeof b[k] !== "number" || !Number.isFinite(b[k])) fail(path, `bounds.${k} must be a finite number`);
  }
  const extra = Object.keys(b).filter(k => !["x", "y", "w", "h"].includes(k));
  if (extra.length) fail(path, `unknown bounds keys ${extra.join(",")}`);
}

function checkNode(n, path) {
  if (n === null || typeof n !== "object" || Array.isArray(n)) fail(path, "node must be an object");
  const allowed = ["ref", "frame_id", "role", "name", "value", "text", "state",
    "validation_error", "warning", "bounds", "children"];
  for (const k of Object.keys(n)) {
    if (!allowed.includes(k)) fail(path, `unknown property ${JSON.stringify(k)}`);
  }
  if (!isStr(n.ref) || !/^e[0-9]+$/.test(n.ref)) fail(path, "ref must match /^e[0-9]+$/");
  if (!isStr(n.frame_id)) fail(path, "frame_id must be a string");
  if (!ROLES.has(n.role)) fail(path, `unknown role ${JSON.stringify(n.role)}`);
  if (!isStr(n.name)) fail(path, "name must be a string");
  if (!isStrOrNull(n.value)) fail(path, "value must be string|null");
  if (!isStrOrNull(n.text)) fail(path, "text must be string|null");
  checkState(n.state, path + ".state");
  if (!isStrOrNull(n.validation_error)) fail(path, "validation_error must be string|null");
  if (!isStrOrNull(n.warning)) fail(path, "warning must be string|null");
  checkBounds(n.bounds, path + ".bounds");
  if (!Array.isArray(n.children) || !n.children.every(c => typeof c === "string")) {
    fail(path, "children must be an array of ref strings");
  }
}

/**
 * Validate the snapshot. Returns { frames: Map<frame_id, root_refs>, nodes: Map<ref, node> }.
 * Throws on any violation. Cross-frame or dangling child refs throw here
 * (the distiller treats them as refusal, never silently).
 */
export function validateSnapshot(snap) {
  if (snap === null || typeof snap !== "object" || Array.isArray(snap)) fail("$", "snapshot must be an object");
  const allowed = ["schema_version", "fixture_id", "build_id", "snapshot_digest", "document", "frames", "nodes", "task"];
  for (const k of Object.keys(snap)) {
    if (!allowed.includes(k)) fail("$", `unknown property ${JSON.stringify(k)}`);
  }
  if (snap.schema_version !== SCHEMA_VERSION) fail("$.schema_version", `must be ${SCHEMA_VERSION}`);
  if (!isStr(snap.fixture_id)) fail("$.fixture_id", "must be a string");
  if (!isStr(snap.build_id)) fail("$.build_id", "must be a string");
  if (!isStr(snap.snapshot_digest) || !HEX64.test(snap.snapshot_digest)) {
    fail("$.snapshot_digest", "must be 64 lowercase hex");
  }
  const doc = snap.document;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) fail("$.document", "must be an object");
  if (!isStr(doc.url) || !isStr(doc.title)) fail("$.document", "url and title must be strings");
  if (!Array.isArray(snap.frames) || snap.frames.length === 0) fail("$.frames", "must be a non-empty array");
  const frameIds = new Set();
  for (let i = 0; i < snap.frames.length; i++) {
    const f = snap.frames[i];
    const p = `$.frames[${i}]`;
    if (f === null || typeof f !== "object" || Array.isArray(f)) fail(p, "frame must be an object");
    if (!isStr(f.frame_id)) fail(p, "frame_id must be a string");
    if (frameIds.has(f.frame_id)) fail(p, `duplicate frame_id ${JSON.stringify(f.frame_id)}`);
    frameIds.add(f.frame_id);
    if (!Array.isArray(f.root_refs) || !f.root_refs.every(r => typeof r === "string")) {
      fail(p, "root_refs must be an array of ref strings");
    }
  }
  if (!Array.isArray(snap.nodes)) fail("$.nodes", "must be an array");
  const nodes = new Map();
  for (let i = 0; i < snap.nodes.length; i++) {
    const n = snap.nodes[i];
    checkNode(n, `$.nodes[${i}]`);
    if (nodes.has(n.ref)) fail(`$.nodes[${i}]`, `duplicate ref ${n.ref}`);
    if (!frameIds.has(n.frame_id)) fail(`$.nodes[${i}]`, `unknown frame_id ${JSON.stringify(n.frame_id)}`);
    nodes.set(n.ref, n);
  }
  // Every child ref must resolve within the SAME frame (cross-frame refs refuse).
  for (const n of nodes.values()) {
    for (const c of n.children) {
      const child = nodes.get(c);
      if (!child) fail(`node ${n.ref}`, `dangling child ref ${c}`);
      if (child.frame_id !== n.frame_id) {
        fail(`node ${n.ref}`, `cross-frame child ref ${c} (frame ${child.frame_id})`);
      }
    }
  }
  const task = snap.task;
  if (task === null || typeof task !== "object" || Array.isArray(task)) fail("$.task", "must be an object");
  if (!isStr(task.id) || !isStr(task.goal)) fail("$.task", "id and goal must be strings");
  return { frames: snap.frames, nodes };
}
