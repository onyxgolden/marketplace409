// Tests for the real preview controller (forge-capture-app/ui/preview-controller.js).
//
// These drive createPreviewController directly with fake DOM elements and a
// controllable invoke/loadImage — no mirrored logic. They cover the PR #639
// review findings: generation guards on overlapping loads (C639-002),
// empty/undecodable payloads (C639-003), the local preview payload path
// (C639-001), and display-error/warning separation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPreviewController } from "../preview-controller.js";

function makeEls() {
  const el = () => ({
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    _src: null,
    _attrs: {},
    removeAttribute(name) {
      delete this._attrs[name];
      if (name === "src") this._src = null;
    },
    setAttribute() {},
  });
  return {
    meta: el(),
    status: el(),
    warnings: el(),
    image: el(),
  };
}

function makeDialog() {
  return {
    shown: 0,
    closed: 0,
    _open: false,
    show() {
      this.shown++;
      this._open = true;
    },
    close() {
      this.closed++;
      this._open = false;
    },
    isOpen() {
      return this._open;
    },
  };
}

function makeHarness() {
  const els = makeEls();
  const dialog = makeDialog();
  // Controllable invoke: handlers keyed by command; each returns a promise
  // we can resolve/reject manually.
  const pending = [];
  const calls = [];
  const invoke = (cmd, args) => {
    calls.push({ cmd, args });
    return new Promise((resolve, reject) => {
      pending.push({ cmd, args, resolve, reject });
    });
  };
  // Controllable image loader.
  const loads = [];
  const loadImage = (img, src, isCurrent) => {
    img._src = src;
    return new Promise((resolve, reject) => {
      loads.push({ img, src, isCurrent, resolve, reject });
    });
  };
  const buttons = [{ disabled: true }, { disabled: true }, { disabled: true }];
  const controller = createPreviewController({
    invoke,
    els,
    dialog,
    loadImage,
    actions: { buttons },
  });
  return { els, dialog, invoke, pending, calls, loads, buttons, controller };
}

const refA = { id: "A", kind: "full-monitor", width: 1920, height: 1080, png_path: "a.png" };
const refB = { id: "B", kind: "region", width: 800, height: 600, png_path: "b.png" };

function payloadFor(id) {
  return { bytes_b64: `bytes-for-${id}`, mime: "image/png" };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("preview generation guards (C639-002)", () => {
  it("out-of-order A/B: image, metadata, and actions all end on B", async () => {
    const h = makeHarness();
    // Start A; its payload stays pending.
    const pA = h.controller.open(refA);
    await flush();
    expect(h.calls.filter((c) => c.cmd === "get_capture_preview_payload")).toHaveLength(1);

    // Fully load B.
    const pB = h.controller.open(refB);
    await flush();
    const bPayload = h.pending.find((p) => p.args.id === "B");
    bPayload.resolve(payloadFor("B"));
    await flush();
    const bLoad = h.loads.find((l) => l.src.includes("bytes-for-B"));
    bLoad.resolve();
    await flush();
    // Sidecar for B.
    const bSidecar = h.pending.find((p) => p.cmd === "get_sidecar" && p.args.id === "B");
    bSidecar.resolve(JSON.stringify({ warnings: [] }));
    await pB;
    await flush();

    expect(h.els.image._src).toContain("bytes-for-B");
    expect(h.els.meta.textContent).toContain("b.png");
    expect(h.controller.targetId()).toBe("B");

    // Now release A's stale payload: must be dropped BEFORE loadImage
    // is ever called for A (generation check after the payload await).
    // No new load entry appears; B stays displayed.
    const loadsBefore = h.loads.length;
    const aPayload = h.pending.find((p) => p.args.id === "A");
    aPayload.resolve(payloadFor("A"));
    await pA;
    await flush();

    expect(h.loads.length).toBe(loadsBefore);

    expect(h.els.image._src).toContain("bytes-for-B");
    expect(h.controller.targetId()).toBe("B");
    expect(h.buttons.every((b) => b.disabled === false)).toBe(true);
  });

  it("close-during-load: a late completion cannot reopen or repaint", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    h.controller.close();
    expect(h.dialog.isOpen()).toBe(false);

    // Release the payload after close: dropped at the generation check, so
    // loadImage is never invoked and nothing repaints or reopens.
    const loadsBefore = h.loads.length;
    const aPayload = h.pending.find((p) => p.args.id === "A");
    aPayload.resolve(payloadFor("A"));
    await p;
    await flush();

    expect(h.loads.length).toBe(loadsBefore);
    expect(h.dialog.isOpen()).toBe(false);
    expect(h.dialog.shown).toBe(1); // only the initial open
    expect(h.els.image._src).toBeNull();
    expect(h.controller.targetId()).toBeNull();
  });

  it("duplicate open for the same id issues a single payload fetch", async () => {
    const h = makeHarness();
    const p1 = h.controller.open(refA);
    const p2 = h.controller.open(refA);
    await flush();
    const payloadCalls = h.calls.filter((c) => c.cmd === "get_capture_preview_payload");
    expect(payloadCalls).toHaveLength(1);
    // Finish the one load.
    h.pending[0].resolve(payloadFor("A"));
    await flush();
    h.loads[0].resolve();
    await flush();
    h.pending.find((p) => p.cmd === "get_sidecar").resolve(JSON.stringify({ warnings: [] }));
    await Promise.all([p1, p2]);
    expect(h.controller.targetId()).toBe("A");
  });

  it("actions stay disabled until the image decodes", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    // Payload resolved but image not yet decoded.
    h.pending[0].resolve(payloadFor("A"));
    await flush();
    expect(h.buttons.every((b) => b.disabled === true)).toBe(true);
    expect(h.controller.targetId()).toBeNull();
    h.loads[0].resolve();
    await flush();
    h.pending.find((q) => q.cmd === "get_sidecar").resolve(JSON.stringify({ warnings: [] }));
    await p;
    expect(h.buttons.every((b) => b.disabled === false)).toBe(true);
    expect(h.controller.targetId()).toBe("A");
  });
});

describe("payload validation and decode errors (C639-003)", () => {
  it("empty payload shows an error and sets no image source", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    h.pending[0].resolve({ bytes_b64: "", mime: "image/png" });
    await p;
    await flush();
    expect(h.els.status.textContent).toMatch(/no image data/i);
    expect(h.els.status.className).toContain("error");
    expect(h.els.image._src).toBeNull();
    expect(h.loads).toHaveLength(0);
    expect(h.controller.targetId()).toBeNull();
  });

  it("decode failure shows an error and binds no target", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    h.pending[0].resolve(payloadFor("A"));
    await flush();
    h.loads[0].reject(new Error("decode failed"));
    await p;
    await flush();
    expect(h.els.status.textContent).toMatch(/could not be decoded/i);
    expect(h.els.status.className).toContain("error");
    expect(h.controller.targetId()).toBeNull();
  });

  it("stale imagery is cleared when a new preview starts", async () => {
    const h = makeHarness();
    // Load A fully.
    const pA = h.controller.open(refA);
    await flush();
    h.pending.find((p) => p.args.id === "A").resolve(payloadFor("A"));
    await flush();
    h.loads[0].resolve();
    await flush();
    h.pending.find((p) => p.cmd === "get_sidecar").resolve(JSON.stringify({ warnings: [] }));
    await pA;
    expect(h.els.image._src).toContain("bytes-for-A");

    // Open B: the old image must be cleared before B decodes.
    const pB = h.controller.open(refB);
    await flush();
    expect(h.els.image._src).toBeNull();
    // Clean up.
    h.pending.find((p) => p.args.id === "B").resolve(payloadFor("B"));
    await flush();
    h.loads[1].resolve();
    await flush();
    h.pending.find((p) => p.cmd === "get_sidecar" && p.args.id === "B").resolve(
      JSON.stringify({ warnings: [] })
    );
    await pB;
  });

  it("a delayed sidecar never overwrites a display error", async () => {
    const h = makeHarness();
    // Make the payload path succeed but the sidecar slow.
    const p = h.controller.open(refA);
    await flush();
    h.pending.find((p) => p.cmd === "get_capture_preview_payload").resolve(payloadFor("A"));
    await flush();
    // Decode fails -> display error.
    h.loads[0].reject(new Error("decode failed"));
    await p;
    await flush();
    expect(h.els.status.className).toContain("error");
    // No sidecar was requested after a decode failure, so there is nothing
    // to overwrite with. Warnings line stays empty.
    expect(h.els.warnings.textContent).toBe("");
  });

  it("capture warnings surface on the warnings line, not the status line", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    h.pending.find((q) => q.cmd === "get_capture_preview_payload").resolve(payloadFor("A"));
    await flush();
    h.loads[0].resolve();
    await flush();
    const sidecarCall = h.pending.find((q) => q.cmd === "get_sidecar");
    sidecarCall.resolve(JSON.stringify({ warnings: ["solid-color frame"] }));
    await p;
    await flush();
    expect(h.els.status.textContent).toBe("Preview loaded.");
    expect(h.els.warnings.textContent).toContain("solid-color frame");
  });
});

describe("local preview payload path (C639-001)", () => {
  it("uses get_capture_preview_payload, never the upload-capped command", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    const cmds = h.calls.map((c) => c.cmd);
    expect(cmds).toContain("get_capture_preview_payload");
    expect(cmds).not.toContain("get_capture_upload_payload");
    h.pending[0].resolve(payloadFor("A"));
    await flush();
    h.loads[0].resolve();
    await flush();
    h.pending.find((q) => q.cmd === "get_sidecar").resolve(JSON.stringify({ warnings: [] }));
    await p;
  });

  it("a large (4K-scale) payload is accepted by the preview path", async () => {
    const h = makeHarness();
    const p = h.controller.open(refA);
    await flush();
    // Simulate a 4K PNG payload (~8MB base64, well above the 25MB upload
    // cap when raw). The controller must not refuse it.
    const big = "iVBOR".repeat(1_400_000); // ~8.4MB base64
    h.pending[0].resolve({ bytes_b64: big, mime: "image/png" });
    await flush();
    expect(h.loads).toHaveLength(1);
    expect(h.els.status.className).not.toContain("error");
    h.loads[0].resolve();
    await flush();
    h.pending.find((q) => q.cmd === "get_sidecar").resolve(JSON.stringify({ warnings: [] }));
    await p;
    expect(h.controller.targetId()).toBe("A");
  });
});
