import { describe, expect, test } from "vitest";

import { mapBusinessRowToBusiness } from "../business.mapper";

describe("mapBusinessRowToBusiness", () => {
  test("maps a database row into the business domain object", () => {
    const business = mapBusinessRowToBusiness({
      id: "business-1",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      name: "409 Test Business",
      status: "claimed",
      owner_user_id: "user-1",
      category: "Contractor",
      description: "Test description",
      city: "Orange",
      phone: "409-555-1111",
      website_url: "https://example.com",
      facebook_url: "https://facebook.com/example",
      image_url: "https://example.com/image.jpg",
      trust_tags: ["Local", "Verified"],
    });

    expect(business).toEqual({
      id: "business-1",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      name: "409 Test Business",
      status: "claimed",
      owner_user_id: "user-1",
      category: "Contractor",
      description: "Test description",
      address: {
        city: "Orange",
      },
      contact: {
        phone: "409-555-1111",
        website_url: "https://example.com",
        facebook_url: "https://facebook.com/example",
      },
      image_url: "https://example.com/image.jpg",
      trust_tags: ["Local", "Verified"],
    });
  });

  test("defaults missing ownership fields", () => {
    const business = mapBusinessRowToBusiness({
      id: "business-1",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      name: "409 Test Business",
    });

    expect(business.status).toBe("unclaimed");
    expect(business.owner_user_id).toBeNull();
  });
});
