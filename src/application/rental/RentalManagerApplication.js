export class RentalManagerApplication {
  constructor({ unitRepository, tenantRepository, leaseRepository, scheduleRepository, chargeRepository }) {
    for (const [name, value] of Object.entries({ unitRepository, tenantRepository, leaseRepository, scheduleRepository, chargeRepository })) {
      if (!value) throw new Error(`RentalManagerApplication requires ${name}.`);
    }
    this.units = unitRepository;
    this.tenants = tenantRepository;
    this.leases = leaseRepository;
    this.schedules = scheduleRepository;
    this.charges = chargeRepository;
  }
  async saveUnit(unit, ownerId) { return this.units.save(unit, { ownerId }); }
  async findUnitsByProperty(propertyId, ownerId) { return this.units.findByProperty(propertyId, ownerId); }
  async saveTenant(tenant, ownerId) { return this.tenants.save(tenant, { ownerId }); }
  async saveLease(lease, ownerId) { return this.leases.save(lease, { ownerId }); }
  async saveSchedule(schedule, ownerId) { return this.schedules.save(schedule, { ownerId }); }
  async generateMonthlyCharge(scheduleId, period, ownerId) {
    if (typeof this.charges.generate !== "function") throw new Error("Rental charge repository does not support atomic generation.");
    return this.charges.generate(scheduleId, period, ownerId);
  }
}
