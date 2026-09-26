import {
  describe,
  expect,
  it,
} from "vitest";

import {
  FINANCIAL_HEADLINE_DEEP_LINK,
  FINANCIAL_KPI_CARD_IDS,
  FINANCIAL_KPI_DEEP_LINKS,
  FINANCIAL_SECTION_CARD_IDS,
  createLayout,
  hiddenIds,
  isDefaultLayout,
  isSharedLayoutKey,
  layoutStorageKey,
  moveCardId,
  normalizeLayout,
  visibleIds,
} from "../dashboardCardLayout.js";

const IDS = ["a", "b", "c", "d"];

describe("dashboardCardLayout", () => {
  describe("createLayout", () => {
    it("starts in registry order with nothing hidden", () => {
      expect(createLayout(IDS)).toEqual({
        order: ["a", "b", "c", "d"],
        hidden: [],
      });
    });
  });

  describe("normalizeLayout", () => {
    it("drops unknown ids and appends newly registered cards", () => {
      const normalized = normalizeLayout(
        { order: ["b", "zzz", "a", "b"], hidden: ["a", "nope"] },
        IDS,
      );
      expect(normalized).toEqual({
        order: ["b", "a", "c", "d"],
        hidden: ["a"],
      });
    });

    it("returns defaults for malformed stored payloads", () => {
      expect(normalizeLayout(null, IDS)).toEqual(createLayout(IDS));
      expect(normalizeLayout("garbage", IDS)).toEqual(createLayout(IDS));
      expect(normalizeLayout({ order: "nope" }, IDS)).toEqual(createLayout(IDS));
    });
  });

  describe("moveCardId", () => {
    it("moves a card up by swapping with the previous visible neighbor", () => {
      expect(moveCardId(["a", "b", "c"], [], "c", -1)).toEqual(["a", "c", "b"]);
    });

    it("moves a card down by swapping with the next visible neighbor", () => {
      expect(moveCardId(["a", "b", "c"], [], "a", 1)).toEqual(["b", "a", "c"]);
    });

    it("skips hidden cards when moving", () => {
      // b is hidden: moving c up swaps it with a, the nearest visible card.
      expect(moveCardId(["a", "b", "c"], ["b"], "c", -1)).toEqual(["c", "b", "a"]);
    });

    it("refuses to move past the visible ends or unknown ids", () => {
      expect(moveCardId(["a", "b"], [], "a", -1)).toEqual(["a", "b"]);
      expect(moveCardId(["a", "b"], [], "b", 1)).toEqual(["a", "b"]);
      expect(moveCardId(["a", "b"], [], "zzz", 1)).toEqual(["a", "b"]);
    });
  });

  describe("visibleIds / hiddenIds", () => {
    it("splits the order on the hidden set", () => {
      const layout = { order: ["a", "b", "c"], hidden: ["b"] };
      expect(visibleIds(layout)).toEqual(["a", "c"]);
      expect(hiddenIds(layout)).toEqual(["b"]);
    });
  });

  describe("isDefaultLayout", () => {
    it("detects reordered or hidden layouts as customized", () => {
      expect(isDefaultLayout(createLayout(IDS), IDS)).toBe(true);
      expect(
        isDefaultLayout({ order: ["b", "a", "c", "d"], hidden: [] }, IDS),
      ).toBe(false);
      expect(
        isDefaultLayout({ order: [...IDS], hidden: ["a"] }, IDS),
      ).toBe(false);
    });
  });

  describe("layoutStorageKey", () => {
    it("scopes the key per user with a shared fallback", () => {
      expect(layoutStorageKey("user-123")).toBe(
        "forge.financial.dashboard.layout.v1.user-123",
      );
      expect(layoutStorageKey(null)).toBe(
        "forge.financial.dashboard.layout.v1.shared",
      );
    });
  });

  describe("isSharedLayoutKey", () => {
    it("identifies the pre-identity fallback key as shared", () => {
      expect(isSharedLayoutKey(layoutStorageKey(null))).toBe(true);
      expect(isSharedLayoutKey("forge.financial.dashboard.layout.v1.shared")).toBe(true);
    });

    it("treats user-scoped and missing keys as persistable", () => {
      expect(isSharedLayoutKey(layoutStorageKey("user-123"))).toBe(false);
      expect(isSharedLayoutKey(null)).toBe(false);
      expect(isSharedLayoutKey(undefined)).toBe(false);
    });
  });

  describe("registries", () => {
    it("registers the four KPI cards and nine overview sections", () => {
      expect(FINANCIAL_KPI_CARD_IDS).toEqual(["equity", "cash", "profit", "margin"]);
      expect(FINANCIAL_SECTION_CARD_IDS).toEqual([
        "activity",
        "intelligence",
        "position",
        "compare",
        "ask-books",
        "brain-actions",
        "anomalies",
        "cash-forecast",
        "debt-payoff",
      ]);
    });

    it("deep-links every KPI number to its detail section", () => {
      expect(FINANCIAL_KPI_DEEP_LINKS).toEqual({
        equity: "#financial-position-snapshot",
        cash: "#cash-forecast",
        profit: "#financial-forge-overview",
        margin: "#month-comparison",
      });
      // Every registered KPI card has a link; the headline links too.
      for (const id of FINANCIAL_KPI_CARD_IDS) {
        expect(FINANCIAL_KPI_DEEP_LINKS[id]).toMatch(/^#/);
      }
      expect(FINANCIAL_HEADLINE_DEEP_LINK).toBe("#cash-forecast");
    });
  });
});
