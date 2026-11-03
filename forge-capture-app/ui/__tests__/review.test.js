// @vitest-environment jsdom
//
// Tests for forge-capture-app/ui/review.js — the C2-P6A candidate-only review
// panel's DOM driver. jsdom is used only here; the pure logic in
// review-core.js is tested separately under plain node (review-core.test.js).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderReviewPanel } from "../review.js";
import { DISPOSITIONS } from "../review-core.js";

function snapshot(overrides = {}) {
  return {
    sessionRevision: 0,
    policyVersion: "policy-v1",
    modelManifestSha256: "model-manifest-v1",
    frameId: "f1",
    frameWidth: 100,
    frameHeight: 100,
    candidates: [
      { candidateId: "c1", detectorId: "det.ssn", reasonCode: "SSN_SHAPE", disposition: DISPOSITIONS.PENDING, originalBox: [1, 2, 3, 4], expandedBox: [0, 1, 4, 5] },
    ],
    ...overrides,
  };
}

async function loadContext(container, { workspaceRoot = "C:\\ws", sessionRelativePath = "session.json", frameId = "f1" } = {}) {
  container.querySelector("#review-workspace").value = workspaceRoot;
  container.querySelector("#review-session").value = sessionRelativePath;
  container.querySelector("#review-frame").value = frameId;
  container.querySelector("#review-load").click();
  await flush();
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("renderReviewPanel", () => {
  let container;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    // jsdom's `document` is shared across this whole file; leaving a
    // prior test's elements attached produces duplicate `id`s once the
    // next test renders its own panel, which makes a container-scoped
    // `querySelector("#id")` unreliable (nwsapi's ID-selector fast path
    // does not correctly scope to the subtree once the same id exists
    // elsewhere in the document). Every test's own DOM must be removed
    // before the next one renders.
    document.body.innerHTML = "";
  });

  it("loads and groups candidates from the snapshot", async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") return snapshot();
      throw new Error("unexpected command: " + cmd);
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    expect(invoke).toHaveBeenCalledWith("get_review_candidates", { workspaceRoot: "C:\\ws", sessionRelativePath: "session.json", frameId: "f1" });
    const pendingList = container.querySelector('[aria-label="Pending candidates"]');
    expect(pendingList.textContent).toContain("c1");
    expect(pendingList.textContent).toContain("det.ssn");
  });

  it("shows 'No candidates in this frame.' for an empty frame, never 'safe' or 'verified'", async () => {
    const invoke = vi.fn(async () => snapshot({ candidates: [] }));
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    const text = container.textContent;
    expect(text).toContain("No candidates in this frame.");
    expect(text).not.toMatch(/\bsafe\b|\bverified\b|detection completed/i);
  });

  it("an unknown-disposition candidate is visibly shown with no action, not silently counted and never rendered", async () => {
    // Muse review 2026-11-02 (fix-before-merge): a candidate with a
    // disposition this app version doesn't recognize must still appear
    // somewhere, with an explicit error and no action button — it must
    // never be counted in the loaded total while rendering no row at all.
    const invoke = vi.fn(async () =>
      snapshot({
        candidates: [
          { candidateId: "c1", detectorId: "det.ssn", reasonCode: "SSN_SHAPE", disposition: "DELETE_FOREVER", originalBox: [0, 0, 1, 1], expandedBox: [0, 0, 1, 1] },
        ],
      }),
    );
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    expect(container.querySelector("#review-status").textContent).toContain("Loaded 1 candidate");
    const unknownSection = container.querySelector("#review-unknown-section");
    expect(unknownSection.hidden).toBe(false);
    expect(unknownSection.textContent).toContain("c1");
    expect(unknownSection.textContent).toMatch(/unrecognized|error/i);
    expect(unknownSection.querySelector("button[data-action]")).toBeNull();
  });

  it("hides the unknown-disposition section entirely when every candidate has a recognized disposition", async () => {
    const invoke = vi.fn(async () => snapshot());
    renderReviewPanel(container, { invoke });
    await loadContext(container);
    expect(container.querySelector("#review-unknown-section").hidden).toBe(true);
  });

  it("renders a hostile candidateId/reasonCode as inert text, never as markup", async () => {
    const hostile = "<img src=x onerror=window.__pwned=true>";
    const invoke = vi.fn(async () =>
      snapshot({ candidates: [{ candidateId: hostile, detectorId: hostile, reasonCode: hostile, disposition: DISPOSITIONS.PENDING, originalBox: [0, 0, 1, 1], expandedBox: [0, 0, 1, 1] }] }),
    );
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    expect(window.__pwned).toBeUndefined();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(hostile);
  });

  it("REDACT sends the exact command/payload with no confirmation call and no window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") return snapshot();
      if (cmd === "review_disposition_change") return 1;
      throw new Error("unexpected: " + cmd);
    });
    renderReviewPanel(container, { invoke, genUuid: () => "evt-fixed", nowIso: () => "2026-11-02T00:00:00Z" });
    await loadContext(container);

    container.querySelector('button[data-action="redact"]').click();
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("review_disposition_change", {
      workspaceRoot: "C:\\ws",
      sessionRelativePath: "session.json",
      frameId: "f1",
      candidateId: "c1",
      newDisposition: "REDACT",
      reason: "",
      expectedSessionRevision: 0,
      expectedPolicyVersion: "policy-v1",
      expectedModelManifestSha256: "model-manifest-v1",
      eventId: "evt-fixed",
      localTimestamp: "2026-11-02T00:00:00Z",
    });
  });

  it("MARK_NON_SENSITIVE rejects a blank reason without calling the backend", async () => {
    const invoke = vi.fn(async (cmd) => (cmd === "get_review_candidates" ? snapshot() : 1));
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    container.querySelector('button[data-action="mark-non-sensitive"]').click();
    await flush();
    container.querySelector('button[data-action="submit-mark-non-sensitive"]').click();
    await flush();

    expect(invoke).not.toHaveBeenCalledWith("review_disposition_change", expect.anything());
    expect(container.querySelector("#review-status").textContent).toMatch(/reason/i);
  });

  it("a valid MARK_NON_SENSITIVE action calls review_disposition_change directly, never window.confirm or a web modal — the native command owns confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const invoke = vi.fn(async (cmd) => (cmd === "get_review_candidates" ? snapshot() : 1));
    renderReviewPanel(container, { invoke, genUuid: () => "evt-fixed-2", nowIso: () => "2026-11-02T00:00:01Z" });
    await loadContext(container);

    container.querySelector('button[data-action="mark-non-sensitive"]').click();
    await flush();
    const reasonInput = container.querySelector(".review-reason-row input");
    reasonInput.value = "verified with the customer";
    reasonInput.dispatchEvent(new Event("input"));
    container.querySelector('button[data-action="submit-mark-non-sensitive"]').click();
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".web-confirm-modal")).toBeNull();
    expect(invoke).toHaveBeenCalledWith(
      "review_disposition_change",
      expect.objectContaining({ newDisposition: "MARK_NON_SENSITIVE", reason: "verified with the customer", eventId: "evt-fixed-2" }),
    );
  });

  it("is single-flight: a second click while an action is in flight does not send a second command", async () => {
    let resolveFirst;
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") return snapshot();
      return new Promise((r) => {
        resolveFirst = r;
      });
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    const redactBtn = container.querySelector('button[data-action="redact"]');
    redactBtn.click();
    await flush();
    expect(redactBtn.disabled).toBe(true);
    redactBtn.click(); // second click while disabled/in flight — must be a no-op.
    await flush();

    expect(invoke.mock.calls.filter((c) => c[0] === "review_disposition_change")).toHaveLength(1);
    resolveFirst(1);
  });

  it("on success, reloads and renders the new snapshot's revision, with no optimistic update beforehand", async () => {
    let afterCallCount = 0;
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") {
        afterCallCount += 1;
        return afterCallCount === 1 ? snapshot() : snapshot({ sessionRevision: 1, candidates: [{ ...snapshot().candidates[0], disposition: DISPOSITIONS.REDACT }] });
      }
      return 1;
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    container.querySelector('button[data-action="redact"]').click();
    await flush();
    await flush();

    expect(container.querySelector("#review-context-display").textContent).toContain("revision 1");
    expect(container.querySelector('[aria-label="Redacted candidates"]').textContent).toContain("c1");
  });

  it("surfaces a stale-revision refusal visibly and does not auto-retry", async () => {
    const invoke = vi.fn(async (cmd, args) => {
      if (cmd === "get_review_candidates") return snapshot();
      throw new Error("review action refused: StaleSessionRevision { expected: 0, current: 1 }");
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    container.querySelector('button[data-action="redact"]').click();
    await flush();

    expect(container.querySelector("#review-status").textContent).toMatch(/changed since you loaded|reload/i);
    expect(invoke.mock.calls.filter((c) => c[0] === "review_disposition_change")).toHaveLength(1); // no auto-retry.
    // No optimistic change: the candidate is still shown Pending.
    expect(container.querySelector('[aria-label="Pending candidates"]').textContent).toContain("c1");
  });

  it("surfaces a native-dialog cancellation distinctly from a generic failure", async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") return snapshot();
      throw new Error("review action refused: MissingExplicitConfirmation");
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    container.querySelector('button[data-action="mark-non-sensitive"]').click();
    await flush();
    const reasonInput = container.querySelector(".review-reason-row input");
    reasonInput.value = "verified";
    reasonInput.dispatchEvent(new Event("input"));
    container.querySelector('button[data-action="submit-mark-non-sensitive"]').click();
    await flush();

    expect(container.querySelector("#review-status").textContent).toMatch(/cancelled/i);
  });

  it("surfaces a generic backend failure without raw debug content", async () => {
    const invoke = vi.fn(async (cmd) => {
      if (cmd === "get_review_candidates") return snapshot();
      throw new Error("some completely unexpected backend panic text");
    });
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    container.querySelector('button[data-action="redact"]').click();
    await flush();

    const text = container.querySelector("#review-status").textContent;
    expect(text).not.toContain("panic");
    expect(text.length).toBeGreaterThan(0);
  });

  it("the Load control is disabled while a load is in flight, so the UI itself cannot start a second, overlapping one", async () => {
    // The scope review's "selection/async binding" requirement — a stale
    // response must not replace a newer panel — is enforced two ways
    // here: this single-flight gate means the literal race (two loads
    // for different sessions/frames in flight from one panel at once)
    // can never reach the backend through this UI at all; the lower-level
    // mechanism that would still discard a stale response if it somehow
    // arrived anyway (`RequestGenerationTracker`) is proven directly,
    // against reused candidate IDs across two different sessions, in
    // review-core.test.js.
    let resolveFirst;
    const invoke = vi.fn(async (cmd) => {
      if (cmd !== "get_review_candidates") return 1;
      return new Promise((r) => {
        resolveFirst = r;
      });
    });
    renderReviewPanel(container, { invoke });

    container.querySelector("#review-workspace").value = "C:\\ws";
    container.querySelector("#review-session").value = "old-session.json";
    container.querySelector("#review-frame").value = "f1";
    const loadBtn = container.querySelector("#review-load");
    loadBtn.click();
    await flush();

    expect(loadBtn.disabled).toBe(true);
    // A second click while the first load is still in flight is a no-op —
    // the handler's own busy guard returns immediately without invoking.
    container.querySelector("#review-session").value = "new-session.json";
    loadBtn.click();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    resolveFirst(snapshot({ sessionRevision: 7 }));
    await flush();
    expect(loadBtn.disabled).toBe(false);
  });

  it("is keyboard-operable: the load button and candidate action buttons are real, focusable <button> elements", async () => {
    const invoke = vi.fn(async (cmd) => (cmd === "get_review_candidates" ? snapshot() : 1));
    renderReviewPanel(container, { invoke });
    await loadContext(container);

    const redactBtn = container.querySelector('button[data-action="redact"]');
    expect(redactBtn.tagName).toBe("BUTTON");
    redactBtn.focus();
    expect(document.activeElement).toBe(redactBtn);
  });

  it("the status region is announced via role=status", async () => {
    const invoke = vi.fn(async (cmd) => (cmd === "get_review_candidates" ? snapshot() : 1));
    renderReviewPanel(container, { invoke });
    expect(container.querySelector("#review-status").getAttribute("role")).toBe("status");
  });
});
