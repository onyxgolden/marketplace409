// Tests for forge-capture-app/ui/process-guide-export.js —
// Capture PT-6 Slice E: deterministic, fixture-only guide-document
// export prototype.
//
// Implements the five discovery acceptance fixtures (E1–E5) plus the
// additional negative tests the brief requires, and the structural
// no-DOM/no-network/no-clock/no-persistence source scan.
//
// Note: TextEncoder is a deterministic platform codec (not DOM, clock,
// network, or storage) and is the only host API the pure serializer
// uses; the scan below pins that boundary.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportGuideDocument,
  GuideExportError,
  GUIDE_EXPORT_SCHEMA_VERSION,
  GUIDE_EXPORT_FORMATS,
  GUIDE_EXPORT_LAYOUT,
  GUIDE_EXPORT_WATERMARK,
} from "../process-guide-export.js";
import { GUIDE_SCHEMA_VERSION } from "../process-guide-compiler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WATERMARK_LABEL = "DEMO / DRAFT / NOT VERIFIED";
const PLACEHOLDER_TEXT = "No image exported — fixture guide placeholder.";

function expectExportError(fn, code) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuideExportError);
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected GuideExportError(${code}) but nothing was thrown`);
}

function makeStep(index, overrides = {}) {
  return {
    stepIndex: index,
    sequenceId: 100 + index,
    action: "Click observed",
    targetLabel: `btn-${index}`,
    point: [10, 20],
    processName: "fixture.exe",
    trust: "Default",
    decision: "ProceedNormally",
    withheld: false,
    redacted: false,
    hasScreenshot: false,
    evidenceRef: { sequenceId: 100 + index },
    ...overrides,
  };
}

function makeGuide({ steps = 5, warnings = [], stepOverrides = {} } = {}) {
  return {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    source: "fixture",
    status: "draft_unverified",
    target: { label: "Notepad", exeName: "notepad.exe" },
    trustScope: "default",
    steps: Array.from({ length: steps }, (_, i) => makeStep(i, stepOverrides[i] || {})),
    warnings,
    completeness: {
      totalEvents: steps,
      withheldCount: 0,
      redactedCount: 0,
      proceedCount: steps,
      gapCount: 0,
      lossByStage: {},
      reconciliationUncertain: false,
      lastProcessedSeq: null,
      isComplete: true,
    },
  };
}

function gapWarning() {
  return { type: "gap", firstMissing: 3, lastMissing: 4, stepIndexHint: null };
}

function lossWarning() {
  return { type: "loss", stage: "hook", droppedCount: 2 };
}

function exportArgs(guide, overrides = {}) {
  return {
    guide,
    guideId: "fixture-guide-100-5",
    format: "html",
    layout: { paper: "letter", orientation: "portrait" },
    watermark: true,
    ...overrides,
  };
}

function decodeHtml(artifact) {
  expect(artifact.bytes).toBeInstanceOf(Uint8Array);
  return new TextDecoder().decode(artifact.bytes);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe("E1 — happy-path document", () => {
  it("builds one cover + one page per step + one page per warning, each watermarked and numbered", () => {
    const guide = makeGuide({ steps: 5, warnings: [gapWarning(), lossWarning()] });
    const artifact = exportGuideDocument(exportArgs(guide));

    // 1 cover + 5 steps + 2 warnings = 8 explicit pages.
    expect(artifact.pageCount).toBe(8);

    const html = decodeHtml(artifact);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // Each explicit page carries exactly one visible watermark.
    expect(countOccurrences(html, WATERMARK_LABEL)).toBe(8);
    expect(countOccurrences(html, '<div class="pt-export-watermark"')).toBe(8);
    // Correct page numbers, each exactly once.
    for (let n = 1; n <= 8; n++) {
      expect(countOccurrences(html, `Page ${n} of 8`)).toBe(1);
    }
    // One <section> per explicit page — no auto-pagination.
    expect(countOccurrences(html, '<section class="pt-export-page"')).toBe(8);
  });

  it("preserves step order and allowed source text, HTML-escaped", () => {
    const guide = makeGuide({
      steps: 3,
      stepOverrides: {
        0: { action: 'Click <script>alert("x")</script> observed', targetLabel: "btn-&-save" },
      },
    });
    const html = decodeHtml(exportGuideDocument(exportArgs(guide)));

    // Source order preserved in document order.
    const i1 = html.indexOf("Step 1 of 3");
    const i2 = html.indexOf("Step 2 of 3");
    const i3 = html.indexOf("Step 3 of 3");
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    // Hostile markup is escaped, never creates elements.
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("btn-&amp;-save");
    // Unknown input fields are never serialized.
    expect(html).not.toContain("point");
  });

  it("returns the exact manifest, MIME, extension, filename, and UTF-8 bytes", () => {
    const guide = makeGuide({ steps: 5, warnings: [gapWarning()] });
    const artifact = exportGuideDocument(exportArgs(guide, { guideId: "fixture-guide-100-5" }));

    expect(artifact.mime).toBe("text/html;charset=utf-8");
    expect(artifact.extension).toBe("html");
    expect(artifact.filename).toBe("fixture-guide-100-5.html");
    expect(artifact.pageCount).toBe(7);
    expect(artifact.manifest).toEqual({
      schemaVersion: GUIDE_EXPORT_SCHEMA_VERSION,
      guideId: "fixture-guide-100-5",
      source: "fixture",
      status: "draft_unverified",
      format: "html",
      layout: { paper: "letter", orientation: "portrait" },
      watermark: { required: true, label: WATERMARK_LABEL, pageCount: 7 },
      stepCount: 5,
      warningCount: 1,
    });
    // UTF-8 bytes: Unicode source labels survive byte-for-byte.
    const uni = makeGuide({
      steps: 1,
      stepOverrides: { 0: { targetLabel: "Bouton—café ☕ E-101" } },
    });
    const uniHtml = decodeHtml(exportGuideDocument(exportArgs(uni, { guideId: "g1" })));
    expect(uniHtml).toContain("Bouton—café ☕ E-101");
  });

  it("is byte-identical and manifest-equal across two runs and never mutates input", () => {
    const guide = makeGuide({ steps: 5, warnings: [gapWarning(), lossWarning()] });
    const before = JSON.parse(JSON.stringify(guide));
    const a = exportGuideDocument(exportArgs(guide));
    const b = exportGuideDocument(exportArgs(guide));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.manifest).toEqual(b.manifest);
    expect(guide).toEqual(before);
  });

  it("visibly retains draft_unverified and never claims verified/approved/successful/completed/live status", () => {
    const html = decodeHtml(exportGuideDocument(exportArgs(makeGuide({ steps: 2 }))));
    expect(html).toContain("draft_unverified");
    const lower = html.toLowerCase();
    for (const phrase of ["is verified", "has been verified", "approved", "successful", "completed", "live status"]) {
      expect(lower).not.toContain(phrase);
    }
  });

  it("never consumes Slice W wording/wordingPass fields", () => {
    const guide = makeGuide({ steps: 2 });
    guide.steps[0].wording = "Normalized wording that must not appear.";
    guide.steps[0].wordingPass = { schemaVersion: 99 };
    const html = decodeHtml(exportGuideDocument(exportArgs(guide)));
    expect(html).not.toContain("Normalized wording that must not appear.");
  });
});

describe("E2 — malformed input fails closed", () => {
  it("rejects a missing schemaVersion", () => {
    const guide = makeGuide();
    delete guide.schemaVersion;
    const before = JSON.parse(JSON.stringify(guide));
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "unsupported-schema");
    expect(guide).toEqual(before);
  });

  it("rejects duplicate stepIndex values", () => {
    const guide = makeGuide({ steps: 3 });
    guide.steps[2].stepIndex = 1;
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "invalid-step");
  });

  it("rejects out-of-order stepIndex values", () => {
    const guide = makeGuide({ steps: 3 });
    guide.steps.reverse();
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "invalid-step");
  });

  it("rejects negative or non-integer stepIndex values", () => {
    for (const bad of [-1, 1.5, "0", null]) {
      const guide = makeGuide({ steps: 2 });
      guide.steps[1].stepIndex = bad;
      expectExportError(() => exportGuideDocument(exportArgs(guide)), "invalid-step");
    }
  });

  it("rejects malformed warnings", () => {
    const cases = [
      [[{ type: "mystery", detail: "x" }], "unknown-warning-kind"],
      [[{ type: "gap", firstMissing: 5, lastMissing: 2, stepIndexHint: null }], "invalid-warning"],
      [[{ type: "gap", firstMissing: "3", lastMissing: 4, stepIndexHint: null }], "invalid-warning"],
      [[{ type: "loss", stage: "hook" }], "invalid-warning"],
      [[{ type: "loss", stage: "hook", droppedCount: -1 }], "invalid-warning"],
      [[{ type: "uncertain", lastProcessedSeq: "none" }], "invalid-warning"],
      [["not-an-object"], "invalid-warning"],
    ];
    for (const [warnings, code] of cases) {
      const guide = makeGuide({ warnings });
      expectExportError(() => exportGuideDocument(exportArgs(guide)), code);
    }
  });

  it("rejects an invalid completeness object", () => {
    for (const completeness of [null, { isComplete: "yes" }, { isComplete: true, totalEvents: -1 }]) {
      const guide = makeGuide();
      guide.completeness = completeness;
      expectExportError(() => exportGuideDocument(exportArgs(guide)), "invalid-completeness");
    }
  });

  it("rejects a non-object guide and a non-array steps", () => {
    expectExportError(() => exportGuideDocument(exportArgs(null)), "invalid-guide");
    const guide = makeGuide();
    guide.steps = "nope";
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "invalid-guide");
  });
});

describe("E3 — non-fixture refusal", () => {
  it.each([["live"], ["production"]])(
    "refuses source %s before serialization with a bounded safe attempt record",
    (source) => {
      const guide = makeGuide();
      guide.source = source;
      const before = JSON.parse(JSON.stringify(guide));
      const e = expectExportError(() => exportGuideDocument(exportArgs(guide)), "non-fixture-source");
      // Exactly the safe fields — never guide contents.
      expect(e.attemptRecord).toEqual({
        code: "non-fixture-source",
        source,
        format: "html",
        guideId: "fixture-guide-100-5",
      });
      expect(JSON.stringify(e.attemptRecord)).not.toContain("btn-");
      expect(guide).toEqual(before);
    }
  );

  it("refuses an unknown guide status instead of omitting it", () => {
    const guide = makeGuide();
    guide.status = "verified";
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "unsupported-status");
  });
});

describe("E4 — watermark suppression fails closed", () => {
  it.each([[false], [undefined], [{ label: "custom" }], ["yes"]])(
    "hard-fails for watermark=%s before any bytes",
    (watermark) => {
      const guide = makeGuide();
      expectExportError(() => exportGuideDocument(exportArgs(guide, { watermark })), "watermark-required");
    }
  );

  it("constructs every page through the single page renderer (structural invariant)", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-export.js"), "utf8");
    // Exactly one page-construction site in the module.
    expect(countOccurrences(source, '<section class="pt-export-page"')).toBe(1);
    // Every explicit page type flows through it.
    expect(source).toContain("renderCoverPage");
    expect(source).toContain("renderStepPage");
    expect(source).toContain("renderWarningPage");
  });
});

describe("E5 — withheld screenshot becomes a placeholder, never pixels", () => {
  const SENTINEL_BYTES = "SENTINEL-PIXEL-BYTES-9f3a";
  const SENTINEL_DATA_URL = "data:image/png;base64,iVBORw0KGgoSENTINEL";
  const SENTINEL_URL = "https://evidence.example.invalid/shot-9f3a.png";

  function hostileGuide() {
    const guide = makeGuide({
      steps: 2,
      stepOverrides: {
        0: {
          withheld: true,
          decision: "Withhold",
          targetLabel: "(withheld — sensitive content)",
          hasScreenshot: true,
          pixels: SENTINEL_BYTES,
          screenshotDataUrl: SENTINEL_DATA_URL,
          screenshotUrl: SENTINEL_URL,
        },
      },
    });
    return guide;
  }

  it("renders the neutral placeholder and serializes no image field, pixel, or reference", () => {
    const html = decodeHtml(exportGuideDocument(exportArgs(hostileGuide())));
    expect(html).toContain(PLACEHOLDER_TEXT);
    expect(html).not.toContain(SENTINEL_BYTES);
    expect(html).not.toContain(SENTINEL_DATA_URL);
    expect(html).not.toContain(SENTINEL_URL);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("carries no image reference in the manifest", () => {
    const artifact = exportGuideDocument(exportArgs(hostileGuide()));
    const manifestJson = JSON.stringify(artifact.manifest);
    expect(manifestJson).not.toContain(SENTINEL_BYTES);
    expect(manifestJson).not.toContain(SENTINEL_DATA_URL);
    expect(manifestJson).not.toContain(SENTINEL_URL);
    expect(manifestJson).not.toContain("screenshot");
    expect(manifestJson).not.toContain("pixel");
  });
});

describe("targeted negatives — envelope options", () => {
  it("rejects unsupported formats", () => {
    const guide = makeGuide();
    for (const format of ["pdf", "docx", "markdown", "", null, undefined]) {
      expectExportError(() => exportGuideDocument(exportArgs(guide, { format })), "unsupported-format");
    }
  });

  it("rejects non-letter/non-portrait layouts and any extra layout option", () => {
    const guide = makeGuide();
    const badLayouts = [
      { paper: "a4", orientation: "portrait" },
      { paper: "letter", orientation: "landscape" },
      { paper: "letter", orientation: "portrait", margin: "1in" },
      { paper: "letter", orientation: "portrait", theme: "dark" },
      { paper: "letter", orientation: "portrait", watermark: false },
      { paper: "letter" },
      null,
      "letter",
    ];
    for (const layout of badLayouts) {
      expectExportError(() => exportGuideDocument(exportArgs(guide, { layout })), "unsupported-layout");
    }
  });

  it("rejects unsafe guide ids", () => {
    const guide = makeGuide();
    for (const guideId of ["../evil", "a/b", "a b", "", "a".repeat(81), null, 42, "semi;colon"]) {
      expectExportError(() => exportGuideDocument(exportArgs(guide, { guideId })), "invalid-guide-id");
    }
  });

  it("accepts boundary-valid guide ids", () => {
    const guide = makeGuide({ steps: 1 });
    for (const guideId of ["a", "A-._09", "x".repeat(80)]) {
      const artifact = exportGuideDocument(exportArgs(guide, { guideId }));
      expect(artifact.filename).toBe(`${guideId}.html`);
      expect(artifact.manifest.guideId).toBe(guideId);
    }
  });
});

describe("targeted negatives — bounds and escaping", () => {
  it("rejects overlong values instead of truncating source truth", () => {
    const guide = makeGuide({ steps: 1 });
    guide.steps[0].action = "x".repeat(501);
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "overlong-field");
  });

  it("rejects oversized guides instead of truncating pages", () => {
    const guide = makeGuide({ steps: 501 });
    expectExportError(() => exportGuideDocument(exportArgs(guide)), "oversized-guide");
    const manyWarnings = makeGuide({ steps: 1, warnings: Array.from({ length: 101 }, lossWarning) });
    expectExportError(() => exportGuideDocument(exportArgs(manyWarnings)), "oversized-guide");
  });

  it("escapes hostile HTML in every rendered source field", () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const guide = makeGuide({
      steps: 1,
      warnings: [{ type: "loss", stage: hostile, droppedCount: 1 }],
      stepOverrides: {
        0: { action: hostile, targetLabel: hostile, processName: hostile, decision: hostile },
      },
    });
    const html = decodeHtml(exportGuideDocument(exportArgs(guide)));
    // No hostile markup becomes an element or attribute: the raw tags
    // never appear; the escaped text does (attribute-looking substrings
    // like "onerror=" inside escaped text are inert text, not handlers).
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("exports the public API surface the brief requires", () => {
    expect(typeof exportGuideDocument).toBe("function");
    expect(typeof GuideExportError).toBe("function");
    expect(GUIDE_EXPORT_SCHEMA_VERSION).toBe(1);
    expect(GUIDE_EXPORT_FORMATS.html.mime).toBe("text/html;charset=utf-8");
    expect(GUIDE_EXPORT_FORMATS.html.extension).toBe("html");
    expect(GUIDE_EXPORT_LAYOUT).toEqual({ paper: "letter", orientation: "portrait" });
    expect(GUIDE_EXPORT_WATERMARK.required).toBe(true);
    expect(GUIDE_EXPORT_WATERMARK.label).toBe(WATERMARK_LABEL);
  });
});

describe("structural isolation — process-guide-export.js", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-export.js"), "utf8");

  it("has no DOM, download, filesystem, storage, database, network, IPC, model, dynamic-code, or clock access", () => {
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    expect(source).not.toMatch(/\bdocument\s*\./);
    expect(source).not.toMatch(/\bwindow\s*\./);
    expect(source).not.toMatch(/\bBlob\s*\(/);
    expect(source).not.toMatch(/\bURL\s*\./);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/\binvoke\s*\(/);
    expect(source).not.toMatch(/writeFile|readFile|localStorage|sessionStorage|indexedDB/);
    expect(source).not.toMatch(/\beval\s*\(|new Function/);
    expect(source).not.toMatch(/Date\.now|new Date\(|performance\.now/);
    expect(source).not.toMatch(/from\s+["'](@tauri|fs|node:)/);
  });

  it("has no raster-editor, persistence, or model/provider import", () => {
    expect(source).not.toMatch(/exporter\.js|canvas-editor|drawOpsToCanvas/);
    expect(source).not.toMatch(/supabase|indexedDB|localStorage/);
    expect(source).not.toMatch(/\b(openai|anthropic|gemini|llm)\b/i);
  });
});
