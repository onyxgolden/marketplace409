const OPEN_STATUSES = new Set(["open", "pending", "submitted", "assigned", "in_progress"]);

function daysBetween(date, today) {
  return Math.ceil((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

export function buildRentalDashboardSummary(data = {}, report = null, today = new Date().toISOString().slice(0, 10)) {
  const units = data.units || [];
  const leases = data.leases || [];
  const activeLeases = leases.filter((lease) => lease.status === "active");
  const occupiedUnitIds = new Set(activeLeases.map((lease) => lease.unit_id).filter(Boolean));
  const expiringLeases = activeLeases.filter((lease) => {
    if (!lease.end_date) return false;
    const remaining = daysBetween(lease.end_date, today);
    return remaining >= 0 && remaining <= 90;
  });
  const openMaintenance = [...(data.maintenanceRequests || []), ...(data.workOrders || [])]
    .filter((item) => OPEN_STATUSES.has(String(item.status || "open").toLowerCase()));
  const unsettledPayments = (data.payments || []).filter((payment) =>
    payment.status === "succeeded" && !payment.settlement_id && !payment.settled_at,
  );
  const verifiedLeaseIds = new Set((data.insurancePolicies || [])
    .filter((policy) => ["verified", "active", "approved"].includes(String(policy.status).toLowerCase()))
    .map((policy) => policy.lease_id).filter(Boolean));
  const missingInsurance = activeLeases.filter((lease) => !verifiedLeaseIds.has(lease.id));
  const depositLeaseIds = new Set((data.deposits || []).map((deposit) => deposit.lease_id).filter(Boolean));
  const missingDeposits = activeLeases.filter((lease) => !depositLeaseIds.has(lease.id));
  const completedMoveInLeaseIds = new Set((data.inspections || [])
    .filter((inspection) => inspection.inspection_type === "move_in" && inspection.status !== "draft")
    .map((inspection) => inspection.lease_id).filter(Boolean));
  const missingMoveInInspections = activeLeases.filter((lease) => !completedMoveInLeaseIds.has(lease.id));
  const openSupportCases = (data.supportCases || []).filter((item) =>
    !["closed", "resolved", "cancelled"].includes(String(item.status).toLowerCase()),
  );

  return Object.freeze({
    vacancies: Math.max(0, units.length - occupiedUnitIds.size),
    expiringLeases: expiringLeases.length,
    overdueBalanceCents: Number(report?.summary?.overdueBalanceCents || 0),
    openMaintenance: openMaintenance.length,
    awaitingSettlement: unsettledPayments.length,
    missingInsurance: missingInsurance.length,
    missingDeposits: missingDeposits.length,
    missingMoveInInspections: missingMoveInInspections.length,
    openSupportCases: openSupportCases.length,
    occupiedUnits: occupiedUnitIds.size,
    totalUnits: units.length,
    monthlyScheduledCents: Number(report?.summary?.monthlyScheduledCents || 0),
    collectedCents: Number(report?.summary?.collectedCents || 0),
  });
}
