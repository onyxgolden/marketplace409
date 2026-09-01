const DAY_MS = 86_400_000;

export const RESERVATION_INVENTORY_TYPES = Object.freeze([
  "rv_site", "cabin", "furnished_home", "vacation_unit", "glamping_site",
  "tent_site", "parking_space", "storage_space", "other",
]);

function parseDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid ISO date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid date.`);
  }
  return date;
}

function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { return new Date(date.getTime() + days * DAY_MS); }

export function normalizeReservationInventory(input) {
  if (!input || typeof input !== "object") throw new Error("Reservation inventory is required.");
  if (!RESERVATION_INVENTORY_TYPES.includes(input.inventoryType)) throw new Error("Inventory type is not supported.");
  const publicName = String(input.publicName || "").trim();
  if (!publicName) throw new Error("Public name is required.");
  const maximumGuests = Number(input.maximumGuests ?? 1);
  const minimumNights = Number(input.minimumNights ?? 1);
  const maximumNights = input.maximumNights === null || input.maximumNights === undefined || input.maximumNights === ""
    ? null : Number(input.maximumNights);
  const turnoverBufferHours = Number(input.turnoverBufferHours ?? 0);
  const nightlyRateCents = Number(input.nightlyRateCents ?? 0);
  const cleaningFeeCents = Number(input.cleaningFeeCents ?? 0);
  const securityDepositCents = Number(input.securityDepositCents ?? 0);
  const lodgingTaxBasisPoints = Number(input.lodgingTaxBasisPoints ?? 0);
  if (!Number.isSafeInteger(maximumGuests) || maximumGuests < 1) throw new Error("Maximum guests must be a positive whole number.");
  if (!Number.isSafeInteger(minimumNights) || minimumNights < 1) throw new Error("Minimum nights must be a positive whole number.");
  if (maximumNights !== null && (!Number.isSafeInteger(maximumNights) || maximumNights < minimumNights)) {
    throw new Error("Maximum nights cannot be less than minimum nights.");
  }
  if (!Number.isSafeInteger(turnoverBufferHours) || turnoverBufferHours < 0 || turnoverBufferHours > 168) {
    throw new Error("Turnover buffer must be between 0 and 168 hours.");
  }
  if (![nightlyRateCents, cleaningFeeCents, securityDepositCents, lodgingTaxBasisPoints].every(Number.isSafeInteger)
    || cleaningFeeCents < 0 || securityDepositCents < 0
    || lodgingTaxBasisPoints < 0 || lodgingTaxBasisPoints > 10000) throw new Error("Reservation pricing is invalid.");
  if (nightlyRateCents < 1) throw new Error("Nightly rate must be a positive number of cents.");
  return Object.freeze({
    unitId: String(input.unitId || "").trim(), inventoryType: input.inventoryType,
    bookingStatus: ["draft", "active", "paused", "inactive"].includes(input.bookingStatus) ? input.bookingStatus : "draft",
    publicName, publicDescription: String(input.publicDescription || "").trim() || null,
    timezone: String(input.timezone || "America/Chicago").trim(), maximumGuests, minimumNights,
    maximumNights, turnoverBufferHours,
    amenities: Object.freeze([...new Set((input.amenities || []).map((item) => String(item).trim()).filter(Boolean))].sort()),
    nightlyRateCents, cleaningFeeCents, securityDepositCents, lodgingTaxBasisPoints,
  });
}

// Date ranges are half-open: a stay [2026-09-01, 2026-09-03) occupies the nights of Sep 1 and Sep 2.
// A configured turnover buffer needs a gap on both sides of a block -- before its check-in as much
// as after its checkout -- since a new stay can butt up against either end of an existing one.
export function buildAvailabilityCalendar({ rangeStart, rangeEnd, blocks = [], turnoverBufferHours = 0 }) {
  const start = parseDate(rangeStart, "rangeStart");
  const end = parseDate(rangeEnd, "rangeEnd");
  if (end <= start) throw new Error("Availability range end must follow its start.");
  const bufferDays = Math.ceil(Number(turnoverBufferHours || 0) / 24);
  const blockedDates = new Map();
  for (const block of blocks) {
    const blockStart = parseDate(block.startDate, "block.startDate");
    const rawEnd = parseDate(block.endDate, "block.endDate");
    if (rawEnd <= blockStart) throw new Error("Calendar block end must follow its start.");
    const bufferedStart = addDays(blockStart, -bufferDays);
    const bufferedEnd = addDays(rawEnd, bufferDays);
    for (let cursor = bufferedStart; cursor < bufferedEnd; cursor = addDays(cursor, 1)) {
      if (cursor >= start && cursor < end) blockedDates.set(iso(cursor), block.blockType || "other");
    }
  }
  const days = [];
  for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
    const date = iso(cursor);
    days.push(Object.freeze({ date, available: !blockedDates.has(date), blockType: blockedDates.get(date) || null }));
  }
  return Object.freeze(days);
}

export function canReserveRange({ checkIn, checkOut, calendar, minimumNights = 1, maximumNights = null }) {
  const start = parseDate(checkIn, "checkIn");
  const end = parseDate(checkOut, "checkOut");
  const nights = Math.round((end - start) / DAY_MS);
  if (nights < minimumNights) return Object.freeze({ allowed: false, reason: "minimum_nights", nights });
  if (maximumNights !== null && nights > maximumNights) return Object.freeze({ allowed: false, reason: "maximum_nights", nights });
  const byDate = new Map(calendar.map((day) => [day.date, day]));
  for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
    const day = byDate.get(iso(cursor));
    if (!day?.available) return Object.freeze({ allowed: false, reason: "unavailable_date", date: iso(cursor), nights });
  }
  return Object.freeze({ allowed: true, reason: null, nights });
}
