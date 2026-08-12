import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRentSchedule, InMemoryRentScheduleRepository, mapRentScheduleRow, mapRentScheduleToRow } from "../../rent-schedule";
import { createRentCharge } from "../rent-charge.types";
import { InMemoryRentChargeRepository, mapRentChargeRow, mapRentChargeToRow } from "../rent-charge.persistence";
const schedule = createRentSchedule({ id: "schedule_1", leaseId: "lease_1", status: "active", amountCents: 125000,
  currencyCode: "USD", dueDay: 1, effectiveStartDate: "2026-09-01", effectiveEndDate: null,
  createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" });
const charge = (id = "charge_1") => createRentCharge({ id, leaseId: "lease_1", scheduleId: "schedule_1", period: "2026-09",
  dueDate: "2026-09-01", amountCents: 125000, paidAmountCents: 0, currencyCode: "USD", status: "due",
  sourceKey: "rent:schedule_1:2026-09", createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z", voidedAt: null, notes: null });
describe("rent persistence", () => {
  it("round trips schedules and charges", () => {
    expect(mapRentScheduleRow(mapRentScheduleToRow(schedule, "owner_1"))).toEqual(schedule);
    expect(mapRentChargeRow(mapRentChargeToRow(charge(), "owner_1"))).toEqual(charge());
  });
  it("isolates repository reads by owner", async () => {
    const schedules = new InMemoryRentScheduleRepository(); const charges = new InMemoryRentChargeRepository();
    await schedules.save(schedule, { ownerId: "owner_1" }); await charges.save(charge(), { ownerId: "owner_1" });
    await expect(schedules.findByLease("lease_1", "owner_2")).resolves.toEqual([]);
    await expect(charges.findByLease("lease_1", "owner_2")).resolves.toEqual([]);
  });
  it("enforces unique source keys per owner", async () => {
    const repository = new InMemoryRentChargeRepository(); await repository.save(charge(), { ownerId: "owner_1" });
    await expect(repository.save(charge("charge_2"), { ownerId: "owner_1" })).rejects.toThrow("source key already exists");
  });
  it("creates forced RLS with owner writes and tenant lease reads", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812000300_create_rent_schedules_and_charges.sql"), "utf8");
    for (const table of ["rent_schedules", "rent_charges"]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
    }
    expect(sql).toContain("unique (owner_id, source_key)");
    expect(sql).toContain("rental_actor_has_lease_access(owner_id, lease_id)");
  });
});
