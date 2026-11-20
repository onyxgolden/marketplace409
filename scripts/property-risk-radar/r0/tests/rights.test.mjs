// Rights tests — every rights mode is recorded, every allowed mode has a
// receipt, and no camera display mode is enabled anywhere in the seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../src/validateRegistry.mjs";
import { CAMERAS } from "../src/preflight.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R0 = path.resolve(__dirname, "..");

const RIGHTS_MODES = [
  "metadataListing",
  "imageDisplay",
  "iframeEmbed",
  "hotlinking",
  "proxying",
  "caching",
  "archive",
];
const DISPLAY_MODES = [
  "imageDisplay",
  "iframeEmbed",
  "hotlinking",
  "proxying",
  "archive",
];

test("every source records all seven rights modes", () => {
  const registry = loadRegistry();
  for (const source of registry.sources) {
    for (const mode of RIGHTS_MODES) {
      assert.ok(source.rights[mode], `${source.id} missing rights.${mode}`);
    }
  }
});

test("every allowed mode has a receipt file that exists and names the source", () => {
  const registry = loadRegistry();
  for (const source of registry.sources) {
    for (const mode of RIGHTS_MODES) {
      const entry = source.rights[mode];
      if (entry.mode !== "allowed") {
        continue;
      }
      assert.ok(entry.receipt, `${source.id}.${mode} allowed without a receipt`);
      assert.match(entry.receiptDate, /^\d{4}-\d{2}-\d{2}$/, `${source.id}.${mode} receipt date`);
      const receiptPath = path.join(R0, entry.receipt);
      assert.ok(existsSync(receiptPath), `${source.id}.${mode} receipt missing: ${entry.receipt}`);
      const text = readFileSync(receiptPath, "utf8");
      assert.ok(text.includes(source.id), `${entry.receipt} must name ${source.id}`);
      assert.ok(text.includes("Registry version: 1.0.0"), `${entry.receipt} must record the registry version`);
    }
  }
});

test("no disabled source enables any display mode", () => {
  const registry = loadRegistry();
  for (const source of registry.sources) {
    if (source.status !== "disabled" && source.status !== "blocked") {
      continue;
    }
    for (const mode of DISPLAY_MODES) {
      assert.notEqual(
        source.rights[mode].mode,
        "allowed",
        `${source.id} (${source.status}) must not allow ${mode}`,
      );
    }
  }
});

test("Houston TranStar is link-only: metadata allowed, every display mode forbidden", () => {
  const registry = loadRegistry();
  const transtar = registry.sources.find((s) => s.id === "houston-transtar");
  assert.equal(transtar.referenceMode, "LINK_ONLY");
  assert.equal(transtar.rights.metadataListing.mode, "allowed");
  for (const mode of ["imageDisplay", "iframeEmbed", "hotlinking", "proxying", "caching", "archive"]) {
    assert.equal(transtar.rights[mode].mode, "forbidden", `transtar ${mode}`);
  }
});

test("EarthCam is link-only; Windy, TxDOT, and 511 enable no display mode", () => {
  const registry = loadRegistry();
  const earthcam = registry.sources.find((s) => s.id === "earthcam");
  assert.equal(earthcam.referenceMode, "LINK_ONLY");
  assert.equal(earthcam.rights.metadataListing.mode, "allowed");
  assert.equal(earthcam.rights.imageDisplay.mode, "forbidden");

  const windy = registry.sources.find((s) => s.id === "windy");
  for (const mode of RIGHTS_MODES) {
    assert.equal(windy.rights[mode].mode, "forbidden", `windy ${mode}`);
  }
  const txdot = registry.sources.find((s) => s.id === "txdot");
  for (const mode of ["imageDisplay", "iframeEmbed", "hotlinking", "proxying", "caching", "archive"]) {
    assert.equal(txdot.rights[mode].mode, "forbidden", `txdot ${mode}`);
  }
  const program511 = registry.sources.find((s) => s.id === "program-511");
  for (const mode of ["imageDisplay", "iframeEmbed", "hotlinking", "proxying", "caching", "archive"]) {
    assert.equal(program511.rights[mode].mode, "forbidden", `511 ${mode}`);
  }
});

test("no camera evaluator reports display as allowed", () => {
  for (const [id, camera] of Object.entries(CAMERAS)) {
    const disposition = camera.evaluate();
    assert.equal(disposition.displayAllowed, false, id);
    assert.equal(disposition.status, "disabled", id);
  }
});
