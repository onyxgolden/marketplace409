import { describe, expect, it } from "vitest";
import {
  acknowledgeRecordingNotice,
  applyEvents,
  logCall,
  openCase,
  rebuildCase,
  recordDncRegistration,
  recordOptOut,
} from "./callShieldCase.js";
import { EVENT_TYPES, OPT_OUT_CHANNELS } from "./callShieldConstants.js";
import { attachEvidence } from "./callShieldEvidence.js";
import { EVIDENCE_KINDS } from "./callShieldConstants.js";

const SHA = "a".repeat(64);

function openedCase() {
  return openCase({ reportedBusinessName: "Cruise Agency FL", notes: "test" }).state;
}

describe("openCase", () => {
  it("opens a case with a CASE_OPENED event and empty collections", () => {
    const { state, event } = openCase({ reportedBusinessName: "Cruise Agency FL" });
    expect(event.type).toBe(EVENT_TYPES.CASE_OPENED);
    expect(state.id).toBeTruthy();
    expect(state.reportedBusinessName).toBe("Cruise Agency FL");
    expect(state.calls).toEqual([]);
    expect(state.events).toHaveLength(1);
  });

  it("rejects a missing business name", () => {
    expect(() => openCase({})).toThrow(TypeError);
    expect(() => openCase({ reportedBusinessName: "  " })).toThrow(TypeError);
  });
});

describe("logCall", () => {
  it("appends a CALL_LOGGED event and returns new state", () => {
    const before = openedCase();
    const { state, event } = logCall(before, {
      numberShown: "(713) 239-9946",
      occurredAt: "2026-09-23T10:23:00-05:00",
      pitchNotes: "cruise pitch",
      agentName: "Alex",
      businessNameStated: "Cruise Agency FL",
    });
    expect(event.type).toBe(EVENT_TYPES.CALL_LOGGED);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].numberShown).toBe("(713) 239-9946");
    expect(state.calls[0].businessNameStated).toBe("Cruise Agency FL");
    expect(before.calls).toHaveLength(0); // immutable
    expect(state.events).toHaveLength(2);
  });

  it("records the number as shown without verifying it", () => {
    const { state } = logCall(openedCase(), { numberShown: "000-000-0000" });
    expect(state.calls[0].numberShown).toBe("000-000-0000");
    expect(state.calls[0]).not.toHaveProperty("numberVerified");
  });

  it("rejects invalid input", () => {
    const s = openedCase();
    expect(() => logCall(s, {})).toThrow(TypeError);
    expect(() => logCall(s, { numberShown: "123", occurredAt: "not-a-date" })).toThrow(TypeError);
    expect(() => logCall(s, { numberShown: "123", direction: "sideways" })).toThrow(TypeError);
  });

  it("carries an optional sourceImportId so confirms stay idempotent", () => {
    const { event } = logCall(openedCase(), {
      numberShown: "123",
      sourceImportId: "import-1",
    });
    expect(event.payload.sourceImportId).toBe("import-1");

    const { event: noSource } = logCall(openedCase(), { numberShown: "123" });
    expect(noSource.payload.sourceImportId).toBeNull();
  });
});

describe("recordOptOut / recordDncRegistration / acknowledgeRecordingNotice", () => {
  it("records an opt-out as a user assertion with channel", () => {
    const { state, event } = recordOptOut(openedCase(), {
      channel: OPT_OUT_CHANNELS.VERBAL_ON_CALL,
      occurredAt: "2026-09-20T12:00:00-05:00",
      notes: "told them to remove me",
    });
    expect(event.type).toBe(EVENT_TYPES.OPT_OUT_RECORDED);
    expect(state.optOuts[0].channel).toBe("verbal_on_call");
  });

  it("rejects unknown opt-out channels", () => {
    expect(() => recordOptOut(openedCase(), { channel: "telepathy" })).toThrow(TypeError);
  });

  it("records a DNC registration timestamp", () => {
    const { state } = recordDncRegistration(openedCase(), {
      phoneNumber: "+14095551212",
      registeredAt: "2020-01-15T00:00:00Z",
      proofNotes: "registry confirmation page",
    });
    expect(state.dncRegistrations).toHaveLength(1);
    expect(state.dncRegistrations[0].phoneNumber).toBe("+14095551212");
  });

  it("records the recording-notice acknowledgment", () => {
    const { state, event } = acknowledgeRecordingNotice(openedCase(), {});
    expect(event.type).toBe(EVENT_TYPES.RECORDING_CONSENT_ACKNOWLEDGED);
    expect(state.recordingNoticeAcknowledgedAt).toBeTruthy();
  });
});

describe("event sourcing", () => {
  it("rebuilds identical state from the event list", () => {
    let s = openedCase();
    s = logCall(s, { numberShown: "111", occurredAt: "2026-09-23T10:00:00-05:00" }).state;
    s = recordOptOut(s, { channel: "written", occurredAt: "2026-09-23T11:00:00-05:00" }).state;
    const { event } = attachEvidence(s.id, {
      kind: EVIDENCE_KINDS.CALL_LOG_SCREENSHOT,
      fileName: "log.png",
      mimeType: "image/png",
      byteSize: 120,
      sha256: SHA,
      capturedAt: "2026-09-23T12:00:00-05:00",
    });
    s = applyEvents(s.events, [event]);

    const rebuilt = rebuildCase(s.events);
    expect(rebuilt.calls).toEqual(s.calls);
    expect(rebuilt.optOuts).toEqual(s.optOuts);
    expect(rebuilt.evidence).toEqual(s.evidence);
    expect(rebuilt.reportedBusinessName).toBe(s.reportedBusinessName);
  });

  it("never stores legal conclusions on the case", () => {
    const s = openedCase();
    const serialized = JSON.stringify(s);
    expect(serialized).not.toMatch(/violation/i);
    expect(serialized).not.toMatch(/claimValid/i);
    expect(serialized).not.toMatch(/damages/i);
  });
});
