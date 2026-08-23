const OPEN_STATUSES = new Set(["open", "pending", "submitted", "assigned", "in_progress"]);
const MAINTENANCE_PRIORITY_WEIGHT = { urgent: 3, emergency: 3, high: 2, normal: 1, medium: 1, low: 0 };
const TREND_MONTHS = 6;
const NEEDS_ATTENTION_LIMIT = 6;

function daysBetween(date, today) {
  return Math.ceil((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

function monthKey(dateLike) {
  return String(dateLike || "").slice(0, 7);
}

function paymentDate(payment) {
  return payment.succeeded_at || payment.received_at || payment.created_at || null;
}

function paymentNetCents(payment) {
  return Number(payment.amount_cents || 0) - Number(payment.refunded_amount_cents || 0);
}

// Last TREND_MONTHS calendar months (oldest first, current month last) of real recorded
// collections — never a fabricated forecast or comparison figure.
function buildMonthlyCollectionTrend(payments, today) {
  const succeeded = payments.filter((payment) => payment.status === "succeeded" && paymentDate(payment));
  const months = [];
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  for (let offset = TREND_MONTHS - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const totalsByMonth = new Map(months.map((key) => [key, 0]));
  for (const payment of succeeded) {
    const key = monthKey(paymentDate(payment));
    if (totalsByMonth.has(key)) totalsByMonth.set(key, totalsByMonth.get(key) + paymentNetCents(payment));
  }
  return months.map((key) => Object.freeze({ month: key, collectedCents: totalsByMonth.get(key) }));
}

function buildMaintenanceQueue(openItems, unitById) {
  return [...openItems]
    .sort((a, b) => {
      const weightDiff = (MAINTENANCE_PRIORITY_WEIGHT[String(b.priority).toLowerCase()] ?? 1)
        - (MAINTENANCE_PRIORITY_WEIGHT[String(a.priority).toLowerCase()] ?? 1);
      if (weightDiff !== 0) return weightDiff;
      return Date.parse(a.submitted_at || 0) - Date.parse(b.submitted_at || 0);
    })
    .slice(0, 5)
    .map((item) => Object.freeze({
      id: item.id, title: item.title || "Maintenance request", priority: item.priority || "normal",
      unitLabel: unitById.get(item.unit_id)?.label || null, submittedAt: item.submitted_at || null,
    }));
}

export function buildRentalDashboardSummary(data = {}, report = null, today = new Date().toISOString().slice(0, 10)) {
  const units = data.units || [];
  const leases = data.leases || [];
  const payments = data.payments || [];
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const activeLeases = leases.filter((lease) => lease.status === "active");
  const occupiedUnitIds = new Set(activeLeases.map((lease) => lease.unit_id).filter(Boolean));
  const vacantUnits = units.filter((unit) => !occupiedUnitIds.has(unit.id));
  const expiringLeases = activeLeases.filter((lease) => {
    if (!lease.end_date) return false;
    const remaining = daysBetween(lease.end_date, today);
    return remaining >= 0 && remaining <= 90;
  }).sort((a, b) => Date.parse(a.end_date) - Date.parse(b.end_date));
  const expiringLeasesSoon = expiringLeases.filter((lease) => daysBetween(lease.end_date, today) <= 30);
  const openMaintenanceItems = [...(data.maintenanceRequests || []), ...(data.workOrders || [])]
    .filter((item) => OPEN_STATUSES.has(String(item.status || "open").toLowerCase()));
  const urgentMaintenanceItems = openMaintenanceItems.filter((item) =>
    (MAINTENANCE_PRIORITY_WEIGHT[String(item.priority).toLowerCase()] ?? 1) >= 2,
  );
  const unsettledPayments = payments.filter((payment) =>
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
  const schedules = data.schedules || [];
  const forgeCollectibleScheduleCount = schedules.filter((schedule) => schedule.collection_mode === "forge").length;
  const externallyManagedScheduleCount = schedules.filter((schedule) => schedule.collection_mode === "external").length;
  const billingEnabled = data.billingEnabled === true;

  const collectedThisMonthCents = payments
    .filter((payment) => payment.status === "succeeded" && monthKey(paymentDate(payment)) === today.slice(0, 7))
    .reduce((sum, payment) => sum + paymentNetCents(payment), 0);

  const overdueBalanceCents = Number(report?.summary?.overdueBalanceCents || 0);
  const externallyManagedCents = Number(report?.summary?.externallyManagedCents || 0);
  const externallyManagedChargeCount = Number(report?.summary?.externallyManagedChargeCount || 0);
  const readinessIssueCount = missingInsurance.length + missingDeposits.length + missingMoveInInspections.length;

  const needsAttention = [];
  if (overdueBalanceCents > 0) {
    needsAttention.push(Object.freeze({
      id: "overdue-forge", severity: "critical", score: 300 + Math.min(9, overdueBalanceCents / 1_000_000),
      label: "FORGE-collectible rent is overdue", destination: "charges",
      detail: billingEnabled
        ? `Collect on ${report?.summary ? "the leases already cut over to FORGE" : "affected leases"}.`
        : "Online billing is currently paused, so tenants cannot pay this online until it is resumed.",
      amountCents: overdueBalanceCents,
    }));
  }
  if (urgentMaintenanceItems.length > 0) {
    needsAttention.push(Object.freeze({
      id: "urgent-maintenance", severity: "critical", score: 290,
      label: "Urgent maintenance needs a response", destination: "maintenance",
      detail: `${urgentMaintenanceItems.length} urgent or high-priority request${urgentMaintenanceItems.length === 1 ? "" : "s"} open.`,
      count: urgentMaintenanceItems.length,
    }));
  }
  if (externallyManagedCents > 0) {
    needsAttention.push(Object.freeze({
      id: "externally-managed", severity: "warning", score: 200 + Math.min(9, externallyManagedCents / 1_000_000),
      label: "Externally managed balance needs reconciliation", destination: "rentec-payment-import",
      detail: `${externallyManagedChargeCount} charge${externallyManagedChargeCount === 1 ? "" : "s"} still authoritative in Rentec.`,
      amountCents: externallyManagedCents,
    }));
  }
  if (expiringLeasesSoon.length > 0) {
    needsAttention.push(Object.freeze({
      id: "leases-expiring-soon", severity: "warning", score: 190,
      label: "Leases due within 30 days", destination: "lease-lifecycle",
      // Explicitly frames this as a subset of the 90-day KPI figure so the two windows are never
      // read as duplicating or contradicting each other, even when their counts coincide.
      detail: `${expiringLeasesSoon.length} of ${expiringLeases.length} lease${expiringLeases.length === 1 ? "" : "s"} expiring within 90 days ${expiringLeasesSoon.length === 1 ? "is" : "are"} due in the next 30 — plan renewals or move-outs now.`,
      count: expiringLeasesSoon.length,
    }));
  }
  if (vacantUnits.length > 0) {
    needsAttention.push(Object.freeze({
      id: "vacancies", severity: "warning", score: 180,
      label: "Vacant units", destination: "setup",
      detail: `${vacantUnits.length} unit${vacantUnits.length === 1 ? "" : "s"} without an active lease.`,
      count: vacantUnits.length,
    }));
  }
  if (readinessIssueCount > 0) {
    needsAttention.push(Object.freeze({
      id: "readiness-gaps", severity: "warning", score: 170,
      label: "Lease readiness gaps", destination: "insurance",
      detail: `${readinessIssueCount} gap${readinessIssueCount === 1 ? "" : "s"} across insurance, deposits, and move-in inspections.`,
      count: readinessIssueCount,
    }));
  }
  if (openMaintenanceItems.length > urgentMaintenanceItems.length) {
    const routine = openMaintenanceItems.length - urgentMaintenanceItems.length;
    needsAttention.push(Object.freeze({
      id: "routine-maintenance", severity: "info", score: 100,
      label: "Open maintenance requests", destination: "maintenance",
      detail: `${routine} routine request${routine === 1 ? "" : "s"} in progress.`, count: routine,
    }));
  }
  if (unsettledPayments.length > 0) {
    needsAttention.push(Object.freeze({
      id: "awaiting-settlement", severity: "info", score: 90,
      label: "Payments awaiting settlement", destination: "reconciliation",
      detail: `${unsettledPayments.length} succeeded payment${unsettledPayments.length === 1 ? "" : "s"} not yet settled.`,
      count: unsettledPayments.length,
    }));
  }
  if (openSupportCases.length > 0) {
    needsAttention.push(Object.freeze({
      id: "support-cases", severity: "info", score: 80,
      label: "Open support cases", destination: "support",
      detail: `${openSupportCases.length} case${openSupportCases.length === 1 ? "" : "s"} open.`,
      count: openSupportCases.length,
    }));
  }
  needsAttention.sort((a, b) => b.score - a.score);

  return Object.freeze({
    vacancies: vacantUnits.length,
    // Two genuinely distinct windows, each independently computed from lease.end_date — the
    // 90-day figure drives the headline KPI, the 30-day figure drives urgency ranking in the
    // needs-attention queue. Exposed separately so the UI can always show their true relationship
    // ("X of Y") instead of two numbers that look interchangeable when they happen to coincide.
    expiringLeases: expiringLeases.length,
    expiringLeasesWithin30Days: expiringLeasesSoon.length,
    // FORGE-collectible only — an externally-managed (Rentec-authoritative) charge is a real
    // obligation but must never inflate this figure. See externallyManagedCents below.
    overdueBalanceCents,
    externallyManagedCents,
    externallyManagedChargeCount,
    openMaintenance: openMaintenanceItems.length,
    awaitingSettlement: unsettledPayments.length,
    missingInsurance: missingInsurance.length,
    missingDeposits: missingDeposits.length,
    missingMoveInInspections: missingMoveInInspections.length,
    readinessIssueCount,
    openSupportCases: openSupportCases.length,
    occupiedUnits: occupiedUnitIds.size,
    totalUnits: units.length,
    monthlyScheduledCents: Number(report?.summary?.monthlyScheduledCents || 0),
    collectedCents: Number(report?.summary?.collectedCents || 0),
    collectedThisMonthCents,
    billingEnabled,
    forgeCollectibleScheduleCount,
    externallyManagedScheduleCount,
    monthlyCollectionTrend: buildMonthlyCollectionTrend(payments, today),
    needsAttention: Object.freeze(needsAttention.slice(0, NEEDS_ATTENTION_LIMIT)),
    vacantUnitDetails: Object.freeze(vacantUnits.slice(0, 6).map((unit) => Object.freeze({
      id: unit.id, label: unit.label || unit.id, photoUrl: unit.photo_url || null,
    }))),
    portfolioUnits: Object.freeze(units.slice(0, 8).map((unit) => Object.freeze({
      id: unit.id, label: unit.label || unit.id, photoUrl: unit.photo_url || null, occupied: occupiedUnitIds.has(unit.id),
    }))),
    expiringLeaseDetails: Object.freeze(expiringLeases.slice(0, 5).map((lease) => Object.freeze({
      id: lease.id, unitLabel: unitById.get(lease.unit_id)?.label || lease.unit_id || "Unit",
      endDate: lease.end_date, daysRemaining: daysBetween(lease.end_date, today),
    }))),
    maintenanceQueue: Object.freeze(buildMaintenanceQueue(openMaintenanceItems, unitById)),
  });
}
