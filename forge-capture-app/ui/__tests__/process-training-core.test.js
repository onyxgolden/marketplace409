// Tests for forge-capture-app/ui/process-training-core.js — PT-1C's
// consent/session state machine, fixture evidence, and view-model
// mapping. Pure logic only; no DOM.

import { describe, it, expect } from "vitest";
import {
  ConsentSession,
  ConsentError,
  CAPTURE_DISABLED_NOTICE,
  QUEUE_OVERFLOW_STAGES,
  buildFixtureEvidence,
  toEvidenceViewModel,
  summarizeEvidence,
} from "../process-training-core.js";

const TARGET = { label: "Notepad", exeName: "Notepad.exe" };

describe("CAPTURE_DISABLED_NOTICE", () => {
  it("is an explicit, non-empty disabled notice", () => {
    expect(typeof CAPTURE_DISABLED_NOTICE).toBe("string");
    expect(CAPTURE_DISABLED_NOTICE.toLowerCase()).toContain("disabled");
  });
});

describe("ConsentSession — default state", () => {
  it("starts idle, with no target, no trust scope, no consent", () => {
    const session = new ConsentSession();
    const snap = session.describe();
    expect(snap.state).toBe("idle");
    expect(snap.target).toBeNull();
    expect(snap.trustScope).toBeNull();
    expect(snap.disclosureAcknowledged).toBe(false);
    expect(snap.consentedAt).toBeNull();
    expect(snap.evidenceCount).toBe(0);
  });
});

describe("ConsentSession — beginPreflight", () => {
  it("requires a target with a label and exe name", () => {
    const session = new ConsentSession();
    expect(() => session.beginPreflight(null)).toThrow(ConsentError);
    expect(() => session.beginPreflight({ label: "X" })).toThrow(ConsentError);
    expect(() => session.beginPreflight({ exeName: "x.exe" })).toThrow(ConsentError);
  });

  it("lowercases the exe name and moves to preflight", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    expect(session.state).toBe("preflight");
    expect(session.target).toEqual({ label: "Notepad", exeName: "notepad.exe" });
  });

  it("is legal from any state and always clears prior consent/evidence", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "default" });
    session.startReview(buildFixtureEvidence({ trustScope: "default", target: session.target }));
    expect(session.state).toBe("review");

    // Changing target mid-flow resets everything, including evidence.
    session.beginPreflight({ label: "Chrome", exeName: "chrome.exe" });
    const snap = session.describe();
    expect(snap.state).toBe("preflight");
    expect(snap.target).toEqual({ label: "Chrome", exeName: "chrome.exe" });
    expect(snap.trustScope).toBeNull();
    expect(snap.evidenceCount).toBe(0);
  });
});

describe("ConsentSession — grantConsent", () => {
  it("cannot be called before a target is chosen", () => {
    const session = new ConsentSession();
    expect(() => session.grantConsent({ trustScope: "default" })).toThrow(ConsentError);
  });

  it("requires an affirmative action — consent is never implicit", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    expect(() => session.grantConsent({})).toThrow(ConsentError);
    expect(() => session.grantConsent({ trustScope: "not-a-real-scope" })).toThrow(ConsentError);
    expect(session.state).toBe("preflight");
  });

  it("default scope does not require a disclosure acknowledgement", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "default" });
    expect(session.state).toBe("consented_preview");
    expect(session.disclosureAcknowledged).toBe(false);
  });

  it("author_trusted scope is refused without an explicit, acknowledged disclosure", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    expect(() =>
      session.grantConsent({ trustScope: "author_trusted", disclosureAcknowledged: false })
    ).toThrow(ConsentError);
    expect(() => session.grantConsent({ trustScope: "author_trusted" })).toThrow(ConsentError);
    expect(session.state).toBe("preflight");
  });

  it("author_trusted scope succeeds once explicitly acknowledged, and is per-session only", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "author_trusted", disclosureAcknowledged: true });
    expect(session.state).toBe("consented_preview");
    expect(session.trustScope).toBe("author_trusted");
    expect(session.disclosureAcknowledged).toBe(true);
    expect(session.consentedAt).toBeGreaterThan(0);
    // Nothing here persists anywhere; a fresh session has no memory of it.
    const fresh = new ConsentSession();
    expect(fresh.trustScope).toBeNull();
  });
});

describe("ConsentSession — startReview", () => {
  it("cannot be called before consent is granted", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    expect(() => session.startReview([])).toThrow(ConsentError);
  });

  it("requires an evidence array, even if empty", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "default" });
    expect(() => session.startReview(undefined)).toThrow(ConsentError);
    session.startReview([]);
    expect(session.state).toBe("review");
  });
});

describe("ConsentSession — discard", () => {
  it("purges target, consent and evidence, and cannot be called from idle", () => {
    const session = new ConsentSession();
    expect(() => session.discard()).toThrow(ConsentError);

    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "author_trusted", disclosureAcknowledged: true });
    session.startReview(buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET }));
    session.discard();

    const snap = session.describe();
    expect(snap.state).toBe("discarded");
    expect(snap.target).toBeNull();
    expect(snap.trustScope).toBeNull();
    expect(snap.disclosureAcknowledged).toBe(false);
    expect(snap.evidenceCount).toBe(0);

    // Cannot discard an already-discarded session.
    expect(() => session.discard()).toThrow(ConsentError);
  });
});

describe("ConsentSession — reset", () => {
  it("returns to idle from any state, modelling app restart / new session", () => {
    const session = new ConsentSession();
    session.beginPreflight(TARGET);
    session.grantConsent({ trustScope: "default" });
    session.reset();
    expect(session.describe()).toEqual({
      state: "idle",
      target: null,
      trustScope: null,
      disclosureAcknowledged: false,
      consentedAt: null,
      evidenceCount: 0,
    });
  });
});

describe("buildFixtureEvidence", () => {
  it("includes every real QueueOverflow stage, including capture-capacity-exhausted", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const stages = evidence.filter((m) => m.type === "QueueOverflow").map((m) => m.stage);
    for (const stage of QUEUE_OVERFLOW_STAGES) {
      expect(stages).toContain(stage);
    }
    expect(stages).toContain("capture-capacity-exhausted");
  });

  it("always includes a Gap and a SessionReconciliationUncertain", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    expect(evidence.some((m) => m.type === "Gap")).toBe(true);
    expect(evidence.some((m) => m.type === "SessionReconciliationUncertain")).toBe(true);
  });

  it("withholds a third-party click by default, with no automatic 'verified' proceed", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const firstClick = evidence.find((m) => m.type === "Event" && m.event.sequenceId === 1);
    expect(firstClick.event.privacy.trust).toBe("Default");
    expect(firstClick.event.privacy.decision).toBe("Withhold");
    expect(firstClick.event.screenshot).toBeNull();
  });

  it("proceeds an ordinary control only when author-trusted AND no signal fires", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const firstClick = evidence.find((m) => m.type === "Event" && m.event.sequenceId === 1);
    expect(firstClick.event.privacy.trust).toBe("AuthorTrusted");
    expect(firstClick.event.privacy.decision).toBe("ProceedNormally");
  });

  it("still redacts a sensitive-looking control even when author-trusted — trust is never enough alone", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const sensitiveClick = evidence.find((m) => m.type === "Event" && m.event.sequenceId === 2);
    expect(sensitiveClick.event.privacy.trust).toBe("AuthorTrusted");
    expect(sensitiveClick.event.privacy.decision).toBe("RedactRegion");
  });

  it("withholds an untrusted/unrecognized overlay regardless of trust scope", () => {
    for (const trustScope of ["default", "author_trusted"]) {
      const evidence = buildFixtureEvidence({ trustScope, target: TARGET });
      const overlayClick = evidence.find((m) => m.type === "Event" && m.event.sequenceId === 3);
      expect(overlayClick.event.privacy.decision).toBe("Withhold");
    }
  });
});

describe("toEvidenceViewModel", () => {
  it("maps every real variant to its own distinct kind, without collapsing any", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const kinds = new Set(evidence.map((m) => toEvidenceViewModel(m).kind));
    expect(kinds).toEqual(new Set(["event", "gap", "loss", "uncertain"]));
  });

  it("throws on an unrecognized message type instead of silently dropping it", () => {
    expect(() => toEvidenceViewModel({ type: "SomethingNew" })).toThrow(ConsentError);
    expect(() => toEvidenceViewModel({})).toThrow(ConsentError);
  });

  it("throws on an unrecognized event kind or privacy label", () => {
    expect(() =>
      toEvidenceViewModel({ type: "Event", event: { kind: "TripleClick", privacy: {} } })
    ).toThrow(ConsentError);
    expect(() =>
      toEvidenceViewModel({
        type: "Event",
        event: { kind: "Click", privacy: { trust: "Default", decision: "MadeUp" } },
      })
    ).toThrow(ConsentError);
  });

  it("throws on an unrecognized QueueOverflow stage", () => {
    expect(() => toEvidenceViewModel({ type: "QueueOverflow", stage: "not-a-real-stage" })).toThrow(
      ConsentError
    );
  });

  it("surfaces SessionReconciliationUncertain distinctly, never as a Gap", () => {
    const vm = toEvidenceViewModel({ type: "SessionReconciliationUncertain", lastProcessedSeq: 7 });
    expect(vm).toEqual({ kind: "uncertain", lastProcessedSeq: 7 });
  });
});

describe("summarizeEvidence", () => {
  it("is never 'complete' when a gap or reconciliation uncertainty is present", () => {
    const evidence = buildFixtureEvidence({ trustScope: "author_trusted", target: TARGET });
    const summary = summarizeEvidence(evidence.map(toEvidenceViewModel));
    expect(summary.gapCount).toBeGreaterThan(0);
    expect(summary.reconciliationUncertain).toBe(true);
    expect(summary.isComplete).toBe(false);
  });

  it("reports every loss stage present, never hiding any", () => {
    const evidence = buildFixtureEvidence({ trustScope: "default", target: TARGET });
    const summary = summarizeEvidence(evidence.map(toEvidenceViewModel));
    for (const stage of QUEUE_OVERFLOW_STAGES) {
      expect(summary.lossByStage[stage]).toBeGreaterThan(0);
    }
  });

  it("counts withheld/redacted/proceeded events correctly", () => {
    const summary = summarizeEvidence([
      { kind: "event", withheld: true, redacted: false },
      { kind: "event", withheld: false, redacted: true },
      { kind: "event", withheld: false, redacted: false },
    ]);
    expect(summary.totalEvents).toBe(3);
    expect(summary.withheldCount).toBe(1);
    expect(summary.redactedCount).toBe(1);
    expect(summary.proceedCount).toBe(1);
  });

  it("is complete only when there is truly nothing uncertain", () => {
    const summary = summarizeEvidence([{ kind: "event", withheld: false, redacted: false }]);
    expect(summary.isComplete).toBe(true);
  });

  // Regression (round 1 review): a nonzero loss/overflow entry with no
  // separate Gap or SessionReconciliationUncertain was incorrectly
  // leaving isComplete true — dropped/failed captures were reportable
  // as "clean" evidence.
  it("is NOT complete when a loss entry alone has a nonzero dropped count", () => {
    const summary = summarizeEvidence([
      { kind: "event", withheld: false, redacted: false },
      { kind: "loss", stage: "capture-failure", droppedCount: 1 },
    ]);
    expect(summary.gapCount).toBe(0);
    expect(summary.reconciliationUncertain).toBe(false);
    expect(summary.lossByStage["capture-failure"]).toBe(1);
    expect(summary.isComplete).toBe(false);
  });

  it("a zero-count loss entry alone does not, by itself, mark the summary incomplete", () => {
    const summary = summarizeEvidence([
      { kind: "event", withheld: false, redacted: false },
      { kind: "loss", stage: "capture-failure", droppedCount: 0 },
    ]);
    expect(summary.lossByStage["capture-failure"]).toBe(0);
    expect(summary.isComplete).toBe(true);
  });

  it("throws on an unrecognized view-model kind", () => {
    expect(() => summarizeEvidence([{ kind: "mystery" }])).toThrow(ConsentError);
  });
});
