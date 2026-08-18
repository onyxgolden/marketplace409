import { describe, expect, it } from "vitest";
import { HELP_SECTIONS, HELP_SHORTCUTS } from "./schedulingHelpContent";

describe("schedulingHelpContent", () => {
  it("gives every shortcut a label and a description", () => {
    expect(HELP_SHORTCUTS.length).toBeGreaterThan(0);
    for (const shortcut of HELP_SHORTCUTS) {
      expect(shortcut.label.length).toBeGreaterThan(0);
      expect(shortcut.description.length).toBeGreaterThan(0);
    }
  });

  it("gives every section a title and at least one item, each with a label and description", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThan(0);
    for (const section of HELP_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate section titles", () => {
    const titles = HELP_SECTIONS.map((section) => section.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
