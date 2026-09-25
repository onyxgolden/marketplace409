import { describe, expect, it } from "vitest";
import {
  LABEL_OFFENDER,
  LABEL_PERSONAL,
  OFFENDER_SYMBOL_DEFAULT,
  applyLabelFilter,
  fetchAllLabels,
  isValidLabel,
  labelForNumber,
  sanitizeSymbol,
} from "./callShieldLabels";

const labels = [
  { normalized_phone: "7132399946", label: "personal", symbol: "⚠" },
  { normalized_phone: "5551234567", label: "offender", symbol: "🚫" },
];

describe("contact labels", () => {
  it("accepts only personal/offender labels", () => {
    expect(isValidLabel("personal")).toBe(true);
    expect(isValidLabel("offender")).toBe(true);
    expect(isValidLabel("friend")).toBe(false);
    expect(isValidLabel("")).toBe(false);
  });

  it("sanitizes the offender symbol", () => {
    expect(sanitizeSymbol("🚫")).toBe("🚫");
    expect(sanitizeSymbol("   ")).toBe(OFFENDER_SYMBOL_DEFAULT);
    expect(sanitizeSymbol(null)).toBe(OFFENDER_SYMBOL_DEFAULT);
    expect(sanitizeSymbol("toolongsymbol!!")).toBe("toolongs");
  });

  it("matches numbers regardless of formatting", () => {
    expect(labelForNumber(labels, "(713) 239-9946")?.label).toBe(LABEL_PERSONAL);
    expect(labelForNumber(labels, "+1 (713) 239-9946")?.label).toBe(LABEL_PERSONAL);
    expect(labelForNumber(labels, "+1 555-123-4567")?.label).toBe(LABEL_OFFENDER);
    expect(labelForNumber(labels, "9990001111")).toBeNull();
    expect(labelForNumber(null, "9990001111")).toBeNull();
  });

  it("filters staged rows by label", () => {
    const rows = [
      { phone_number: "(713) 239-9946" },
      { phone_number: "5551234567" },
      { phone_number: "9990001111" },
    ];
    expect(applyLabelFilter(rows, labels, "all")).toHaveLength(3);
    expect(applyLabelFilter(rows, labels, "personal")).toHaveLength(1);
    expect(applyLabelFilter(rows, labels, "offender")).toHaveLength(1);
    expect(applyLabelFilter(rows, labels, "unlabeled")).toHaveLength(1);
    expect(applyLabelFilter(rows, labels, "bogus")).toHaveLength(3);
  });
});

describe("fetchAllLabels", () => {
  // Regression: the old GET capped at 500 rows and the client treated the
  // single page as the complete set, so labels past 500 silently vanished
  // from classification. fetchAllLabels must page through the full set.
  it("pages through more than 500 labels until the total is covered", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({
      id: `l${i}`,
      normalized_phone: `555${String(1000000 + i)}`,
      label: i % 2 ? "personal" : "offender",
    }));
    const requested = [];
    const apiFn = async (path) => {
      requested.push(path);
      const url = new URL(path, "https://test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("pageSize"));
      const start = (page - 1) * pageSize;
      const items = all.slice(start, start + pageSize);
      return { success: true, items, page, pageSize, total: all.length };
    };

    const items = await fetchAllLabels(apiFn);
    expect(items).toHaveLength(1200);
    expect(items[599].id).toBe("l599");
    expect(items[1199].id).toBe("l1199");
    expect(requested).toEqual([
      "/api/call-shield/labels?page=1&pageSize=500",
      "/api/call-shield/labels?page=2&pageSize=500",
      "/api/call-shield/labels?page=3&pageSize=500",
    ]);
  });

  it("stops early on a short final page when total is missing", async () => {
    const apiFn = async (path) => {
      const page = Number(new URL(path, "https://test").searchParams.get("page"));
      return { success: true, items: page === 1 ? [{ id: "a" }, { id: "b" }] : [] };
    };
    const items = await fetchAllLabels(apiFn, 500);
    expect(items).toHaveLength(2);
  });

  it("classifies a row whose label sits past position 500", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      normalized_phone: `555${String(1000000 + i)}`,
      label: "personal",
    }));
    many[599] = { normalized_phone: "7132399946", label: "offender", symbol: "🚫" };
    const rows = [{ phone_number: "(713) 239-9946" }];
    expect(applyLabelFilter(rows, many, "offender")).toHaveLength(1);
    expect(labelForNumber(many, "7132399946")?.symbol).toBe("🚫");
  });
});
