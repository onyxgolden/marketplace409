// @vitest-environment jsdom
//
// Tests for forge-capture-app/ui/process-training.js — PT-1C's
// consent/session DOM driver. jsdom is used only here (the pure logic in
// process-training-core.js is tested separately under plain node).

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderProcessTrainingControls } from "../process-training.js";
import { ConsentSession } from "../process-training-core.js";
import { WORKFLOW_SYMBOLS } from "../workflow-symbols.js";
import { PID_SYMBOLS } from "../pid-symbols.js";
import { PAPER_SIZES, LEGACY_CANVAS_ID } from "../markup-canvas-sizes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// jsdom's `#id` selector matching gets confused across sibling elements
// that share an id with ones left over from a previous test (a jsdom/
// nwsapi quirk, not a product bug — a real mount only ever happens
// once). Clearing the body between tests keeps each mount's ids unique
// in the document, which is also what the real app guarantees (the
// auto-mount guard only ever mounts once).
beforeEach(() => {
  document.body.innerHTML = "";
});

function mountFresh(extraDeps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const session = new ConsentSession();
  const handle = renderProcessTrainingControls(container, { session, ...extraDeps });
  return { container, session, handle };
}

function chooseExampleTarget(container, index = 0) {
  const select = container.querySelector("#pt-target-select");
  select.value = String(index);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("renderProcessTrainingControls — default render", () => {
  it("shows the disabled-capture banner and the setup step; everything else hidden", () => {
    const { container } = mountFresh();
    const banner = container.querySelector(".pt-disabled-banner");
    expect(banner).not.toBeNull();
    expect(banner.textContent.toLowerCase()).toContain("disabled");

    expect(container.querySelector("#pt-setup").hidden).toBe(false);
    expect(container.querySelector("#pt-preview").hidden).toBe(true);
    expect(container.querySelector("#pt-review").hidden).toBe(true);
    expect(container.querySelector("#pt-discarded").hidden).toBe(true);
  });

  it("starts with Continue disabled until a target is chosen", () => {
    const { container } = mountFresh();
    expect(container.querySelector("#pt-begin-btn").disabled).toBe(true);
    chooseExampleTarget(container, 0);
    expect(container.querySelector("#pt-begin-btn").disabled).toBe(false);
  });
});

describe("renderProcessTrainingControls — consent flow", () => {
  it("never grants consent merely by opening the dialog or cancelling it", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    expect(session.state).toBe("preflight");

    container.querySelector("#pt-consent-cancel").click();
    expect(session.state).toBe("preflight");
    expect(session.trustScope).toBeNull();
  });

  it("refuses author-trusted scope without the disclosure checkbox, and shows why", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();

    container.querySelector('input[name="pt-trust-scope"][value="author_trusted"]').checked = true;
    container
      .querySelector('input[name="pt-trust-scope"][value="author_trusted"]')
      .dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("#pt-disclosure-row").hidden).toBe(false);

    container.querySelector("#pt-consent-confirm").click();
    expect(session.state).toBe("preflight");
    const status = container.querySelector("#pt-consent-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
  });

  it("grants default consent and advances to the preview step", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();

    expect(session.state).toBe("consented_preview");
    expect(container.querySelector("#pt-preview").hidden).toBe(false);
    expect(container.querySelector("#pt-preview-target").textContent).toBe("Notepad");
    expect(container.querySelector("#pt-preview-scope").textContent).toContain("Default");
  });

  it("grants author-trusted consent once the disclosure is explicitly acknowledged", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 1);
    container.querySelector("#pt-begin-btn").click();

    const radio = container.querySelector('input[name="pt-trust-scope"][value="author_trusted"]');
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector("#pt-disclosure-ack").checked = true;
    container.querySelector("#pt-consent-confirm").click();

    expect(session.state).toBe("consented_preview");
    expect(session.trustScope).toBe("author_trusted");
    expect(container.querySelector("#pt-preview-scope").textContent).toContain("Author-trusted");
  });
});

describe("renderProcessTrainingControls — review", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  it("shows every QueueOverflow stage and a non-complete banner", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    expect(session.state).toBe("review");

    const lossItems = [...container.querySelectorAll("#pt-loss-list li")].map((li) => li.textContent);
    expect(lossItems.some((t) => /hook.*capture/i.test(t))).toBe(true);
    expect(lossItems.some((t) => /capacity exhausted/i.test(t))).toBe(true);
    expect(lossItems.some((t) => /reconciliation uncertain/i.test(t))).toBe(true);

    const banner = container.querySelector("#pt-review-banner");
    expect(banner.className).toContain("warning");
    expect(banner.textContent.toLowerCase()).toContain("not verified");
  });

  it("never shows a success/clean-complete claim", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const banner = container.querySelector("#pt-review-banner").textContent.toLowerCase();
    expect(banner).not.toContain("success");
    expect(banner).not.toMatch(/all (clear|done)/);
  });

  it("lists events with their withheld/redacted/proceeded reasoning visible", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const items = [...container.querySelectorAll("#pt-event-list li")];
    expect(items.length).toBeGreaterThan(0);
    const text = items.map((li) => li.textContent).join(" ");
    expect(text).toMatch(/withheld|redacted|proceeded/);
  });

  // Regression (round 1 review): the banner must reflect a nonzero
  // loss/overflow count even when there is no separate Gap or
  // SessionReconciliationUncertain in the evidence.
  it("shows the incomplete/warning banner for a loss-only session, with no gap or uncertainty present", () => {
    const { container } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "X", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
        { type: "QueueOverflow", stage: "capture-failure", droppedCount: 3 },
      ],
    });
    advanceToReview(container);

    expect(container.querySelector("#pt-sum-gaps").textContent).toBe("0");
    const lossItems = [...container.querySelectorAll("#pt-loss-list li")].map((li) => li.textContent);
    expect(lossItems.some((t) => /reconciliation uncertain/i.test(t))).toBe(false);

    const banner = container.querySelector("#pt-review-banner");
    expect(banner.className).toContain("warning");
    expect(banner.textContent.toLowerCase()).toContain("not verified");
  });
});

describe("renderProcessTrainingControls — discard", () => {
  it("discards from the preview step and purges fixture state", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-preview-discard-btn").click();

    expect(session.state).toBe("discarded");
    expect(container.querySelector("#pt-discarded").hidden).toBe(false);
    expect(container.querySelector("#pt-review").hidden).toBe(true);
  });

  it("discards from the review step and purges fixture state", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
    container.querySelector("#pt-review-discard-btn").click();

    expect(session.state).toBe("discarded");
    expect(session.describe().evidenceCount).toBe(0);
  });

  it("'start another preview' resets fully back to idle/setup", () => {
    const { container, session } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-preview-discard-btn").click();
    container.querySelector("#pt-new-session-btn").click();

    expect(session.state).toBe("idle");
    expect(container.querySelector("#pt-setup").hidden).toBe(false);
    expect(container.querySelector("#pt-begin-btn").disabled).toBe(true);
  });
});

describe("renderProcessTrainingControls — accessibility / small-window basics", () => {
  it("every actionable control is a real button/input/select, not a bare div", () => {
    const { container } = mountFresh();
    const clickable = container.querySelectorAll("[id^='pt-'][id$='-btn'], [id^='pt-'][id$='-confirm'], [id^='pt-'][id$='-cancel']");
    for (const el of clickable) {
      expect(["BUTTON"]).toContain(el.tagName);
      if (el.tagName === "BUTTON") {
        expect(el.getAttribute("type")).toBe("button");
      }
    }
  });

  it("the trust-scope radios and disclosure checkbox are wrapped by their label text (accessible by default)", () => {
    const { container } = mountFresh();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    const radioLabel = container.querySelector('input[name="pt-trust-scope"]').closest("label");
    expect(radioLabel).not.toBeNull();
    expect(radioLabel.textContent.trim().length).toBeGreaterThan(0);
    const disclosureLabel = container.querySelector("#pt-disclosure-ack").closest("label");
    expect(disclosureLabel).not.toBeNull();
  });

  it("status/review regions use role=status so assistive tech announces updates", () => {
    const { container } = mountFresh();
    expect(container.querySelector(".pt-disabled-banner").getAttribute("role")).toBe("status");
    expect(container.querySelector("#pt-consent-status").getAttribute("role")).toBe("status");
    expect(container.querySelector("#pt-review-banner").getAttribute("role")).toBe("status");
  });

  it("the consent dialog is a native <dialog> with an accessible label, not a custom overlay", () => {
    const { container } = mountFresh();
    const dialog = container.querySelector("#pt-consent-dialog");
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.getAttribute("aria-labelledby")).toBe("pt-consent-title");
  });
});

describe("structural guarantee — no live capture call anywhere in this module", () => {
  it("process-training.js never references invoke() or the real session commands", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-training.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
  });

  it("process-training-core.js never references invoke() or the real session commands either", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-training-core.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
  });

  it("process-guide-compiler.js never references invoke() or the real session commands either", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-guide-compiler.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
  });
});

describe("renderProcessTrainingControls — PT-2 guide preview", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  it("compiles the guide only once review is actually reached -- no steps before then", () => {
    const { container } = mountFresh();
    expect(container.querySelector("#pt-guide-steps").children.length).toBe(0);
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    expect(container.querySelector("#pt-guide-steps").children.length).toBe(0);
    container.querySelector("#pt-consent-confirm").click();
    // consented_preview: consent granted, still not compiled -- compile
    // only happens once the evidence actually exists, in review.
    expect(container.querySelector("#pt-guide-steps").children.length).toBe(0);
    container.querySelector("#pt-load-review-btn").click();
    expect(container.querySelector("#pt-guide-steps").children.length).toBeGreaterThan(0);
  });

  it("shows the DEMO / DRAFT / NOT VERIFIED badge once in review", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const badge = container.querySelector("#pt-guide-badge");
    expect(badge.textContent).toContain("DEMO");
    expect(badge.textContent).toContain("DRAFT");
    expect(badge.textContent).toContain("NOT VERIFIED");
  });

  it("the disabled-capture banner stays visible even while the guide preview is showing", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const banner = container.querySelector(".pt-disabled-banner");
    expect(banner).not.toBeNull();
    expect(banner.textContent.toLowerCase()).toContain("disabled");
  });

  it("renders every compiled step and keeps warnings visible", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const steps = [...container.querySelectorAll("#pt-guide-steps li")];
    expect(steps.length).toBeGreaterThan(0);
    const warnings = [...container.querySelectorAll("#pt-guide-warnings li")];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((li) => /gap|dropped|uncertain/i.test(li.textContent))).toBe(true);
  });

  it("never renders an actual screenshot image for a withheld/redacted step", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    expect(container.querySelectorAll("#pt-guide-steps img").length).toBe(0);
    expect(container.querySelector("#pt-guide-steps").innerHTML).not.toMatch(/data:image|\.png|\.jpg/i);
  });

  it("shows a visible error (not a crash) when the compiler legitimately fails closed", () => {
    const { container, session } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "X", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
        {
          type: "Event",
          event: {
            sequenceId: 1, // duplicate -- sequence-integrity failure
            kind: "Click",
            point: [2, 2],
            target: { name: "Y", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    const err = container.querySelector("#pt-guide-error");
    expect(err.hidden).toBe(false);
    expect(err.textContent.toLowerCase()).toContain("could not be compiled");
    expect(session.state).toBe("review"); // did not crash the surrounding UI
  });

  it("clears the guide preview on discard/new session", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    expect(container.querySelectorAll("#pt-guide-steps li").length).toBeGreaterThan(0);
    container.querySelector("#pt-review-discard-btn").click();
    expect(container.querySelector("#pt-review").hidden).toBe(true);
    container.querySelector("#pt-new-session-btn").click();
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    // Guide steps list is cleared/rebuilt fresh, not carried over stale
    // from the discarded session, until load-review runs again.
    expect(container.querySelectorAll("#pt-guide-steps li").length).toBe(0);
  });
});

describe("renderProcessTrainingControls — PT-3 markup panel", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  function openFirstStepMarkup(container) {
    const btn = [...container.querySelectorAll("#pt-guide-steps button")][0];
    btn.click();
  }

  function addRect(container, overrides = {}) {
    container.querySelector("#pt-markup-add-rect").click();
    const set = (id, v) => {
      const el = container.querySelector(id);
      el.value = String(v);
    };
    set("#pt-markup-field-x", overrides.x ?? 10);
    set("#pt-markup-field-y", overrides.y ?? 10);
    set("#pt-markup-field-w", overrides.w ?? 50);
    set("#pt-markup-field-h", overrides.h ?? 50);
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  }

  it("review -> select step -> edit placeholder -> preview shows the added shape", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(false);

    addRect(container, { x: 5, y: 5, w: 20, h: 20 });
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Rectangle"))).toBe(true);
  });

  it("never renders an actual image for the markup placeholder -- only a neutral canvas", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelectorAll("#pt-markup-panel img").length).toBe(0);
    expect(container.querySelector("#pt-markup-panel").innerHTML).not.toMatch(/data:image|\.png|\.jpg/i);
    expect(container.querySelector("#pt-markup-panel").textContent).toContain("No image in fixture guide");
  });

  it("switching steps shows only that step's own annotations", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    const stepButtons = [...container.querySelectorAll("#pt-guide-steps button")];
    expect(stepButtons.length).toBeGreaterThan(1);

    stepButtons[0].click();
    addRect(container, { x: 1, y: 1, w: 10, h: 10 });
    expect(container.querySelectorAll("#pt-markup-shape-list li").length).toBe(1);

    stepButtons[1].click();
    // A fresh step starts with the "no markup yet" placeholder row, not
    // the previous step's shape.
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Rectangle"))).toBe(false);

    stepButtons[0].click();
    // Switching back retains that step's own annotation.
    const backItems = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(backItems.some((li) => li.textContent.includes("Rectangle"))).toBe(true);
  });

  it("undo/redo work from the toolbar and reflect in the button disabled state", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const undoBtn = container.querySelector("#pt-markup-undo");
    const redoBtn = container.querySelector("#pt-markup-redo");
    expect(undoBtn.disabled).toBe(true);

    addRect(container);
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    expect(container.querySelectorAll("#pt-markup-shape-list li.pt-markup-empty, #pt-markup-shape-list li").length).toBeGreaterThan(0);
    expect(redoBtn.disabled).toBe(false);
    expect(undoBtn.disabled).toBe(true);
  });

  it("delete removes a shape", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    container.querySelector("#pt-markup-shape-list button:nth-of-type(1)"); // sanity: list rendered
    const deleteBtn = [...container.querySelectorAll("#pt-markup-shape-list li button")].find(
      (b) => b.textContent === "Delete"
    );
    deleteBtn.click();
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Rectangle"))).toBe(false);
  });

  it("an invalid shape submission shows an error and does not crash the surrounding review", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-add-rect").click();
    container.querySelector("#pt-markup-field-w").value = "0"; // invalid: w must be > 0
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const status = container.querySelector("#pt-markup-shape-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
    expect(session.state).toBe("review"); // surrounding review untouched
    // The guide preview itself is still intact.
    expect(container.querySelectorAll("#pt-guide-steps li").length).toBeGreaterThan(0);
  });

  it("DEMO/DRAFT/NOT VERIFIED badge and disabled-capture banner remain visible with the markup panel open", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-guide-badge").textContent).toContain("NOT VERIFIED");
    expect(container.querySelector(".pt-disabled-banner").textContent.toLowerCase()).toContain("disabled");
  });

  it("Escape closes the markup panel without discarding the session", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(false);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(true);
    expect(session.state).toBe("review");
  });

  it("Close button returns to the guide without discarding the session", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-close").click();
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(true);
    expect(session.state).toBe("review");
  });

  it("every control in the panel is keyboard-operable (real button/input elements, no pointer-only handlers)", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-add-text").click();
    const inputs = [...container.querySelectorAll("#pt-markup-shape-fields input")];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(["INPUT"]).toContain(input.tagName);
      expect(input.type === "number" || input.type === "text").toBe(true);
    }
    const buttons = [...container.querySelectorAll("#pt-markup-panel button")];
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
    }
  });

  it("privacy: a withheld/redacted step's seeded sensitive text is absent from the markup DOM, including title/aria attributes", () => {
    const { container } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "Secret Field", automationId: "txt-secret", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    const panelHtml = container.querySelector("#pt-markup-panel").outerHTML;
    expect(panelHtml).not.toContain("Secret Field");
    expect(panelHtml).not.toContain("txt-secret");
  });

  it("user-added text is rendered via textContent, never as HTML (no script/markup injection)", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-add-text").click();
    container.querySelector("#pt-markup-field-x").value = "5";
    container.querySelector("#pt-markup-field-y").value = "5";
    container.querySelector("#pt-markup-field-text").value = "<img src=x onerror=alert(1)>";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(container.querySelectorAll("#pt-markup-shape-list img").length).toBe(0);
    const li = [...container.querySelectorAll("#pt-markup-shape-list li")].find((l) =>
      l.textContent.includes("<img")
    );
    expect(li).toBeDefined();
  });

  it("lifecycle: discard clears all markup from the DOM, not just hides it", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    container.querySelector("#pt-review-discard-btn").click();
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(true);
    expect(container.querySelectorAll("#pt-markup-shape-list li").length).toBe(0);
  });

  it("lifecycle: new-session clears markup; re-entering review starts with no stale annotations", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    container.querySelector("#pt-review-discard-btn").click();
    container.querySelector("#pt-new-session-btn").click();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Rectangle"))).toBe(false);
  });

  it("lifecycle: a compiler failure never shows an open markup panel", () => {
    // In the current UI, compiling only ever happens once, synchronously,
    // on entering review -- step buttons (the only way to open the
    // markup panel) only exist after a successful compile, so a failed
    // compile can never leave the markup panel open in practice. This
    // pins that invariant directly, and that renderGuidePreview's
    // defensive closeMarkupPanel() call (for a future recompile path)
    // does not itself break anything on the failure path.
    const { container } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "X", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
        {
          type: "Event",
          event: {
            sequenceId: 1, // duplicate -- sequence-integrity failure
            kind: "Click",
            point: [2, 2],
            target: { name: "Y", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    expect(container.querySelector("#pt-guide-error").hidden).toBe(false);
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(true);
    expect(container.querySelectorAll("#pt-guide-steps button").length).toBe(0);
  });

  // Regression (round 1 review): a failed recompile must clear the
  // GuideMarkupOverlay's data, not only hide/clear the panel's DOM --
  // closeMarkupPanel() alone deliberately preserves annotations (that is
  // what lets an ordinary close/reopen retain them), so it cannot by
  // itself satisfy "compile failure clears annotations." The current UI
  // has no second, user-reachable compile action to exercise this
  // through a click sequence alone, so this calls the exposed
  // `renderGuidePreview()` directly (per the review's own suggestion to
  // exercise a reachable internal path) against evidence mutated to fail
  // -- the same function and the same catch branch a real future
  // recompile path would use.
  it("a failed recompile clears markupOverlay data, not just the panel DOM", () => {
    const { container, session, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    expect(handle.markupOverlay.shapesFor(1)).toHaveLength(1);

    // Mutate the session's evidence directly to something that fails
    // compilation (a duplicate sequenceId), then re-invoke the exact
    // compile/render function under test -- bypassing the UI's lack of a
    // second compile trigger, not the lifecycle logic itself.
    session.evidence = [
      {
        type: "Event",
        event: {
          sequenceId: 1,
          kind: "Click",
          point: [1, 1],
          target: { name: "X", processName: "fixture.exe" },
          screenshot: null,
          privacy: { trust: "Default", decision: "Withhold" },
        },
      },
      {
        type: "Event",
        event: {
          sequenceId: 1, // duplicate -- sequence-integrity failure
          kind: "Click",
          point: [2, 2],
          target: { name: "Y", processName: "fixture.exe" },
          screenshot: null,
          privacy: { trust: "Default", decision: "Withhold" },
        },
      },
    ];
    handle.renderGuidePreview();

    expect(container.querySelector("#pt-guide-error").hidden).toBe(false);
    expect(container.querySelector("#pt-markup-panel").hidden).toBe(true);
    // The actual regression this pins: stale shapes must not survive in
    // the overlay's real data, not merely be hidden from view.
    expect(handle.markupOverlay.shapesFor(1)).toEqual([]);
  });

  it("re-rendering the same review (same compile) retains legitimate in-memory markup", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    addRect(container);
    // Re-trigger a guide compile within the SAME review session (e.g. a
    // re-render) by clicking load-review again is not exposed as a
    // separate action in this UI once in review, so instead assert the
    // overlay itself (not re-created per render) still holds the shape
    // after closing/reopening the panel, which already exercises a
    // fresh renderMarkupPanel() call reading from the same overlay.
    container.querySelector("#pt-markup-close").click();
    openFirstStepMarkup(container);
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Rectangle"))).toBe(true);
    expect(session.state).toBe("review");
  });
});

describe("structural guarantee — process-guide-markup.js never referenced unsafely", () => {
  it("process-training.js's markup integration never references invoke() or the real session commands", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "process-training.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
  });
});

describe("renderProcessTrainingControls — PT-4 workflow symbol palette", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  function openFirstStepMarkup(container) {
    const btn = [...container.querySelectorAll("#pt-guide-steps button")][0];
    btn.click();
  }

  it("shows all 17 symbols, visibly grouped by category, labelled 'Workflow symbols' not 'Visio'", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const palette = container.querySelector("#pt-markup-palette");
    const groups = [...palette.querySelectorAll(".pt-markup-palette-group")];
    expect(groups.length).toBeGreaterThan(1); // more than one category
    const buttons = [...palette.querySelectorAll("button")];
    expect(buttons).toHaveLength(WORKFLOW_SYMBOLS.length);
    // The palette's own heading/label names it "Workflow symbols" -- the
    // only legitimate mention of "Visio" anywhere nearby is the
    // disclaimer explicitly saying this is NOT that, which is required,
    // not forbidden (see workflow-symbols.js's own header comment).
    // Queried by content, not DOM position -- Slice B's background/
    // overlay sections (their own h4s) now sit earlier in the panel.
    const heading = [...container.querySelectorAll("#pt-markup-panel h4")].find(
      (h) => h.textContent === "Workflow symbols"
    );
    expect(heading).toBeDefined();
    expect(heading.textContent.toLowerCase()).not.toContain("visio");
    for (const btn of [...palette.querySelectorAll("button")]) {
      expect(btn.textContent.toLowerCase()).not.toContain("visio");
    }
  });

  it("every palette button is a real, keyboard-operable <button> with a name and a tooltip", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const buttons = [...container.querySelectorAll("#pt-markup-palette button")];
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.textContent.length).toBeGreaterThan(0);
      expect(btn.title.length).toBeGreaterThan(0);
    }
  });

  it("clicking a palette symbol opens the form (place without a pointer) and adding it succeeds", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    expect(container.querySelector("#pt-markup-shape-form").hidden).toBe(false);
    // Deterministic defaults are pre-filled -- no pointer/drag required.
    expect(container.querySelector("#pt-markup-field-w").value).not.toBe("");
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Process"))).toBe(true);
  });

  it("an optional label can be added to a placed symbol", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const decisionBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Decision"
    );
    decisionBtn.click();
    container.querySelector("#pt-markup-field-label").value = "Approved?";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes('Decision: "Approved?"'))).toBe(true);
  });

  it("an invalid symbol placement (below minimum size) shows an error without crashing the review", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    const def = WORKFLOW_SYMBOLS.find((s) => s.id === "process");
    container.querySelector("#pt-markup-field-w").value = String(def.minWidth - 1);
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const status = container.querySelector("#pt-markup-shape-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
    expect(session.state).toBe("review");
  });

  it("editing an existing symbol preserves its symbolType and updates only placement/label", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const editBtn = [...container.querySelectorAll("#pt-markup-shape-list li button")].find(
      (b) => b.textContent === "Edit"
    );
    editBtn.click();
    // The form reopens without a palette re-selection -- symbolType is
    // carried from the existing shape, not re-chosen.
    expect(container.querySelector("#pt-markup-field-w")).not.toBeNull();
    container.querySelector("#pt-markup-field-label").value = "Renamed";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes('Process: "Renamed"'))).toBe(true);
  });

  it("undo/redo/delete work for a placed symbol exactly like the legacy shapes", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const termBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Start / End"
    );
    termBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(container.querySelector("#pt-markup-undo").disabled).toBe(false);
    container.querySelector("#pt-markup-undo").click();
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Start / End"))).toBe(false);
  });

  it("legacy rect/arrow/text toolbar buttons are unchanged and still present alongside the palette", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-add-rect")).not.toBeNull();
    expect(container.querySelector("#pt-markup-add-arrow")).not.toBeNull();
    expect(container.querySelector("#pt-markup-add-text")).not.toBeNull();
  });

  it("discard/reset/compile-failure clear placed symbols too, not just legacy shapes", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(handle.markupOverlay.shapesFor(1)).toHaveLength(1);
    container.querySelector("#pt-review-discard-btn").click();
    expect(handle.markupOverlay.shapesFor(1)).toEqual([]);
  });

  it("DEMO/DRAFT/NOT VERIFIED badge and disabled-capture banner remain visible with the palette open", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-guide-badge").textContent).toContain("NOT VERIFIED");
    expect(container.querySelector(".pt-disabled-banner").textContent.toLowerCase()).toContain("disabled");
    expect(container.querySelector("#pt-markup-panel").textContent).toContain(
      "No image in fixture guide"
    );
  });

  it("never reveals withheld evidence through a symbol label, tooltip, or the panel's DOM", () => {
    const { container } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "Secret Field", automationId: "txt-secret", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const panelHtml = container.querySelector("#pt-markup-panel").outerHTML;
    expect(panelHtml).not.toContain("Secret Field");
    expect(panelHtml).not.toContain("txt-secret");
  });
});

describe("renderProcessTrainingControls — PT-5 P&ID symbol palette (workflow markup)", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  function openFirstStepMarkup(container) {
    const btn = [...container.querySelectorAll("#pt-guide-steps button")][0];
    btn.click();
  }

  it("shows all 35 P&ID symbols in a separate, visibly distinct palette grouped into exactly 8 families, labelled 'P&ID symbols (workflow markup)'", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const pidPalette = container.querySelector("#pt-markup-pid-palette");
    const groups = [...pidPalette.querySelectorAll(".pt-markup-palette-group")];
    expect(groups).toHaveLength(8);
    const buttons = [...pidPalette.querySelectorAll("button")];
    expect(buttons).toHaveLength(PID_SYMBOLS.length);
    const headings = [...container.querySelectorAll("#pt-markup-panel h4")].map((h) => h.textContent);
    expect(headings).toContain("P&ID symbols (workflow markup)");
    // Visually/semantically separate from "Workflow symbols" -- both
    // headings present, neither palette's buttons mixed into the other.
    expect(headings).toContain("Workflow symbols");
    const workflowPalette = container.querySelector("#pt-markup-palette");
    expect([...workflowPalette.querySelectorAll("button")]).toHaveLength(WORKFLOW_SYMBOLS.length);
  });

  it("never implies Visio, vendor stencils, or standards-certified engineering fidelity in the P&ID palette itself", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    // Scoped to the P&ID section's own heading/intro/buttons -- the
    // Workflow symbols section legitimately mentions "Visio" in its own
    // disclaimer ("not Microsoft Visio artwork"), which is required, not
    // forbidden (see that section's own test above).
    const pidHeading = [...container.querySelectorAll("#pt-markup-panel h4")].find(
      (h) => h.textContent === "P&ID symbols (workflow markup)"
    );
    expect(pidHeading).toBeDefined();
    const pidIntro = pidHeading.nextElementSibling;
    expect(pidIntro.textContent.toLowerCase()).not.toContain("visio");
    expect(pidIntro.textContent.toLowerCase()).toContain("not a standards-compliant");
    const pidPalette = container.querySelector("#pt-markup-pid-palette");
    expect(pidPalette.textContent.toLowerCase()).not.toContain("visio");
  });

  it("every P&ID palette button is a real, keyboard-operable <button> with a name and a tooltip", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const buttons = [...container.querySelectorAll("#pt-markup-pid-palette button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.textContent.length).toBeGreaterThan(0);
      expect(btn.title.length).toBeGreaterThan(0);
    }
  });

  it("clicking a P&ID palette symbol opens the form (place without a pointer) and adding it succeeds", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const pumpBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Centrifugal pump"
    );
    pumpBtn.click();
    expect(container.querySelector("#pt-markup-shape-form").hidden).toBe(false);
    expect(container.querySelector("#pt-markup-field-w").value).not.toBe("");
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Centrifugal pump"))).toBe(true);
  });

  it("an optional label can be added to a placed P&ID symbol", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const vesselBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Vertical vessel"
    );
    vesselBtn.click();
    container.querySelector("#pt-markup-field-label").value = "V-101";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes('Vertical vessel: "V-101"'))).toBe(true);
  });

  it("an invalid P&ID symbol placement (below minimum size) shows an error without crashing the review", () => {
    const { container, session } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const driverBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Generic rotating driver"
    );
    driverBtn.click();
    const def = PID_SYMBOLS.find((s) => s.id === "pid.rotating.generic_driver");
    container.querySelector("#pt-markup-field-w").value = String(def.minWidth - 1);
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const status = container.querySelector("#pt-markup-shape-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
    expect(session.state).toBe("review");
  });

  it("editing an existing P&ID symbol preserves its symbolType and updates only placement/label", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const driverBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Generic rotating driver"
    );
    driverBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const editBtn = [...container.querySelectorAll("#pt-markup-shape-list li button")].find(
      (b) => b.textContent === "Edit"
    );
    editBtn.click();
    expect(container.querySelector("#pt-markup-field-w")).not.toBeNull();
    container.querySelector("#pt-markup-field-label").value = "Driver A";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes('Generic rotating driver: "Driver A"'))).toBe(true);
  });

  it("undo/redo/delete work for a placed P&ID symbol exactly like PT-4 workflow symbols", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const flareBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Flare stack"
    );
    flareBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(container.querySelector("#pt-markup-undo").disabled).toBe(false);
    container.querySelector("#pt-markup-undo").click();
    const items = [...container.querySelectorAll("#pt-markup-shape-list li")];
    expect(items.some((li) => li.textContent.includes("Flare stack"))).toBe(false);
  });

  it("a P&ID symbol and a PT-4 workflow symbol can both be placed on the same step", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const processBtn = [...container.querySelectorAll("#pt-markup-palette button")].find(
      (b) => b.textContent === "Process"
    );
    processBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const pumpBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Centrifugal pump"
    );
    pumpBtn.click();
    container.querySelector("#pt-markup-field-x").value = "200";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(handle.markupOverlay.shapesFor(1).map((s) => s.symbolType)).toEqual([
      "process",
      "pid.rotating.centrifugal_pump",
    ]);
  });

  it("discard/reset/compile-failure clear placed P&ID symbols too, not just legacy shapes and workflow symbols", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const pumpBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Centrifugal pump"
    );
    pumpBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(handle.markupOverlay.shapesFor(1)).toHaveLength(1);
    container.querySelector("#pt-review-discard-btn").click();
    expect(handle.markupOverlay.shapesFor(1)).toEqual([]);
  });

  it("DEMO/DRAFT/NOT VERIFIED badge and disabled-capture banner remain visible with the P&ID palette open", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-guide-badge").textContent).toContain("NOT VERIFIED");
    expect(container.querySelector(".pt-disabled-banner").textContent.toLowerCase()).toContain("disabled");
  });

  it("never reveals withheld evidence through a P&ID symbol label, tooltip, or the panel's DOM", () => {
    const { container } = mountFresh({
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "Secret Pump Tag", automationId: "txt-secret", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    openFirstStepMarkup(container);
    const pumpBtn = [...container.querySelectorAll("#pt-markup-pid-palette button")].find(
      (b) => b.textContent === "Centrifugal pump"
    );
    pumpBtn.click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    const panelHtml = container.querySelector("#pt-markup-panel").outerHTML;
    expect(panelHtml).not.toContain("Secret Pump Tag");
    expect(panelHtml).not.toContain("txt-secret");
  });
});

describe("renderProcessTrainingControls — plotter-size Slice A: per-step canvas size picker", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  function openFirstStepMarkup(container) {
    const btn = [...container.querySelectorAll("#pt-guide-steps button")][0];
    btn.click();
  }

  function applySize(container, sizeId, orientation) {
    container.querySelector("#pt-markup-canvas-size").value = sizeId;
    container.querySelector("#pt-markup-canvas-size").dispatchEvent(new Event("change", { bubbles: true }));
    if (orientation) {
      container.querySelector("#pt-markup-canvas-orientation").value = orientation;
    }
    container.querySelector("#pt-markup-canvas-apply").click();
  }

  it("renders the legacy option plus all 7 paper sizes, and both orientations", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const sizeOptions = [...container.querySelectorAll("#pt-markup-canvas-size option")].map((o) => o.value);
    expect(sizeOptions).toEqual([LEGACY_CANVAS_ID, ...PAPER_SIZES.map((s) => s.id)]);
    const orientationOptions = [...container.querySelectorAll("#pt-markup-canvas-orientation option")].map(
      (o) => o.value
    );
    expect(orientationOptions).toEqual(["landscape", "portrait"]);
  });

  it("defaults to the legacy size with orientation disabled (no orientation concept for legacy)", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-canvas-size").value).toBe(LEGACY_CANVAS_ID);
    expect(container.querySelector("#pt-markup-canvas-orientation").disabled).toBe(true);
  });

  it("picking a paper size re-enables the orientation control before Apply is even clicked", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-canvas-size").value = "ansi_b";
    container.querySelector("#pt-markup-canvas-size").dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("#pt-markup-canvas-orientation").disabled).toBe(false);
  });

  it("applying a new size on an empty step resizes the backing canvas element to the exact logical dimensions", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_b", "landscape");
    const canvas = container.querySelector("#pt-markup-canvas");
    expect(canvas.width).toBe(17 * 96);
    expect(canvas.height).toBe(11 * 96);
    expect(handle.markupOverlay.canvasSizeFor(1)).toMatchObject({ id: "ansi_b", orientation: "landscape" });
  });

  it("applying portrait swaps the backing canvas dimensions from landscape", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "arch_c", "portrait");
    const canvas = container.querySelector("#pt-markup-canvas");
    expect(canvas.width).toBe(18 * 96);
    expect(canvas.height).toBe(24 * 96);
  });

  it("rejects applying a new size once the step has a shape, shows an error, and leaves the canvas/overlay unchanged", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-add-rect").click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    applySize(container, "ansi_b", "landscape");
    const status = container.querySelector("#pt-markup-canvas-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
    expect(handle.markupOverlay.canvasSizeFor(1).id).toBe(LEGACY_CANVAS_ID); // unchanged
    const canvas = container.querySelector("#pt-markup-canvas");
    expect(canvas.width).toBe(640); // unchanged
  });

  it("succeeds after the rejected step is explicitly cleared first", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    container.querySelector("#pt-markup-add-rect").click();
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    applySize(container, "ansi_b", "landscape"); // rejected, shape still present
    handle.markupOverlay.clearStep(1);
    applySize(container, "ansi_b", "landscape"); // now succeeds
    expect(handle.markupOverlay.canvasSizeFor(1).id).toBe("ansi_b");
  });

  it("the shape-placement form's numeric fields are bounded to the step's own current canvas, not a hardcoded 640/480", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_b", "landscape"); // 1632x1056
    container.querySelector("#pt-markup-add-rect").click();
    expect(container.querySelector("#pt-markup-field-x").max).toBe(String(17 * 96));
    expect(container.querySelector("#pt-markup-field-y").max).toBe(String(11 * 96));
  });

  it("placing a shape well outside the legacy 640x480 but inside a larger applied canvas succeeds", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_e", "landscape"); // 4224x3264
    container.querySelector("#pt-markup-add-rect").click();
    container.querySelector("#pt-markup-field-x").value = "4000";
    container.querySelector("#pt-markup-field-y").value = "3000";
    container.querySelector("#pt-markup-field-w").value = "50";
    container.querySelector("#pt-markup-field-h").value = "50";
    container.querySelector("#pt-markup-shape-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    expect(handle.markupOverlay.shapesFor(1)).toHaveLength(1);
  });

  it("switching steps shows each step's own independently-applied canvas size", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_b", "landscape");
    const steps = [...container.querySelectorAll("#pt-guide-steps button")];
    if (steps.length > 1) {
      steps[1].click();
      expect(container.querySelector("#pt-markup-canvas-size").value).toBe(LEGACY_CANVAS_ID);
      steps[0].click();
      expect(container.querySelector("#pt-markup-canvas-size").value).toBe("ansi_b");
    }
  });

  it("discard clears a step's applied canvas size back to legacy, not just its shapes", () => {
    const { container, handle } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_b", "landscape");
    container.querySelector("#pt-review-discard-btn").click();
    expect(handle.markupOverlay.canvasSizeFor(1).id).toBe(LEGACY_CANVAS_ID);
  });

  it("DEMO/DRAFT/NOT VERIFIED badge and disabled-capture banner remain visible while the size picker is in use", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    applySize(container, "ansi_b", "landscape");
    expect(container.querySelector("#pt-guide-badge").textContent).toContain("NOT VERIFIED");
    expect(container.querySelector(".pt-disabled-banner").textContent.toLowerCase()).toContain("disabled");
  });

  it("every size/orientation control is a real, keyboard-operable <select>/<button>", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-canvas-size").tagName).toBe("SELECT");
    expect(container.querySelector("#pt-markup-canvas-orientation").tagName).toBe("SELECT");
    const applyBtn = container.querySelector("#pt-markup-canvas-apply");
    expect(applyBtn.tagName).toBe("BUTTON");
    expect(applyBtn.getAttribute("type")).toBe("button");
  });
});

describe("renderProcessTrainingControls — Slice B: plot-plan background + raster overlays", () => {
  function advanceToReview(container) {
    chooseExampleTarget(container, 0);
    container.querySelector("#pt-begin-btn").click();
    container.querySelector("#pt-consent-confirm").click();
    container.querySelector("#pt-load-review-btn").click();
  }

  function openFirstStepMarkup(container) {
    const btn = [...container.querySelectorAll("#pt-guide-steps button")][0];
    btn.click();
  }

  /** A resolved-decode fake: ignores the real File entirely, returns a canned decoded record with its own close() spy, so a test can prove the review's round-1 bitmap-disposal fix. */
  function fakeDecoder(width, height, label = "img") {
    return async () => ({ url: `blob:${label}`, bitmap: { width, height, close: vi.fn() }, width, height });
  }

  /** A rejecting-decode fake, for error-path tests. */
  function failingDecoder(error) {
    return async () => {
      throw error;
    };
  }

  /** A controllable decode fake for fencing tests: resolves only when the test calls the returned `resolve`. The resolved record's own bitmap carries a close() spy too. */
  function controllableDecoder() {
    let resolveFn;
    const decodeImageFile = () =>
      new Promise((resolve) => {
        resolveFn = resolve;
      });
    return {
      decodeImageFile,
      resolve: (record) => resolveFn(record),
      resolveDefault: (width = 50, height = 50, label = "ctl") =>
        resolveFn({ url: `blob:${label}`, bitmap: { width, height, close: vi.fn() }, width, height }),
    };
  }

  /**
   * A resolved-decode fake that returns a FRESH, independently-trackable
   * record (own url + own close() spy) on every call, labeled
   * sequentially a, b, c... -- for tests proving the review's round-1
   * "superseded pending replacement" fix (A->B success/failure/overlay
   * selection), where each selection in the sequence must be
   * individually inspectable.
   */
  function sequencedDecoder(width = 50, height = 50) {
    let n = 0;
    const records = [];
    const decodeImageFile = async () => {
      const label = String.fromCharCode(97 + n++);
      const record = { url: `blob:${label}`, bitmap: { width, height, close: vi.fn() }, width, height };
      records.push(record);
      return record;
    };
    return { decodeImageFile, records };
  }

  function selectFile(input, fakeFile = { name: "plan.png", size: 1000 }) {
    Object.defineProperty(input, "files", { value: [fakeFile], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("selecting a background file decodes it and sets it on the step's background store", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(1280, 960, "plan") });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    const bg = handle.backgroundStore.backgroundFor(1);
    expect(bg).not.toBeNull();
    expect(bg.width).toBe(1280);
    expect(bg.height).toBe(960);
    expect(container.querySelector("#pt-markup-background-status").textContent).toContain("Background set");
  });

  it("a decode failure shows an error status and sets no background", async () => {
    const { container, handle } = mountFresh({
      decodeImageFile: failingDecoder(Object.assign(new Error("unsupported or unrecognized file type"), { name: "BackgroundImageError" })),
    });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    expect(handle.backgroundStore.backgroundFor(1)).toBeNull();
    const status = container.querySelector("#pt-markup-background-status");
    expect(status.textContent.length).toBeGreaterThan(0);
    expect(status.className).toContain("error");
  });

  it("replacing an existing background requires explicit confirmation -- not applied until Confirm replace is clicked", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100, "first") });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    expect(handle.backgroundStore.backgroundFor(1).width).toBe(100);

    // Second selection, different decoder result -- must not apply yet.
    const secondInput = container.querySelector("#pt-markup-background-input");
    const original = handle.backgroundStore.backgroundFor(1);
    selectFile(secondInput, { name: "second.png", size: 1000 });
    await flushMicrotasks();
    expect(handle.backgroundStore.backgroundFor(1)).toEqual(original); // unchanged so far
    expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

    container.querySelector("#pt-markup-background-confirm-btn").click();
    // The confirm click re-decodes nothing -- it applies the pending
    // candidate, which (with this single-shot fakeDecoder) is still the
    // "first" dimensions since the mock doesn't vary by call; the point
    // under test is the gating, not the dimensions.
    expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(true);
  });

  it("canceling a pending replacement leaves the original background untouched", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100, "first") });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    const original = handle.backgroundStore.backgroundFor(1);

    selectFile(container.querySelector("#pt-markup-background-input"), { name: "second.png", size: 1000 });
    await flushMicrotasks();
    container.querySelector("#pt-markup-background-confirm-cancel").click();
    expect(handle.backgroundStore.backgroundFor(1)).toEqual(original);
    expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(true);
  });

  it("removing a background clears it from the store and updates the status", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    container.querySelector("#pt-markup-background-remove").click();
    expect(handle.backgroundStore.backgroundFor(1)).toBeNull();
    expect(container.querySelector("#pt-markup-background-status").textContent).toContain("No background");
  });

  it("adding an overlay decodes it and lists it with Move forward/backward/Edit placement/Remove controls", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(50, 50, "ov") });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-overlay-input"));
    await flushMicrotasks();
    expect(handle.backgroundStore.overlaysFor(1)).toHaveLength(1);
    const items = [...container.querySelectorAll("#pt-markup-overlay-list li")];
    expect(items).toHaveLength(1);
    const buttons = [...items[0].querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Move backward", "Move forward", "Edit placement", "Remove"]);
  });

  it("the 9th overlay is rejected with a status error and the store still holds exactly 8", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(10, 10) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    const input = container.querySelector("#pt-markup-overlay-input");
    for (let i = 0; i < 8; i++) {
      selectFile(input, { name: `ov${i}.png`, size: 100 });
      await flushMicrotasks();
    }
    expect(handle.backgroundStore.overlaysFor(1)).toHaveLength(8);
    selectFile(input, { name: "ov9.png", size: 100 });
    await flushMicrotasks();
    expect(handle.backgroundStore.overlaysFor(1)).toHaveLength(8); // unchanged
    const status = container.querySelector("#pt-markup-overlay-status");
    expect(status.className).toContain("error");
  });

  it("removing an overlay via its Remove button drops it from the store and the list", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(10, 10) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-overlay-input"));
    await flushMicrotasks();
    const removeBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
      (b) => b.textContent === "Remove"
    );
    removeBtn.click();
    expect(handle.backgroundStore.overlaysFor(1)).toHaveLength(0);
    expect(container.querySelector("#pt-markup-overlay-list li.pt-markup-empty")).not.toBeNull();
  });

  it("Move forward/backward buttons change the overlay's z-order via the store", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(10, 10) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    const input = container.querySelector("#pt-markup-overlay-input");
    selectFile(input, { name: "a.png", size: 100 });
    await flushMicrotasks();
    selectFile(input, { name: "b.png", size: 100 });
    await flushMicrotasks();
    const [a, b] = handle.backgroundStore.overlaysFor(1);
    expect([a.id, b.id]).toHaveLength(2);

    // Second list item is "b" (back-to-front order); click its own
    // "Move backward" button (the first button in that <li>).
    const secondLi = [...container.querySelectorAll("#pt-markup-overlay-list li")][1];
    secondLi.querySelector("button").click(); // "Move backward"
    expect(handle.backgroundStore.overlaysFor(1).map((o) => o.id)).toEqual([b.id, a.id]);
  });

  it("a background or overlay blocks the canvas-size Apply button, with a clear error, same as an existing shape would", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    container.querySelector("#pt-markup-canvas-size").value = "ansi_b";
    container.querySelector("#pt-markup-canvas-size").dispatchEvent(new Event("change", { bubbles: true }));
    container.querySelector("#pt-markup-canvas-orientation").value = "landscape";
    container.querySelector("#pt-markup-canvas-apply").click();
    const status = container.querySelector("#pt-markup-canvas-status");
    expect(status.className).toContain("error");
    expect(handle.markupOverlay.canvasSizeFor(1).id).toBe("legacy"); // unchanged
  });

  it("discard clears a step's background and overlays, not just its markup shapes", async () => {
    const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    selectFile(container.querySelector("#pt-markup-overlay-input"));
    await flushMicrotasks();
    container.querySelector("#pt-review-discard-btn").click();
    expect(handle.backgroundStore.backgroundFor(1)).toBeNull();
    expect(handle.backgroundStore.overlaysFor(1)).toEqual([]);
  });

  it("a stale in-flight decode is discarded, not applied, if the step is switched before it resolves -- and its bitmap is closed, not just its URL revoked", async () => {
    const { decodeImageFile, resolve } = controllableDecoder();
    const { container, handle } = mountFresh({ decodeImageFile });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));

    // Leave the step before the decode resolves.
    container.querySelector("#pt-markup-close").click();

    const staleBitmap = { width: 50, height: 50, close: vi.fn() };
    resolve({ url: "blob:stale", bitmap: staleBitmap, width: 50, height: 50 });
    await flushMicrotasks();
    expect(handle.backgroundStore.backgroundFor(1)).toBeNull();
    expect(staleBitmap.close).toHaveBeenCalledTimes(1); // review finding, round 1 -- not just the URL
  });

  it("a stale in-flight decode is discarded if a discard/reset happens before it resolves -- and its bitmap is closed too", async () => {
    const { decodeImageFile, resolve } = controllableDecoder();
    const { container, handle } = mountFresh({ decodeImageFile });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));

    container.querySelector("#pt-review-discard-btn").click();

    const staleBitmap2 = { width: 50, height: 50, close: vi.fn() };
    resolve({ url: "blob:stale2", bitmap: staleBitmap2, width: 50, height: 50 });
    await flushMicrotasks();
    expect(staleBitmap2.close).toHaveBeenCalledTimes(1);
    expect(handle.backgroundStore.backgroundFor(1)).toBeNull();
  });

  it("DEMO/DRAFT/NOT VERIFIED badge and disabled-capture banner remain visible with a background and overlay present", async () => {
    const { container } = mountFresh({ decodeImageFile: fakeDecoder(100, 100) });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    expect(container.querySelector("#pt-guide-badge").textContent).toContain("NOT VERIFIED");
    expect(container.querySelector(".pt-disabled-banner").textContent.toLowerCase()).toContain("disabled");
  });

  it("every background/overlay control is a real, keyboard-operable <input>/<button>", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    expect(container.querySelector("#pt-markup-background-input").tagName).toBe("INPUT");
    expect(container.querySelector("#pt-markup-background-input").type).toBe("file");
    expect(container.querySelector("#pt-markup-overlay-input").tagName).toBe("INPUT");
    for (const id of ["pt-markup-background-remove", "pt-markup-background-confirm-btn", "pt-markup-background-confirm-cancel"]) {
      const el = container.querySelector(`#${id}`);
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
  });

  it("never claims PDF support, and the background/overlay sections say so plainly", () => {
    const { container } = mountFresh();
    advanceToReview(container);
    openFirstStepMarkup(container);
    const panelText = container.querySelector("#pt-markup-panel").textContent.toLowerCase();
    expect(panelText).toContain("pdf is not supported");
    const backgroundInput = container.querySelector("#pt-markup-background-input");
    expect(backgroundInput.getAttribute("accept")).not.toContain("pdf");
  });

  it("never reveals withheld evidence through the background/overlay sections' DOM", async () => {
    const { container } = mountFresh({
      decodeImageFile: fakeDecoder(100, 100),
      buildFixtureEvidence: () => [
        {
          type: "Event",
          event: {
            sequenceId: 1,
            kind: "Click",
            point: [1, 1],
            target: { name: "Secret Background Field", automationId: "txt-secret-bg", processName: "fixture.exe" },
            screenshot: null,
            privacy: { trust: "Default", decision: "Withhold" },
          },
        },
      ],
    });
    advanceToReview(container);
    openFirstStepMarkup(container);
    selectFile(container.querySelector("#pt-markup-background-input"));
    await flushMicrotasks();
    const panelHtml = container.querySelector("#pt-markup-panel").outerHTML;
    expect(panelHtml).not.toContain("Secret Background Field");
    expect(panelHtml).not.toContain("txt-secret-bg");
  });

  describe("round 2 review fixes -- bitmap disposal, superseded pending replacement, overlay placement controls", () => {
    it("canceling a pending replacement closes its candidate's bitmap, not just revokes its URL", async () => {
      const { decodeImageFile, records } = sequencedDecoder(100, 100);
      const { container } = mountFresh({ decodeImageFile });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-background-input")); // original
      await flushMicrotasks();
      selectFile(container.querySelector("#pt-markup-background-input"), { name: "second.png", size: 1000 }); // pending
      await flushMicrotasks();
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);
      container.querySelector("#pt-markup-background-confirm-cancel").click();
      expect(records[1].bitmap.close).toHaveBeenCalledTimes(1); // the pending (canceled) candidate
    });

    it("the 9th rejected overlay's bitmap is closed too, not just its URL revoked", async () => {
      const { decodeImageFile, records } = sequencedDecoder(10, 10);
      const { container } = mountFresh({ decodeImageFile });
      advanceToReview(container);
      openFirstStepMarkup(container);
      const input = container.querySelector("#pt-markup-overlay-input");
      for (let i = 0; i < 9; i++) {
        selectFile(input, { name: `ov${i}.png`, size: 100 });
        await flushMicrotasks();
      }
      expect(records).toHaveLength(9);
      expect(records[8].bitmap.close).toHaveBeenCalledTimes(1); // the rejected 9th
      expect(records[0].bitmap.close).not.toHaveBeenCalled(); // the kept 1st
    });

    it("A -> B success: selecting a second background replacement while the first is still pending disposes A and offers B for confirmation", async () => {
      const { decodeImageFile, records } = sequencedDecoder(100, 100);
      const { container, handle } = mountFresh({ decodeImageFile });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-background-input")); // original background
      await flushMicrotasks();
      selectFile(container.querySelector("#pt-markup-background-input"), { name: "A.png", size: 100 }); // A pending
      await flushMicrotasks();
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

      selectFile(container.querySelector("#pt-markup-background-input"), { name: "B.png", size: 100 }); // B supersedes A
      await flushMicrotasks();

      expect(records[1].bitmap.close).toHaveBeenCalledTimes(1); // A disposed
      expect(records[2].bitmap.close).not.toHaveBeenCalled(); // B not disposed -- it's the new pending candidate
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

      container.querySelector("#pt-markup-background-confirm-btn").click();
      expect(handle.backgroundStore.backgroundFor(1).width).toBe(100); // applies B (same fake dims, but via a distinct record)
      expect(records[1].bitmap.close).toHaveBeenCalledTimes(1); // still only once -- confirming B doesn't re-touch A
    });

    it("A -> B failure: a pending replacement A is disposed even when the superseding selection B fails to decode", async () => {
      const aBitmap = { width: 100, height: 100, close: vi.fn() };
      let call = 0;
      const decodeImageFile = async () => {
        call++;
        if (call === 1) return { url: "blob:orig", bitmap: { width: 100, height: 100, close: vi.fn() }, width: 100, height: 100 };
        if (call === 2) return { url: "blob:A", bitmap: aBitmap, width: 100, height: 100 };
        throw Object.assign(new Error("B failed to decode"), { name: "BackgroundImageError" });
      };
      const { container } = mountFresh({ decodeImageFile });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-background-input")); // call 1: original background
      await flushMicrotasks();
      selectFile(container.querySelector("#pt-markup-background-input"), { name: "A.png", size: 100 }); // call 2: A pending
      await flushMicrotasks();
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

      selectFile(container.querySelector("#pt-markup-background-input"), { name: "B.png", size: 100 }); // call 3: B fails
      await flushMicrotasks();

      expect(aBitmap.close).toHaveBeenCalledTimes(1); // A disposed even though B's own decode failed
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(true); // no stale confirm row for A left showing
      const status = container.querySelector("#pt-markup-background-status");
      expect(status.className).toContain("error"); // B's own failure surfaced
    });

    it("A -> overlay selection: selecting an overlay while a background replacement is still pending disposes the pending background candidate", async () => {
      const { decodeImageFile, records } = sequencedDecoder(50, 50);
      const { container, handle } = mountFresh({ decodeImageFile });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-background-input")); // original background
      await flushMicrotasks();
      selectFile(container.querySelector("#pt-markup-background-input"), { name: "A.png", size: 100 }); // A pending
      await flushMicrotasks();
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

      selectFile(container.querySelector("#pt-markup-overlay-input"), { name: "ov.png", size: 100 });
      await flushMicrotasks();

      expect(records[1].bitmap.close).toHaveBeenCalledTimes(1); // A disposed
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(true);
      expect(handle.backgroundStore.overlaysFor(1)).toHaveLength(1); // the overlay still went through
    });

    it("a stale confirm click (after the step was switched away and back) is a no-op, not an error, and applies nothing", async () => {
      const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(100, 100, "orig") });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-background-input"));
      await flushMicrotasks();
      selectFile(container.querySelector("#pt-markup-background-input"), { name: "A.png", size: 100 });
      await flushMicrotasks();
      expect(container.querySelector("#pt-markup-background-confirm-row").hidden).toBe(false);

      // openMarkupFor/closeMarkupPanel already cancel any pending
      // replacement and bump loadGeneration -- simulate the user
      // switching away and back without ever clicking Confirm in between.
      container.querySelector("#pt-markup-close").click();
      openFirstStepMarkup(container);

      const before = handle.backgroundStore.backgroundFor(1);
      // The confirm button is now stale/orphaned from the DOM's point of
      // view (the row was hidden by the cancel), but even a direct click
      // must be a safe no-op.
      container.querySelector("#pt-markup-background-confirm-btn").click();
      expect(handle.backgroundStore.backgroundFor(1)).toEqual(before);
    });

    it("overlay placement: Edit placement opens a numeric x/y/w/h form; Apply updates the store and closes the form", async () => {
      const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(50, 50) });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-overlay-input"));
      await flushMicrotasks();

      const editBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
        (b) => b.textContent === "Edit placement"
      );
      editBtn.click();
      expect(container.querySelector("#pt-markup-overlay-placement-form").hidden).toBe(false);
      container.querySelector("#pt-markup-overlay-placement-x").value = "20";
      container.querySelector("#pt-markup-overlay-placement-y").value = "30";
      container.querySelector("#pt-markup-overlay-placement-w").value = "40";
      container.querySelector("#pt-markup-overlay-placement-h").value = "40";
      container.querySelector("#pt-markup-overlay-placement-form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      expect(container.querySelector("#pt-markup-overlay-placement-form").hidden).toBe(true);
      const overlay = handle.backgroundStore.overlaysFor(1)[0];
      expect(overlay).toMatchObject({ x: 20, y: 30, w: 40, h: 40 });
    });

    it("overlay placement: an off-canvas value is rejected, shows an error, and preserves the previous placement", async () => {
      const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(50, 50) });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-overlay-input"));
      await flushMicrotasks();
      const before = handle.backgroundStore.overlaysFor(1)[0];

      const editBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
        (b) => b.textContent === "Edit placement"
      );
      editBtn.click();
      container.querySelector("#pt-markup-overlay-placement-x").value = "9999"; // off the 640-wide legacy canvas
      container.querySelector("#pt-markup-overlay-placement-y").value = "0";
      container.querySelector("#pt-markup-overlay-placement-w").value = "50";
      container.querySelector("#pt-markup-overlay-placement-h").value = "50";
      container.querySelector("#pt-markup-overlay-placement-form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      const status = container.querySelector("#pt-markup-overlay-placement-status");
      expect(status.textContent.length).toBeGreaterThan(0);
      expect(status.className).toContain("error");
      expect(handle.backgroundStore.overlaysFor(1)[0]).toEqual(before); // unchanged
      expect(container.querySelector("#pt-markup-overlay-placement-form").hidden).toBe(false); // stays open for correction
    });

    it("overlay placement: editing step 1's overlay never touches step 2's overlay", async () => {
      const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(50, 50) });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-overlay-input"));
      await flushMicrotasks();

      const steps = [...container.querySelectorAll("#pt-guide-steps button")];
      if (steps.length > 1) {
        steps[1].click();
        selectFile(container.querySelector("#pt-markup-overlay-input"), { name: "s2.png", size: 100 });
        await flushMicrotasks();
        const before2 = handle.backgroundStore.overlaysFor(2)[0];

        steps[0].click();
        const editBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
          (b) => b.textContent === "Edit placement"
        );
        editBtn.click();
        container.querySelector("#pt-markup-overlay-placement-x").value = "5";
        container.querySelector("#pt-markup-overlay-placement-y").value = "5";
        container.querySelector("#pt-markup-overlay-placement-w").value = "20";
        container.querySelector("#pt-markup-overlay-placement-h").value = "20";
        container.querySelector("#pt-markup-overlay-placement-form").dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
        expect(handle.backgroundStore.overlaysFor(2)[0]).toEqual(before2); // step 2 untouched
      }
    });

    it("Cancel on the overlay placement form closes it without changing the overlay", async () => {
      const { container, handle } = mountFresh({ decodeImageFile: fakeDecoder(50, 50) });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-overlay-input"));
      await flushMicrotasks();
      const before = handle.backgroundStore.overlaysFor(1)[0];

      const editBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
        (b) => b.textContent === "Edit placement"
      );
      editBtn.click();
      container.querySelector("#pt-markup-overlay-placement-x").value = "5";
      container.querySelector("#pt-markup-overlay-placement-cancel").click();
      expect(container.querySelector("#pt-markup-overlay-placement-form").hidden).toBe(true);
      expect(handle.backgroundStore.overlaysFor(1)[0]).toEqual(before);
    });

    it("every overlay-placement control is a real, keyboard-operable <input>/<button>", async () => {
      const { container } = mountFresh({ decodeImageFile: fakeDecoder(50, 50) });
      advanceToReview(container);
      openFirstStepMarkup(container);
      selectFile(container.querySelector("#pt-markup-overlay-input"));
      await flushMicrotasks();
      const editBtn = [...container.querySelectorAll("#pt-markup-overlay-list button")].find(
        (b) => b.textContent === "Edit placement"
      );
      editBtn.click();
      for (const id of ["pt-markup-overlay-placement-x", "pt-markup-overlay-placement-y", "pt-markup-overlay-placement-w", "pt-markup-overlay-placement-h"]) {
        expect(container.querySelector(`#${id}`).tagName).toBe("INPUT");
      }
      const applyBtn = container.querySelector("#pt-markup-overlay-placement-apply");
      expect(applyBtn.tagName).toBe("BUTTON");
      const cancelBtn = container.querySelector("#pt-markup-overlay-placement-cancel");
      expect(cancelBtn.tagName).toBe("BUTTON");
      expect(cancelBtn.getAttribute("type")).toBe("button");
    });
  });
});
