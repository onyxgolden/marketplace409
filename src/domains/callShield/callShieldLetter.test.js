import { describe, expect, it } from "vitest";
import { applyEvents, logCall, openCase, recordDncRegistration, recordOptOut } from "./callShieldCase.js";
import { DRAFT_DISCLOSURE_HEADER, EVENT_TYPES, STATUTORY_DAMAGES_NOTE } from "./callShieldConstants.js";
import { buildDraftLetterData } from "./callShieldLetter.js";

function sampleCase() {
  let s = openCase({ reportedBusinessName: "Cruise Agency FL" }).state;
  s = recordDncRegistration(s, {
    phoneNumber: "+14095551212",
    registeredAt: "2020-01-15T00:00:00Z",
  }).state;
  s = logCall(s, {
    numberShown: "(713) 239-9946",
    occurredAt: "2026-09-23T10:23:00-05:00",
    agentName: "Alex",
    pitchNotes: "cruise pitch",
  }).state;
  s = recordOptOut(s, {
    channel: "verbal_on_call",
    occurredAt: "2026-09-20T12:00:00-05:00",
    notes: "told them to remove me from the call list",
  }).state;
  return s;
}

const parties = {
  senderName: "Jason Morgan",
  senderAddress: "123 Main St\nBeaumont, TX 77701",
  recipientName: "Cruise Agency FL",
  recipientAddress: "PO Box 1\nMiami, FL 33101",
};

describe("buildDraftLetterData", () => {
  it("builds structured draft data with the mandatory disclosure header", () => {
    const { letter, event } = buildDraftLetterData(sampleCase(), parties);
    expect(letter.disclosureHeader).toBe(DRAFT_DISCLOSURE_HEADER);
    expect(letter.subject).toMatch(/draft correspondence/i);
    expect(letter.body.calls).toHaveLength(1);
    expect(letter.body.calls[0].numberShown).toBe("(713) 239-9946");
    expect(letter.body.optOuts).toHaveLength(1);
    expect(letter.body.dncRegistrations).toHaveLength(1);
    expect(letter.body.citations.length).toBeGreaterThan(0);
    expect(event.type).toBe(EVENT_TYPES.DRAFT_LETTER_GENERATED);
  });

  it("never includes damages estimates or legal conclusions", () => {
    const { letter } = buildDraftLetterData(sampleCase(), parties);
    const text = JSON.stringify(letter);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/you are owed/i);
    expect(text).not.toMatch(/estimated recovery/i);
    expect(letter.body.damagesNote).toBe(STATUTORY_DAMAGES_NOTE);
  });

  it("lists evidence gaps as non-blocking warnings", () => {
    const thin = openCase({ reportedBusinessName: "Unknown Caller" }).state;
    const { letter } = buildDraftLetterData(thin, parties);
    expect(letter.warnings.length).toBeGreaterThan(0);
    expect(letter.readinessStatus).toBe("incomplete");
    // Drafting still works — warnings do not block.
    expect(letter.letterId).toBeTruthy();
  });

  it("records the generation on the case timeline", () => {
    const s = sampleCase();
    const { event } = buildDraftLetterData(s, parties);
    const next = applyEvents(s.events, [event]);
    expect(next.draftLetters).toHaveLength(1);
    expect(next.draftLetters[0].recipientName).toBe("Cruise Agency FL");
  });

  it("requires sender/recipient details", () => {
    expect(() => buildDraftLetterData(sampleCase(), {})).toThrow(TypeError);
    expect(() => buildDraftLetterData(null, parties)).toThrow(TypeError);
  });
});
