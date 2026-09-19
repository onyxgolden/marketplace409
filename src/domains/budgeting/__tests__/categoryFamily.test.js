import { describe, expect, test } from "vitest";
import { categoryFamilyOf } from "../categoryFamily.js";

describe("categoryFamilyOf", () => {
  test("maps children to their family root", () => {
    expect(categoryFamilyOf("dining_drinks_restaurants")).toBe("dining_drinks");
    expect(categoryFamilyOf("dining_drinks_coffee")).toBe("dining_drinks");
    expect(categoryFamilyOf("auto_transport_gas")).toBe("auto_transport");
    expect(categoryFamilyOf("utilities_electric")).toBe("utilities");
    expect(categoryFamilyOf("home_maintenance")).toBe("home");
    expect(categoryFamilyOf("travel_airfare")).toBe("travel");
  });

  test("a root is its own family", () => {
    expect(categoryFamilyOf("dining_drinks")).toBe("dining_drinks");
    expect(categoryFamilyOf("home")).toBe("home");
  });

  test("categories without a known root pass through unchanged", () => {
    expect(categoryFamilyOf("mortgage_payment")).toBe("mortgage_payment");
    expect(categoryFamilyOf("groceries_warehouse")).toBe("groceries");
    expect(categoryFamilyOf("other")).toBe("other");
  });

  test("does not match partial segments", () => {
    // "homestead" starts with "home" but is not a "home_*" child.
    expect(categoryFamilyOf("homestead")).toBe("homestead");
  });

  test("null-safe", () => {
    expect(categoryFamilyOf(null)).toBeNull();
    expect(categoryFamilyOf(undefined)).toBeNull();
    expect(categoryFamilyOf("")).toBeNull();
  });
});
