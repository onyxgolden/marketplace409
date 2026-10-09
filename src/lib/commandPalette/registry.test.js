import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCommandPaletteActions,
  filterCommandPaletteActions,
  findCommandPaletteAction,
  fuzzyScore,
  getCommandPaletteActions,
  registerCommandPaletteAction,
  searchCommandPalette,
  unregisterCommandPaletteAction,
} from "./registry";
import { FORGE_COMMAND_SEEDS, seedForgeCommandPalette } from "./forgeCommands";

beforeEach(() => {
  clearCommandPaletteActions();
});

function seed() {
  registerCommandPaletteAction({ id: "record-rent-payment", title: "Record rent payment", group: "Actions", href: "/forge/rental?section=charges" });
  registerCommandPaletteAction({ id: "run-rent-roll", title: "Run rent roll report", keywords: ["rent roll"], group: "Actions", href: "/forge/rental?section=reports" });
  registerCommandPaletteAction({ id: "go-scheduling", title: "Go to Scheduling", group: "Go to", href: "/forge/scheduling" });
}

describe("registerCommandPaletteAction", () => {
  it("registers and lists actions in registration order", () => {
    seed();
    expect(getCommandPaletteActions().map((action) => action.id)).toEqual([
      "record-rent-payment",
      "run-rent-roll",
      "go-scheduling",
    ]);
  });

  it("dedupes by id so import-time registration is idempotent", () => {
    seed();
    seed();
    expect(getCommandPaletteActions()).toHaveLength(3);
  });

  it("rejects actions without an id, title, or target", () => {
    expect(() => registerCommandPaletteAction(null)).toThrow(TypeError);
    expect(() => registerCommandPaletteAction({ title: "No id", href: "/x" })).toThrow(TypeError);
    expect(() => registerCommandPaletteAction({ id: "no-title", href: "/x" })).toThrow(TypeError);
    expect(() => registerCommandPaletteAction({ id: "no-target", title: "No target" })).toThrow(TypeError);
  });

  it("accepts a run() handler instead of an href", () => {
    const action = registerCommandPaletteAction({ id: "custom", title: "Custom", run: () => {} });
    expect(action.run).toBeTypeOf("function");
    expect(action.href).toBeNull();
  });

  it("finds and unregisters by id", () => {
    seed();
    expect(findCommandPaletteAction("go-scheduling")?.title).toBe("Go to Scheduling");
    expect(unregisterCommandPaletteAction("go-scheduling")).toBe(true);
    expect(findCommandPaletteAction("go-scheduling")).toBeNull();
    expect(unregisterCommandPaletteAction("go-scheduling")).toBe(false);
  });

  it("is extensible: a slice can add its own action later and it shows up", () => {
    seed();
    registerCommandPaletteAction({
      id: "call-shield-log-call",
      title: "Log unwanted call",
      keywords: ["call", "spam"],
      group: "Actions",
      href: "/forge/call-shield",
    });
    const titles = searchCommandPalette("spam").map((action) => action.title);
    expect(titles).toContain("Log unwanted call");
  });
});

describe("fuzzyScore", () => {
  it("matches exact and prefix queries", () => {
    expect(fuzzyScore("rent", "Record rent payment")).toBeGreaterThan(0);
    expect(fuzzyScore("Record rent payment", "Record rent payment")).toBeGreaterThan(
      fuzzyScore("rent", "Record rent payment"),
    );
  });

  it("matches out-of-order-free subsequences like rrp", () => {
    expect(fuzzyScore("rrp", "Record rent payment")).toBeGreaterThan(0);
  });

  it("rejects queries that are not subsequences", () => {
    expect(fuzzyScore("zzz", "Record rent payment")).toBe(-1);
    expect(fuzzyScore("rent roll call", "Record rent payment")).toBe(-1);
  });

  it("prefers word-start and consecutive matches", () => {
    // "rent" starts a word in the second title, mid-word in the first.
    expect(fuzzyScore("rent", "Parent portal")).toBeGreaterThan(fuzzyScore("rent", "Apparent total"));
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(fuzzyScore("  RENT ", "Record rent payment")).toBe(fuzzyScore("rent", "Record rent payment"));
  });
});

describe("filterCommandPaletteActions", () => {
  it("returns everything in registration order for a blank query", () => {
    seed();
    expect(filterCommandPaletteActions(getCommandPaletteActions(), "   ").map((a) => a.id)).toEqual([
      "record-rent-payment",
      "run-rent-roll",
      "go-scheduling",
    ]);
  });

  it("narrows to matching actions only", () => {
    seed();
    const ids = filterCommandPaletteActions(getCommandPaletteActions(), "rent roll").map((a) => a.id);
    expect(ids).toEqual(["run-rent-roll"]);
  });

  it("matches against keywords as well as titles", () => {
    seed();
    registerCommandPaletteAction({ id: "go-capture", title: "Go to Capture", keywords: ["screenshot"], group: "Go to", href: "/forge/capture" });
    expect(filterCommandPaletteActions(getCommandPaletteActions(), "screenshot").map((a) => a.id)).toEqual(["go-capture"]);
  });

  it("returns an empty list when nothing matches", () => {
    seed();
    expect(filterCommandPaletteActions(getCommandPaletteActions(), "zzz-nope")).toEqual([]);
  });

  it("ranks title matches ahead of keyword-only matches", () => {
    clearCommandPaletteActions();
    registerCommandPaletteAction({ id: "keyword-only", title: "Something else", keywords: ["rent roll"], group: "Actions", href: "/x" });
    registerCommandPaletteAction({ id: "title-match", title: "Run rent roll report", group: "Actions", href: "/y" });
    const ids = filterCommandPaletteActions(getCommandPaletteActions(), "rent roll").map((a) => a.id);
    expect(ids[0]).toBe("title-match");
  });
});

describe("FORGE_COMMAND_SEEDS (core palette)", () => {
  it("gives Work Packages a discoverable navigation command (D2)", () => {
    const command = FORGE_COMMAND_SEEDS.find((seed) => seed.id === "go-work-packages");
    expect(command).toBeDefined();
    expect(command.title).toBe("Go to Work Packages");
    expect(command.group).toBe("Go to");
    expect(command.href).toBe("/forge/work");
    for (const keyword of ["work packages", "work package", "work", "packages", "project work"]) {
      expect(command.keywords).toContain(keyword);
    }
  });

  it("keeps every core command id unique", () => {
    const ids = FORGE_COMMAND_SEEDS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points each Go to command at a distinct route", () => {
    const navSeeds = FORGE_COMMAND_SEEDS.filter((seed) => seed.group === "Go to");
    const hrefs = navSeeds.map((seed) => seed.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("surfaces Work Packages for the live defect query", () => {
    seedForgeCommandPalette();
    const hits = searchCommandPalette("work packages");
    expect(hits.map((action) => action.id)).toContain("go-work-packages");
    expect(
      hits.find((action) => action.id === "go-work-packages")?.href,
    ).toBe("/forge/work");
  });
});
