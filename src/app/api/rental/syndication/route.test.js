import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET, POST } from "./route";

function makeDb(tables = {}) {
  const db = {
    from: vi.fn((name) => {
      const cfg = tables[name] || {};
      const table = {
        select() { return table; },
        eq() { return table; },
        order() { return table; },
        async maybeSingle() { return { data: cfg.oneRow ?? null, error: null }; },
        then(resolve) { resolve({ data: cfg.listRows || [], error: null }); },
      };
      return table;
    }),
  };
  return { db };
}

const LISTING_ROW = {
  public_slug: "abcDEF123456", title: "Sunny 2-bed", description: "Nice place",
  rent_cents: 160000, beds_display: "2", baths_display: "1", square_feet: 900,
  pet_policy: "Cats OK", available_at: "2026-11-01T00:00:00Z", published_at: "2026-10-01T12:00:00Z",
};

function auth(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    supabaseClient: db, user: { id: "user_1" }, effectiveOwnerId: "owner_1",
  });
}

describe("syndication route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("serves the RSS feed of published listings as XML", async () => {
    const { db } = makeDb({ rental_listings: { listRows: [LISTING_ROW] } });
    auth(db);
    const response = await GET(new Request("https://app.example/api/rental/syndication?format=feed"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await response.text();
    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain("Sunny 2-bed");
    expect(xml).toContain("abcDEF123456");
    expect(xml).toContain("<forge:rent>1600.00</forge:rent>");
  });

  it("returns the copy-paste pack for a listing", async () => {
    const { db } = makeDb({ rental_listings: { oneRow: { ...LISTING_ROW, contact_email: "leasing@example.com", contact_phone: null } } });
    auth(db);
    const response = await GET(new Request("https://app.example/api/rental/syndication?listingId=listing_1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pack.adCopy).toContain("Sunny 2-bed");
    expect(body.pack.adCopy).toContain("$1600.00/mo");
    expect(body.pack.jsonLd["@type"]).toBe("Apartment");
  });

  it("404s the pack for an unknown listing", async () => {
    const { db } = makeDb();
    auth(db);
    const response = await GET(new Request("https://app.example/api/rental/syndication?listingId=nope"));
    expect(response.status).toBe(404);
  });

  it("lists the per-site gate status", async () => {
    const { db } = makeDb();
    auth(db);
    const response = await GET(new Request("https://app.example/api/rental/syndication"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites.every((site) => site.status === "not_connected")).toBe(true);
    expect(body.sites.every((site) => site.posted === false)).toBe(true);
  });

  it("the POST auto-post stub ALWAYS 501s — never a real call", async () => {
    const { db } = makeDb();
    auth(db);
    for (const siteKey of ["zillow", "hotpads", "trulia", "apartments_com", "realtor_com", "facebook_marketplace", "craigslist", "nope"]) {
      const response = await POST(new Request("https://app.example/api/rental/syndication", {
        method: "POST", body: JSON.stringify({ siteKey, listingId: "listing_1" }),
      }));
      const body = await response.json();
      expect(response.status).toBe(501);
      expect(body.status).toBe("not_connected");
      expect(body.posted).toBe(false);
      expect(body.gate).toMatch(/SYNDICATION_GATE/);
    }
  });
});
