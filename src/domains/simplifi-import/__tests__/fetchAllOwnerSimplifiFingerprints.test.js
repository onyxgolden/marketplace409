import { describe, expect, it, vi } from "vitest";
import { fetchAllOwnerSimplifiFingerprints } from "../fetchAllOwnerSimplifiFingerprints";

function fakeDatabase(pages) {
  let call = 0;
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    range: vi.fn(() => {
      const page = pages[call] ?? { data: [], error: null };
      call += 1;
      return Promise.resolve(page);
    }),
  };
  return { from: vi.fn(() => chain), chain, callCount: () => call };
}

describe("fetchAllOwnerSimplifiFingerprints", () => {
  it("returns every fingerprint in a single page when under the page size", async () => {
    const db = fakeDatabase([{ data: [{ source_record_id: "v1:a" }, { source_record_id: "v2:b" }], error: null }]);
    const result = await fetchAllOwnerSimplifiFingerprints(db, "owner_1");
    expect(result).toEqual(["v1:a", "v2:b"]);
    expect(db.callCount()).toBe(1);
  });

  it("pages past PostgREST's default 1000-row cap instead of silently truncating", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ source_record_id: `v2:${i}` }));
    const secondPage = [{ source_record_id: "v2:1000" }, { source_record_id: "v2:1001" }];
    const db = fakeDatabase([
      { data: firstPage, error: null },
      { data: secondPage, error: null },
    ]);
    const result = await fetchAllOwnerSimplifiFingerprints(db, "owner_1");
    expect(result).toHaveLength(1002);
    expect(result[1000]).toBe("v2:1000");
    expect(db.callCount()).toBe(2);
  });

  it("stops as soon as a page comes back short, without an extra empty-page round trip", async () => {
    const db = fakeDatabase([{ data: [{ source_record_id: "v1:a" }], error: null }]);
    await fetchAllOwnerSimplifiFingerprints(db, "owner_1");
    expect(db.callCount()).toBe(1);
  });

  it("filters out null source_record_id values without failing", async () => {
    const db = fakeDatabase([{ data: [{ source_record_id: "v2:a" }, { source_record_id: null }], error: null }]);
    const result = await fetchAllOwnerSimplifiFingerprints(db, "owner_1");
    expect(result).toEqual(["v2:a"]);
  });

  it("throws on a query error instead of silently returning a partial set", async () => {
    const db = fakeDatabase([{ data: null, error: new Error("boom") }]);
    await expect(fetchAllOwnerSimplifiFingerprints(db, "owner_1")).rejects.toThrow("boom");
  });

  it("scopes the query to the owner and the quicken_simplifi_csv source system", async () => {
    const db = fakeDatabase([{ data: [], error: null }]);
    await fetchAllOwnerSimplifiFingerprints(db, "owner_1");
    expect(db.from).toHaveBeenCalledWith("financial_events");
    expect(db.chain.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(db.chain.eq).toHaveBeenCalledWith("source_system", "quicken_simplifi_csv");
  });
});
