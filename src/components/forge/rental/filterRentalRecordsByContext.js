export function rentalContextLeaseIds(data, context) {
  if (!context) return null;
  const leases = data.leases || [];
  if (context.recordType === "tenant") return new Set((data.leaseMemberships || []).filter((item) => item.tenant_id === context.recordId).map((item) => item.lease_id));
  if (context.recordType === "unit") return new Set(leases.filter((item) => item.unit_id === context.recordId).map((item) => item.id));
  return new Set();
}

export function filterRentalRecordsByContext(records, data, context) {
  if (!context) return records || [];
  const leaseIds = rentalContextLeaseIds(data, context);
  return (records || []).filter((item) => {
    if (context.recordType === "tenant" && item.tenant_id) return item.tenant_id === context.recordId;
    if (context.recordType === "unit" && item.unit_id) return item.unit_id === context.recordId;
    return item.lease_id ? leaseIds.has(item.lease_id) : false;
  });
}
