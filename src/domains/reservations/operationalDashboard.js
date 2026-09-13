const DAY_MS = 86400000;
const ACTIVE_STATUSES = new Set(["confirmed", "checked_in", "checked_out"]);

function date(value) {
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Dashboard dates must be valid ISO dates.");
  return parsed;
}
const iso = value => value.toISOString().slice(0, 10);
const addDays = (value, days) => new Date(value.getTime() + days * DAY_MS);
const overlapDays = (aStart, aEnd, bStart, bEnd) => Math.max(0, (Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / DAY_MS);

export function buildReservationOperationalDashboard({ inventory = [], reservations = [], calendarBlocks = [], today, periodDays = 90 }) {
  if (![30, 90, 365].includes(periodDays)) throw new Error("Dashboard period must be 30, 90, or 365 days.");
  const start = date(today);
  const end = addDays(start, periodDays);
  const activeInventory = inventory.filter(item => item.booking_status === "active");
  const activeUnitIds = new Set(activeInventory.map(item => item.unit_id));
  const relevantReservations = reservations.filter(item => activeUnitIds.has(item.unit_id) && ACTIVE_STATUSES.has(item.status));
  const occupiedTodayIds = new Set(relevantReservations.filter(item => date(item.check_in_date) <= start && date(item.check_out_date) > start).map(item => item.unit_id));
  const blockedTodayIds = new Set(calendarBlocks.filter(item => activeUnitIds.has(item.unit_id) && date(item.start_date) <= start && date(item.end_date) > start).map(item => item.unit_id));
  const blockedOnly = [...blockedTodayIds].filter(id => !occupiedTodayIds.has(id)).length;
  const expectedReservations = relevantReservations.filter(item => date(item.check_in_date) >= start && date(item.check_in_date) < end);
  const arrivalsEnd = addDays(start, 14);
  const upcomingArrivals = relevantReservations.filter(item => date(item.check_in_date) >= start && date(item.check_in_date) < arrivalsEnd).length;
  const upcomingDepartures = relevantReservations.filter(item => date(item.check_out_date) >= start && date(item.check_out_date) < arrivalsEnd).length;

  const occupiedNights = relevantReservations.reduce((sum, item) => sum + overlapDays(date(item.check_in_date), date(item.check_out_date), start, end), 0);
  const capacityNights = activeInventory.length * periodDays;
  const expectedRevenueCents = expectedReservations.reduce((sum, item) => sum + Number(item.total_due_cents || 0), 0);
  const revenueByType = activeInventory.map(item => item.inventory_type).filter((value, index, all) => all.indexOf(value) === index).map(type => ({
    type,
    amountCents: expectedReservations.filter(item => activeInventory.find(unit => unit.unit_id === item.unit_id)?.inventory_type === type).reduce((sum, item) => sum + Number(item.total_due_cents || 0), 0),
  }));

  const months = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor < end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const sliceStart = cursor < start ? start : cursor;
    const sliceEnd = monthEnd > end ? end : monthEnd;
    const days = (sliceEnd - sliceStart) / DAY_MS;
    const nights = relevantReservations.reduce((sum, item) => sum + overlapDays(date(item.check_in_date), date(item.check_out_date), sliceStart, sliceEnd), 0);
    const capacity = activeInventory.length * days;
    months.push({ month: iso(cursor).slice(0, 7), occupiedNights: nights, capacityNights: capacity, occupancyRate: capacity ? nights / capacity : 0 });
    cursor = monthEnd;
  }

  return {
    period: { start: iso(start), endExclusive: iso(end), days: periodDays },
    summary: {
      totalActiveInventory: activeInventory.length,
      occupiedInventory: occupiedTodayIds.size,
      blockedInventory: blockedOnly,
      availableInventory: Math.max(0, activeInventory.length - occupiedTodayIds.size - blockedOnly),
      occupiedNights,
      capacityNights,
      occupancyRate: capacityNights ? occupiedNights / capacityNights : 0,
      expectedRevenueCents,
      collectedRevenueCents: null,
      outstandingRevenueCents: null,
      upcomingArrivals,
      upcomingDepartures,
    },
    occupancyTrend: months,
    revenueByType,
    paymentLinkageAvailable: false,
  };
}
