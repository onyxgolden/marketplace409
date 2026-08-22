export function scopeRentalDataToProperty({units=[],tenants=[],leases=[],memberships=[],charges=[],payments=[],schedules=[]},propertyId=""){
  if(!propertyId)return{units,tenants,leases,memberships,charges,payments,schedules};
  const scopedUnits=units.filter(unit=>unit.property_id===propertyId);
  const unitIds=new Set(scopedUnits.map(unit=>unit.id));
  const scopedLeases=leases.filter(lease=>lease.property_id===propertyId||unitIds.has(lease.unit_id));
  const leaseIds=new Set(scopedLeases.map(lease=>lease.id));
  const scopedMemberships=memberships.filter(membership=>leaseIds.has(membership.lease_id));
  const tenantIds=new Set(scopedMemberships.map(membership=>membership.tenant_id));
  const scopedTenants=tenants.filter(tenant=>tenantIds.has(tenant.id));
  const scopedCharges=charges.filter(charge=>leaseIds.has(charge.lease_id));
  const scopedPayments=payments.filter(payment=>leaseIds.has(payment.lease_id));
  const scopedSchedules=schedules.filter(schedule=>leaseIds.has(schedule.lease_id));
  return{units:scopedUnits,tenants:scopedTenants,leases:scopedLeases,memberships:scopedMemberships,charges:scopedCharges,payments:scopedPayments,schedules:scopedSchedules};
}
