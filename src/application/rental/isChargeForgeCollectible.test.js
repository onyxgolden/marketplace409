import { describe, expect, it } from "vitest";
import { isChargeForgeCollectible } from "./isChargeForgeCollectible.js";

const charge = { due_date: "2026-08-01" };

describe("isChargeForgeCollectible", () => {
  it("returns false when there is no schedule row at all", () => {
    expect(isChargeForgeCollectible(charge, null, "2026-10-05")).toBe(false);
  });

  it("returns false for an external schedule", () => {
    expect(isChargeForgeCollectible(charge, { collection_mode: "external", forge_cutover_date: null }, "2026-10-05")).toBe(false);
  });

  it("returns false for a forge schedule with no cutover date", () => {
    expect(isChargeForgeCollectible(charge, { collection_mode: "forge", forge_cutover_date: null }, "2026-10-05")).toBe(false);
  });

  it("returns false when the cutover date has not arrived yet as of the report date", () => {
    expect(isChargeForgeCollectible(charge, { collection_mode: "forge", forge_cutover_date: "2099-01-01" }, "2026-10-05")).toBe(false);
  });

  it("returns false when the charge's own due date precedes the schedule's cutover date", () => {
    expect(isChargeForgeCollectible({ due_date: "2026-07-01" }, { collection_mode: "forge", forge_cutover_date: "2026-08-01" }, "2026-10-05")).toBe(false);
  });

  it("returns true for a forge schedule with an arrived cutover date on or before the charge's due date", () => {
    expect(isChargeForgeCollectible(charge, { collection_mode: "forge", forge_cutover_date: "2026-01-01" }, "2026-10-05")).toBe(true);
  });

  it("returns true when the cutover date exactly equals the charge's due date", () => {
    expect(isChargeForgeCollectible(charge, { collection_mode: "forge", forge_cutover_date: "2026-08-01" }, "2026-10-05")).toBe(true);
  });
});
