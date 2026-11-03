import { describe, expect, it } from "vitest";
import {
  containsRawId,
  formatPlainDate,
  redactIds,
  renderMemoryPlainWords,
  renderWorkingSetPlainWords,
} from "../plainWords.js";

describe("plain-words rendering (A8)", () => {
  it("redacts UUIDs and system-style ids", () => {
    const text = "see 123e4567-e89b-12d3-a456-426614174000 and brain_synth_0001 for details";
    expect(redactIds(text)).toBe("see [reference] and [reference] for details");
    expect(containsRawId(text)).toBe(true);
    expect(containsRawId(redactIds(text))).toBe(false);
  });

  it("phrases provenance in plain words per salience", () => {
    expect(
      renderMemoryPlainWords({
        content: "Prefers morning planning",
        salience: "owner_stated",
        createdAt: "2026-11-01T10:00:00Z",
      }),
    ).toBe("You told the Brain: Prefers morning planning. Noted on November 1, 2026.");
    expect(
      renderMemoryPlainWords({
        content: "Prefers morning planning",
        salience: "verified",
        createdAt: "2026-11-01T10:00:00Z",
      }),
    ).toContain("The Brain confirmed");
    expect(
      renderMemoryPlainWords({
        content: "Prefers morning planning",
        salience: "inferred",
        createdAt: "2026-11-01T10:00:00Z",
      }),
    ).toContain("The Brain noted, not yet confirmed");
  });

  it("never renders a raw id, even one pasted into a memory", () => {
    const rendered = renderMemoryPlainWords({
      content: "call 123e4567-e89b-12d3-a456-426614174000 about it",
      salience: "owner_stated",
      createdAt: "2026-11-01T10:00:00Z",
    });
    expect(containsRawId(rendered)).toBe(false);
    expect(rendered).toContain("[reference]");
  });

  it("joins a working set in plain words", () => {
    const text = renderWorkingSetPlainWords([
      { content: "First note", salience: "owner_stated", createdAt: "2026-11-01T10:00:00Z" },
      { content: "Second note", salience: "inferred", createdAt: "2026-11-01T10:00:00Z" },
    ]);
    expect(text).toContain("You told the Brain: First note.");
    expect(text).toContain("The Brain noted, not yet confirmed: Second note.");
  });

  it("formats dates in plain words and handles bad input", () => {
    expect(formatPlainDate("2026-11-01T10:00:00Z")).toBe("November 1, 2026");
    expect(formatPlainDate(null)).toBe("an unknown date");
    expect(formatPlainDate("not-a-date")).toBe("an unknown date");
  });
});
