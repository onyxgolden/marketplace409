import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createPublicListingClient", () => ({ createPublicListingClient: vi.fn() }));
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";
import { GET } from "./photo/route";

const SLUG = "abcDEF123456";

function makeDb({ listing = null, download = null } = {}) {
  return {
    from: () => ({
      select() { return this; },
      eq() { return this; },
      async maybeSingle() { return { data: listing, error: null }; },
    }),
    storage: { from: () => ({ download: async () => download }) },
  };
}

const getPhoto = (slug, path) => GET(
  new Request(`https://t/?path=${encodeURIComponent(path)}`),
  { params: Promise.resolve({ slug }) },
);

describe("public listing photo route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("404s a malformed slug", async () => {
    createPublicListingClient.mockReturnValue(makeDb());
    expect((await getPhoto("nope", "x.jpg")).status).toBe(404);
  });

  it("404s when the requested path is not one of the listing's photos", async () => {
    const db = makeDb({ listing: { id: "listing_1", owner_id: "owner_1", photos: [{ bucket: "rental-photos", path: "o/a.jpg" }] } });
    createPublicListingClient.mockReturnValue(db);
    expect((await getPhoto(SLUG, "../../etc/passwd")).status).toBe(404);
    expect((await getPhoto(SLUG, "o/other.jpg")).status).toBe(404);
  });

  it("streams the listing's own photo", async () => {
    const blob = new Blob(["img"], { type: "image/jpeg" });
    const db = makeDb({
      listing: { id: "listing_1", owner_id: "owner_1", photos: [{ bucket: "rental-photos", path: "o/a.jpg" }] },
      download: { data: blob, error: null },
    });
    createPublicListingClient.mockReturnValue(db);
    const response = await getPhoto(SLUG, "o/a.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });
});
