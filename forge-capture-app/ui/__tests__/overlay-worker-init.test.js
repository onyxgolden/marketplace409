// Tests for the C639 Option C overlay controller
// (forge-capture-app/ui/overlay.js -> createOverlayController).
//
// Drives the real factory with fake DOM and a controllable invoke — no
// mirrored logic. Covers the design verdict's UI acceptance fixtures:
// never-settling overlay_context / backdrop / image decode, the shared
// 5 s init budget, handlers-before-src, cached-image handling,
// preview-unavailable disabling capture commit, and escape hatches that
// never wait for the preview.

import { describe, it, expect, beforeEach } from "vitest";
import { createOverlayController } from "../overlay.js";

function makeImg(order) {
  const el = {
    style: {},
    complete: false,
    naturalWidth: 0,
    _src: null,
    _onload: null,
    _onerror: null,
    removeAttribute(name) {
      if (name === "src") {
        this._src = null;
        this.complete = false;
        this.naturalWidth = 0;
      }
    },
  };
  Object.defineProperty(el, "onload", {
    get: () => el._onload,
    set: (v) => {
      order.push("onload");
      el._onload = v;
    },
  });
  Object.defineProperty(el, "onerror", {
    get: () => el._onerror,
    set: (v) => {
      order.push("onerror");
      el._onerror = v;
    },
  });
  Object.defineProperty(el, "src", {
    get: () => el._src,
    set: (v) => {
      order.push("src");
      el._src = v;
    },
  });
  return el;
}

function makeEl() {
  return {
    style: {},
    textContent: "",
    disabled: false,
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
    removeAttribute() {},
    closest() {
      return null;
    },
  };
}

function makeDoc() {
  return {
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
    fire(type, event) {
      for (const fn of this._listeners[type] || []) fn(event);
    },
  };
}

function makeLctx() {
  return {
    imageSmoothingEnabled: false,
    clearRect() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    strokeRect() {},
    strokeStyle: "",
    lineWidth: 1,
  };
}

/// Fake monotonic clock + timer queue: lets a test advance `now()`
/// independently of when (or whether) a scheduled `setTimeoutFn`
/// callback actually fires — needed to reproduce C639-005's exact
/// counterexample (a stage's promise resolves only after real time has
/// passed the deadline, while its own reject-timer has not fired yet).
function fakeClock() {
  let t = 0;
  const pending = [];
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    setTimeoutFn(fn, ms) {
      const entry = { fn, ms, fired: false };
      pending.push(entry);
      return entry;
    },
    clearTimeoutFn(entry) {
      if (entry) entry.fired = true;
    },
  };
}

function makeHarness({
  invokeImpl,
  budgetMs = 5000,
  now,
  setTimeoutFn,
  clearTimeoutFn,
  // C639-007C.4: lets a test give this page a URL-borne session id (the
  // backend embeds `?session=<id>` in the real window) without disturbing
  // every other test's harness, which has no `location` at all and must
  // keep degrading to "unknown until overlay_context resolves".
  locationSearch,
} = {}) {
  const order = [];
  const calls = [];
  const els = {
    backdrop: makeImg(order),
    chV: makeEl(),
    chH: makeEl(),
    loupe: makeEl(),
    coords: makeEl(),
    sel: makeEl(),
    dims: makeEl(),
    hint: makeEl(),
    blankwarn: makeEl(),
    bwRetry: makeEl(),
    bwProceed: makeEl(),
    lctx: makeLctx(),
  };
  const doc = makeDoc();
  const win = {
    devicePixelRatio: 2,
    innerWidth: 1920,
    innerHeight: 1080,
    ...(typeof locationSearch === "string"
      ? { location: { search: locationSearch } }
      : {}),
  };
  const baseInvoke =
    invokeImpl ||
    ((cmd) => {
      if (cmd === "overlay_context")
        return Promise.resolve({ dpr: 2, session_id: 42 });
      if (cmd === "region_pick_backdrop")
        return Promise.resolve({ png_b64: "AAA=", width: 64, height: 48 });
      return Promise.resolve({});
    });
  const recordingInvoke = (cmd, args) => {
    calls.push({ cmd, args });
    return baseInvoke(cmd, args);
  };
  const controller = createOverlayController({
    els,
    invoke: recordingInvoke,
    doc,
    win,
    budgetMs,
    ...(now ? { now } : {}),
    ...(setTimeoutFn ? { setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeoutFn } : {}),
  });
  return { els, doc, win, calls, order, controller };
}

function drag(ctrl, doc, x0, y0, x1, y1) {
  doc.fire("mousedown", {
    button: 0,
    clientX: x0,
    clientY: y0,
    target: { closest: () => null },
  });
  return ctrl.onMouseUp({ button: 0, clientX: x1, clientY: y1 });
}

describe("overlay init budget (C639)", () => {
  it("never-settling overlay_context ends preview-unavailable within the budget", async () => {
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context") return new Promise(() => {}); // never settles
        return Promise.resolve({});
      },
    });
    const t0 = Date.now();
    await h.controller.init();
    const dt = Date.now() - t0;
    // Bounded: ~150 ms budget, not forever.
    expect(dt).toBeLessThan(2000);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
    expect(h.controller._state().backdropReady).toBe(false);
  });

  it("never-settling backdrop invoke ends preview-unavailable within the budget", async () => {
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context") return Promise.resolve({ dpr: 2 });
        return new Promise(() => {}); // backdrop never settles
      },
    });
    await h.controller.init();
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
    expect(h.controller._state().backdropReady).toBe(false);
  });

  it("the budget is shared: two slow steps do not each get the full budget", async () => {
    // Each step takes 120 ms; the shared budget is 150 ms. Without a
    // shared budget the init would take 240 ms+.
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context")
          return new Promise((r) => setTimeout(() => r({ dpr: 2 }), 120));
        if (cmd === "region_pick_backdrop")
          return new Promise((r) =>
            setTimeout(() => r({ png_b64: "AAA=" }), 120)
          );
        return Promise.resolve({});
      },
    });
    const t0 = Date.now();
    await h.controller.init();
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(1000);
    // The second step blew the shared budget -> unavailable.
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
  });

  it("a fast init inside the budget shows the backdrop", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    // Simulate the image decoding: complete the load on next tick.
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    expect(h.controller._state().backdropReady).toBe(true);
    expect(h.els.backdrop.style.display).toBe("block");
    expect(h.els.hint.style.display).toBe("none");
  });
});

describe("image handler ordering (C639)", () => {
  it("assigns onload/onerror BEFORE src", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    expect(h.order).toEqual(["onload", "onerror", "src"]);
  });

  it("an already-complete cached image resolves without waiting", async () => {
    const h = makeHarness({ budgetMs: 50 });
    // complete=true BEFORE init runs: the load must resolve synchronously
    // from the complete check, not wait for an event.
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    await h.controller.init();
    expect(h.controller._state().backdropReady).toBe(true);
  });

  it("a broken cached image (complete, zero width) is unavailable", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 0;
    await h.controller.init();
    expect(h.controller._state().backdropReady).toBe(false);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
  });

  it("an image load error is unavailable, not a hang", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    const p = h.controller.init();
    // Wait until loadBackdropImage has assigned the handlers.
    for (let i = 0; i < 50 && !h.els.backdrop._onerror; i++)
      await Promise.resolve();
    expect(h.els.backdrop._onerror).toBeTruthy();
    h.els.backdrop._onerror(new Error("decode"));
    await p;
    expect(h.controller._state().backdropReady).toBe(false);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
  });
});

describe("preview-unavailable honesty (C639)", () => {
  it("disables capture commit: no capture invoke without a verified backdrop", async () => {
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: () => new Promise(() => {}), // everything stalls
    });
    h.controller.wireStaticControls();
    await h.controller.init();
    h.calls.length = 0; // ignore init calls
    await drag(h.controller, h.doc, 10, 10, 200, 200);
    const captures = h.calls.filter((c) => c.cmd === "capture");
    expect(captures).toHaveLength(0);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
  });

  it("commits the drag when the backdrop is verified", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    h.calls.length = 0;
    await drag(h.controller, h.doc, 10, 10, 200, 200);
    const captures = h.calls.filter((c) => c.cmd === "capture");
    expect(captures).toHaveLength(1);
    expect(captures[0].args.dto.mode).toBe("region-overlay");
  });

  it("C639-007C.3: echoes overlay_context's own session id back on capture", async () => {
    // The backend binds this capture to the EXACT generation that opened
    // this page via this field — it must be the session id this page
    // itself learned at init, not omitted/guessed. C639-007C.5: that id
    // comes from the page's own URL, never adopted from overlay_context's
    // reply — so the URL and the harness's default context reply are set
    // to the same value here deliberately, not because the reply confirms
    // or overrides it.
    const h = makeHarness({ budgetMs: 2000, locationSearch: "?session=42" });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    h.calls.length = 0;
    await drag(h.controller, h.doc, 10, 10, 200, 200);
    const captures = h.calls.filter((c) => c.cmd === "capture");
    expect(captures).toHaveLength(1);
    expect(captures[0].args.dto.overlaySessionId).toBe(42);
  });

  it("a sliver drag cancels instead of capturing", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    h.calls.length = 0;
    await drag(h.controller, h.doc, 10, 10, 11, 11);
    expect(h.calls.filter((c) => c.cmd === "capture")).toHaveLength(0);
    expect(
      h.calls.filter((c) => c.cmd === "cancel_region_pick").length
    ).toBeGreaterThan(0);
  });
});

describe("escape hatches never wait for the preview (C639)", () => {
  it("Esc cancels while init is still pending", async () => {
    const h = makeHarness({
      budgetMs: 400,
      invokeImpl: () => new Promise(() => {}), // init never finishes
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    await Promise.resolve();
    h.doc.fire("keydown", { key: "Escape" });
    await Promise.resolve();
    expect(
      h.calls.filter((c) => c.cmd === "cancel_region_pick").length
    ).toBeGreaterThan(0);
    // Let the pending init settle (it will hit its budget); no unhandled rejection.
    await p;
  });

  it("right-click cancels while init is still pending", async () => {
    const h = makeHarness({
      budgetMs: 400,
      invokeImpl: () => new Promise(() => {}),
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    await Promise.resolve();
    let prevented = false;
    h.doc.fire("contextmenu", { preventDefault: () => (prevented = true) });
    await Promise.resolve();
    expect(prevented).toBe(true);
    expect(
      h.calls.filter((c) => c.cmd === "cancel_region_pick").length
    ).toBeGreaterThan(0);
    await p;
  });

  it("aim controls are shown before the preview resolves", async () => {
    const h = makeHarness({
      budgetMs: 400,
      invokeImpl: () => new Promise(() => {}),
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    await Promise.resolve();
    // Crosshairs up even though no pixel has arrived.
    expect(h.els.chV.style.display).toBe("block");
    expect(h.els.chH.style.display).toBe("block");
    await p;
  });
});

describe("overlay phase markers (C639 §5)", () => {
  it("reports page_boot/context/backdrop/image/aim_ready in order", async () => {
    const h = makeHarness({ budgetMs: 2000 });
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    const phases = h.calls
      .filter((c) => c.cmd === "capture_overlay_phase")
      .map((c) => c.args.phase);
    expect(phases).toEqual([
      "page_boot",
      "context",
      "backdrop",
      "image",
      "aim_ready",
    ]);
  });

  it("reports preview_unavailable with the failure detail", async () => {
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context") return Promise.resolve({ dpr: 2 });
        return new Promise(() => {}); // backdrop/image stall
      },
    });
    await h.controller.init();
    const phases = h.calls.filter((c) => c.cmd === "capture_overlay_phase");
    expect(phases[0].args.phase).toBe("page_boot");
    const last = phases[phases.length - 1];
    expect(last.args.phase).toBe("preview_unavailable");
    expect(last.args.detail).toMatch(/did not complete in time/);
    expect(typeof last.args.ms).toBe("number");
  });

  it("reports context_unavailable (not preview_unavailable) when the context stage itself stalls (C639-006)", async () => {
    // Context failure is now its own distinctly-named, immediate
    // short-circuit — it never falls through to attempt the
    // backdrop/image stage at all.
    const h = makeHarness({
      budgetMs: 150,
      invokeImpl: () => new Promise(() => {}), // everything stalls
    });
    await h.controller.init();
    const phases = h.calls.filter((c) => c.cmd === "capture_overlay_phase");
    expect(phases.map((c) => c.args.phase)).toEqual([
      "page_boot",
      "context_unavailable",
    ]);
    const last = phases[phases.length - 1];
    expect(last.args.detail).toMatch(/did not complete in time/);
  });
});

describe("retry (C639)", () => {
  it("retry re-invokes the backend and re-runs init", async () => {
    let backdrops = 0;
    const h = makeHarness({
      budgetMs: 2000,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context")
          return Promise.resolve({ dpr: 2, backdrop_blank: true });
        if (cmd === "region_pick_backdrop") {
          backdrops++;
          return Promise.resolve({ png_b64: "AAA=" });
        }
        return Promise.resolve({});
      },
    });
    h.controller.wireStaticControls();
    let p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    expect(h.els.blankwarn.style.display).toBe("block");
    // Click retry: the button must disable during the retry.
    const retryP = h.controller.onRetry();
    expect(h.els.bwRetry.disabled).toBe(true);
    // The re-init inside onRetry needs its image completed too.
    await Promise.resolve();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await retryP;
    expect(h.els.bwRetry.disabled).toBe(false);
    expect(backdrops).toBe(2);
    expect(h.calls.filter((c) => c.cmd === "retry_region_backdrop")).toHaveLength(1);
  });

  it("a late first init cannot clobber a newer retry (generation guard)", async () => {
    let releaseFirst;
    const firstGate = new Promise((r) => (releaseFirst = r));
    let inits = 0;
    const h = makeHarness({
      budgetMs: 5000,
      invokeImpl: (cmd) => {
        if (cmd === "region_pick_backdrop") {
          inits++;
          // The FIRST init's backdrop stays gated; the second resolves.
          if (inits === 1) return firstGate.then(() => ({ png_b64: "OLD" }));
          return Promise.resolve({ png_b64: "NEW" });
        }
        return Promise.resolve({ dpr: 2 });
      },
    });
    const p1 = h.controller.init();
    // Let p1 reach its (gated) backdrop invoke before superseding it.
    for (let i = 0; i < 20 && inits === 0; i++) await Promise.resolve();
    expect(inits).toBe(1);
    const p2 = h.controller.init();
    // Wait until p2's loadBackdropImage has assigned handlers + src.
    for (let i = 0; i < 50 && !h.els.backdrop._src; i++)
      await Promise.resolve();
    expect(h.els.backdrop._src).toBe("data:image/png;base64,NEW");
    // Complete p2's image through its own (live) handlers.
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    h.els.backdrop._onload();
    await p2;
    expect(h.controller._state().backdropReady).toBe(true);
    // Release the first init late: its generation is spent, so it must
    // return before touching the image — the NEW frame stands.
    releaseFirst();
    await p1;
    expect(h.controller._state().backdropReady).toBe(true);
    expect(h.els.backdrop._src).toBe("data:image/png;base64,NEW");
  });

  it("backdropReady is false immediately when retry starts, before the backend round trip resolves (C639 supplementary)", async () => {
    let releaseRetry;
    const retryGate = new Promise((r) => (releaseRetry = r));
    const h = makeHarness({
      budgetMs: 2000,
      invokeImpl: (cmd) => {
        if (cmd === "retry_region_backdrop") return retryGate;
        if (cmd === "overlay_context") return Promise.resolve({ dpr: 2 });
        if (cmd === "region_pick_backdrop")
          return Promise.resolve({ png_b64: "AAA=" });
        return Promise.resolve({});
      },
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    expect(h.controller._state().backdropReady).toBe(true);
    const retryP = h.controller.onRetry();
    // The backend hides the overlay for the duration of the native
    // re-acquisition (still pending here, gated by retryGate). A
    // drag+release queued right now must not read backdropReady=true
    // and invoke a concurrent capture against the hidden picker.
    expect(h.controller._state().backdropReady).toBe(false);
    releaseRetry();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await retryP;
  });
});

describe("overlay_context/region_pick_backdrop bind to this page's own session (C639-007C.5)", () => {
  it("overlay_context and region_pick_backdrop are both invoked with this page's URL-borne session id", async () => {
    const h = makeHarness({ budgetMs: 2000, locationSearch: "?session=33" });
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    const ctxCalls = h.calls.filter((c) => c.cmd === "overlay_context");
    const backdropCalls = h.calls.filter(
      (c) => c.cmd === "region_pick_backdrop"
    );
    expect(ctxCalls).toHaveLength(1);
    expect(ctxCalls[0].args.overlaySessionId).toBe(33);
    expect(backdropCalls).toHaveLength(1);
    expect(backdropCalls[0].args.overlaySessionId).toBe(33);
  });
});

describe("retry/cancel bind to this page's own session, not whichever pick is current (C639-007C.4)", () => {
  it("retry_region_backdrop carries the URL-borne session id when invoked before overlay_context has ever resolved", async () => {
    const h = makeHarness({
      budgetMs: 2000,
      locationSearch: "?session=99",
      invokeImpl: (cmd) =>
        cmd === "retry_region_backdrop"
          ? Promise.resolve({})
          : new Promise(() => {}), // overlay_context (and everything else) stalls
    });
    h.controller.wireStaticControls();
    const retryP = h.controller.onRetry();
    await Promise.resolve();
    await Promise.resolve();
    const retries = h.calls.filter((c) => c.cmd === "retry_region_backdrop");
    expect(retries).toHaveLength(1);
    expect(retries[0].args.overlaySessionId).toBe(99);
    // onRetry's own success path re-runs init(), which stalls forever on
    // overlay_context in this harness — deliberately not awaited here, the
    // dispatch above is what this test exercises.
    void retryP;
  });

  it("cancel_region_pick carries the URL-borne session id for Esc fired before overlay_context resolves", async () => {
    const h = makeHarness({
      budgetMs: 400,
      locationSearch: "?session=77",
      invokeImpl: () => new Promise(() => {}), // overlay_context never settles
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    await Promise.resolve();
    h.doc.fire("keydown", { key: "Escape" });
    await Promise.resolve();
    const cancels = h.calls.filter((c) => c.cmd === "cancel_region_pick");
    expect(cancels).toHaveLength(1);
    expect(cancels[0].args.overlaySessionId).toBe(77);
    await p;
  });

  it("cancel_region_pick carries the URL-borne session id for right-click fired before overlay_context resolves", async () => {
    const h = makeHarness({
      budgetMs: 400,
      locationSearch: "?session=78",
      invokeImpl: () => new Promise(() => {}),
    });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    await Promise.resolve();
    h.doc.fire("contextmenu", { preventDefault: () => {} });
    await Promise.resolve();
    const cancels = h.calls.filter((c) => c.cmd === "cancel_region_pick");
    expect(cancels).toHaveLength(1);
    expect(cancels[0].args.overlaySessionId).toBe(78);
    await p;
  });

  it("C639-007C.5: a sliver-drag cancel keeps the URL-borne session id even when overlay_context replies with a different one", async () => {
    // The URL supplies 55; this harness's default invokeImpl replies to
    // overlay_context with session_id: 42 (simulating a stale page that
    // momentarily received a NEWER page's global context). The URL-borne
    // id is this page's immutable authority — the reply must never
    // overwrite it.
    const h = makeHarness({ budgetMs: 2000, locationSearch: "?session=55" });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    h.calls.length = 0;
    await drag(h.controller, h.doc, 10, 10, 11, 11);
    const cancels = h.calls.filter((c) => c.cmd === "cancel_region_pick");
    expect(cancels).toHaveLength(1);
    expect(cancels[0].args.overlaySessionId).toBe(55);
  });

  it("C639-007C.5: overlay_context's own session_id is never adopted as this page's identity, even with no URL-borne session", async () => {
    // No URL at all in this harness — the OLD behavior let the page learn
    // (adopt) its session from overlay_context's own reply in exactly
    // this case; that adoption is the mechanism C639-007C.5 closes. The
    // page's session now simply stays whatever initialSessionId(win)
    // produced (null here), never overwritten by the reply's session_id.
    const h = makeHarness({ budgetMs: 2000 });
    h.controller.wireStaticControls();
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p;
    h.calls.length = 0;
    await h.controller.onRetry();
    const retries = h.calls.filter((c) => c.cmd === "retry_region_backdrop");
    expect(retries[0].args.overlaySessionId).toBe(null);
  });
});

describe("withDeadline is a hard aggregate budget, not timer-vs-microtask racing (C639-005)", () => {
  it("rejects a stage whose promise resolves only after real time has already passed the deadline", async () => {
    // Reproduces the reviewer's exact counterexample: time advances past
    // the budget, then the stage's promise resolves anyway (e.g. a very
    // late reply) — all while withDeadline's OWN reject-timer has not
    // fired yet. Scheduling a timer and trusting whichever callback the
    // event loop happens to run first is not a hard deadline; the fix
    // re-checks the monotonic clock at the moment of fulfillment.
    const clock = fakeClock();
    let resolveCtx;
    const ctxPromise = new Promise((r) => (resolveCtx = r));
    const h = makeHarness({
      budgetMs: 5000,
      now: clock.now,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context") return ctxPromise;
        return Promise.resolve({});
      },
    });
    const p = h.controller.init();
    await Promise.resolve();
    clock.advance(6000); // past the 5,000 ms budget
    resolveCtx({ dpr: 2, backdrop_blank: false }); // late reply, not a hang
    await p;
    expect(h.controller._state().backdropReady).toBe(false);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
  });
});

describe("context readiness gates commit, not image readiness alone (C639-006)", () => {
  it("an overlay_context failure disables commit even when the backdrop image itself would succeed", async () => {
    const h = makeHarness({
      budgetMs: 2000,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context")
          return Promise.reject(new Error("ipc failed"));
        if (cmd === "region_pick_backdrop")
          return Promise.resolve({ png_b64: "AAA=" });
        return Promise.resolve({});
      },
    });
    const p = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    await p;
    expect(h.controller._state().backdropReady).toBe(false);
    expect(h.els.hint.textContent).toMatch(/Preview unavailable/);
    // The mapping prerequisite was never established: the backdrop step
    // must never even have been attempted.
    expect(h.calls.some((c) => c.cmd === "region_pick_backdrop")).toBe(
      false
    );
  });

  it("a late first init's context reply cannot clobber a newer init's dpr/blank-warning", async () => {
    let releaseFirstCtx;
    const firstCtxGate = new Promise((r) => (releaseFirstCtx = r));
    let ctxCalls = 0;
    const h = makeHarness({
      budgetMs: 5000,
      invokeImpl: (cmd) => {
        if (cmd === "overlay_context") {
          ctxCalls++;
          if (ctxCalls === 1) {
            return firstCtxGate.then(() => ({
              dpr: 9,
              backdrop_blank: true,
            }));
          }
          return Promise.resolve({ dpr: 3, backdrop_blank: false });
        }
        if (cmd === "region_pick_backdrop")
          return Promise.resolve({ png_b64: "AAA=" });
        return Promise.resolve({});
      },
    });
    const p1 = h.controller.init();
    for (let i = 0; i < 20 && ctxCalls === 0; i++) await Promise.resolve();
    expect(ctxCalls).toBe(1);
    const p2 = h.controller.init();
    h.els.backdrop.complete = true;
    h.els.backdrop.naturalWidth = 1920;
    if (h.els.backdrop._onload) h.els.backdrop._onload();
    await p2;
    expect(h.controller._state().dpr).toBe(3);
    expect(h.els.blankwarn.style.display).not.toBe("block");
    // Release the first (stale) init's context reply late: its
    // generation is spent, so it must return before touching dpr/the
    // warning — the newer controller's state stands.
    releaseFirstCtx();
    await p1;
    expect(h.controller._state().dpr).toBe(3);
    expect(h.els.blankwarn.style.display).not.toBe("block");
  });
});
