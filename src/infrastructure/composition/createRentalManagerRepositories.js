export async function createRentalManagerRepositories({ storage = "memory", supabaseClient } = {}) {
  if (storage === "supabase") {
    const [{ SupabaseRentalUnitRepository }, { SupabaseRentalTenantRepository }, { SupabaseRentalLeaseRepository },
      { SupabaseRentScheduleRepository }, { SupabaseRentChargeRepository }] = await Promise.all([
      import("../../domains/rental-unit/SupabaseRentalUnitRepository.js"),
      import("../../domains/rental-tenant/SupabaseRentalTenantRepository.js"),
      import("../../domains/rental-lease/SupabaseRentalLeaseRepository.js"),
      import("../../domains/rent-schedule/SupabaseRentScheduleRepository.js"),
      import("../../domains/rent-charge/SupabaseRentChargeRepository.js"),
    ]);
    return Object.freeze({ unitRepository: new SupabaseRentalUnitRepository({ supabaseClient }),
      tenantRepository: new SupabaseRentalTenantRepository({ supabaseClient }),
      leaseRepository: new SupabaseRentalLeaseRepository({ supabaseClient }),
      scheduleRepository: new SupabaseRentScheduleRepository({ supabaseClient }),
      chargeRepository: new SupabaseRentChargeRepository({ supabaseClient }) });
  }
  if (storage === "memory") {
    const [{ InMemoryRentalUnitRepository }, { InMemoryRentalTenantRepository }, { InMemoryRentalLeaseRepository },
      { InMemoryRentScheduleRepository }, { InMemoryRentChargeRepository }] = await Promise.all([
      import("../../domains/rental-unit/in-memory-rental-unit.repository.ts"),
      import("../../domains/rental-tenant/in-memory-rental-tenant.repository.ts"),
      import("../../domains/rental-lease/in-memory-rental-lease.repository.ts"),
      import("../../domains/rent-schedule/rent-schedule.persistence.ts"),
      import("../../domains/rent-charge/rent-charge.persistence.ts"),
    ]);
    return Object.freeze({ unitRepository: new InMemoryRentalUnitRepository(), tenantRepository: new InMemoryRentalTenantRepository(),
      leaseRepository: new InMemoryRentalLeaseRepository(), scheduleRepository: new InMemoryRentScheduleRepository(),
      chargeRepository: new InMemoryRentChargeRepository() });
  }
  throw new Error(`Unsupported Rental Manager repository storage: ${storage}`);
}
