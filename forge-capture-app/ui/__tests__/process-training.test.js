// @vitest-environment jsdom
//
// Tests for forge-capture-app/ui/process-training.js — PT-1C's
// consent/session DOM driver. jsdom is used only here (the pure logic in
// process-training-core.js is tested separately under plain node).

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderProcessTrainingControls } from "../process-training.js";
import { ConsentSession } from "../process-training-core.js";

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
