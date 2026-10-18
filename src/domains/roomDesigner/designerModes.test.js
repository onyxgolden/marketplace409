import { describe, expect, it } from "vitest";
import {
  DESIGNER_MODE_HOME,
  DESIGNER_MODE_INDUSTRIAL,
  DESIGNER_MODES,
  categoryVisibleInMode,
  designModeOf,
  domainVisibleInMode,
  modeConfig,
  normalizeDesignMode,
  setDesignMode,
} from "./designerModes";
import { createEmptyDesign } from "./designerDocument";

describe("designerModes — normalization", () => {
  it("defaults unknown/missing modes to home", () => {
    expect(normalizeDesignMode(undefined)).toBe("home");
    expect(normalizeDesignMode(null)).toBe("home");
    expect(normalizeDesignMode("nope")).toBe("home");
    expect(normalizeDesignMode("industrial")).toBe("industrial");
    expect(normalizeDesignMode("home")).toBe("home");
  });

  it("reads the mode off a design, defaulting pre-mode documents to home", () => {
    expect(designModeOf(createEmptyDesign())).toBe("home");
    expect(designModeOf({ ...createEmptyDesign(), mode: "industrial" })).toBe("industrial");
    // a document saved before modes existed has no mode field
    const legacy = createEmptyDesign();
    delete legacy.mode;
    expect(designModeOf(legacy)).toBe("home");
    expect(designModeOf(null)).toBe("home");
  });

  it("setDesignMode validates and returns a new document", () => {
    const d = createEmptyDesign();
    const industrial = setDesignMode(d, "industrial");
    expect(industrial.mode).toBe("industrial");
    expect(d.mode).toBe("home"); // no mutation
    expect(setDesignMode(d, "bogus").mode).toBe("home");
  });
});

describe("designerModes — config", () => {
  it("exposes both modes with labels", () => {
    expect(DESIGNER_MODES[DESIGNER_MODE_HOME].label).toBe("Home");
    expect(DESIGNER_MODES[DESIGNER_MODE_INDUSTRIAL].label).toBe("Industrial");
    expect(modeConfig("home").id).toBe("home");
    expect(modeConfig("industrial").id).toBe("industrial");
    expect(modeConfig("bogus").id).toBe("home");
  });

  it("home shows house/rooms categories, industrial shows process/mechanical/structures", () => {
    expect(categoryVisibleInMode("house", "home")).toBe(true);
    expect(categoryVisibleInMode("house-seating", "home")).toBe(true); // wildcard
    expect(categoryVisibleInMode("rooms", "home")).toBe(true);
    expect(categoryVisibleInMode("process", "home")).toBe(false);
    expect(categoryVisibleInMode("mechanical", "home")).toBe(false);
    expect(categoryVisibleInMode("structures", "home")).toBe(false);

    expect(categoryVisibleInMode("process", "industrial")).toBe(true);
    expect(categoryVisibleInMode("mechanical", "industrial")).toBe(true);
    expect(categoryVisibleInMode("structures", "industrial")).toBe(true);
    expect(categoryVisibleInMode("house", "industrial")).toBe(false);
    expect(categoryVisibleInMode("house-kitchen", "industrial")).toBe(false);
    expect(categoryVisibleInMode("rooms", "industrial")).toBe(false);

    // shared plan tools in both modes
    expect(categoryVisibleInMode("plan", "home")).toBe(true);
    expect(categoryVisibleInMode("plan", "industrial")).toBe(true);
  });

  it("home library hides process domains; industrial hides home furniture", () => {
    expect(domainVisibleInMode("furniture", "home")).toBe(true);
    expect(domainVisibleInMode("mepFixtures", "home")).toBe(true);
    expect(domainVisibleInMode("siteOutdoor", "home")).toBe(true);
    expect(domainVisibleInMode("processEquipment", "home")).toBe(false);
    expect(domainVisibleInMode("piping", "home")).toBe(false);

    expect(domainVisibleInMode("processEquipment", "industrial")).toBe(true);
    expect(domainVisibleInMode("piping", "industrial")).toBe(true);
    expect(domainVisibleInMode("furniture", "industrial")).toBe(false);

    // shared context domains in both modes
    expect(domainVisibleInMode("buildingElements", "home")).toBe(true);
    expect(domainVisibleInMode("buildingElements", "industrial")).toBe(true);
    expect(domainVisibleInMode("siteOutdoor", "industrial")).toBe(true);
  });
});
