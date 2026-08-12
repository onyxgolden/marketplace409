import { describe, expect, it, vi } from "vitest";
import { RentalManagerApplication } from "./RentalManagerApplication.js";
function repositories() { return { unitRepository: { save: vi.fn() }, tenantRepository: { save: vi.fn() },
  leaseRepository: { save: vi.fn() }, scheduleRepository: { save: vi.fn() },
  chargeRepository: { generate: vi.fn().mockResolvedValue({ id: "charge_1" }) } }; }
describe("RentalManagerApplication", () => {
  it("composes rental identity, obligation, and charge repositories", async () => {
    const repos = repositories(); const application = new RentalManagerApplication(repos);
    await application.generateMonthlyCharge("schedule_1", "2026-09", "owner_1");
    expect(repos.chargeRepository.generate).toHaveBeenCalledWith("schedule_1", "2026-09", "owner_1");
  });
  it("requires every production boundary", () => {
    expect(() => new RentalManagerApplication({})).toThrow("unitRepository");
  });
});
