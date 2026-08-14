const normalize = (value) => String(value || "").trim();
const archived = (row) => row.archived === true || row.archived === 1 || row.archived === "1";
const date = (value) => String(value || "").slice(0, 10);
const cents = (value) => Math.round(Number(value || 0) * 100);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function activeLease(row, asOf) {
  const endDate = date(row.lease_end || row.move_out);
  return !endDate || endDate >= asOf;
}

function tenantLabel(row) {
  return [row.f_name, row.l_name].map(normalize).filter(Boolean).join(" ")
    || normalize(row.company)
    || `Rentec renter ${String(row.renter_id || row.id || "")}`;
}

export function sanitizeRentecOwnerInputs(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Owner inputs must be an object.");
  const tenantEmails = {};
  const leaseRentDueDays = {};

  for (const [sourceId, rawEmail] of Object.entries(value.tenantEmails || {})) {
    if (!/^\d+$/.test(sourceId)) throw new Error("A valid Rentec renter ID is required.");
    const email = normalize(rawEmail).toLowerCase();
    if (!emailPattern.test(email) || email.length > 254) throw new Error("A valid renter email is required.");
    tenantEmails[sourceId] = email;
  }
  for (const [sourceId, rawDay] of Object.entries(value.leaseRentDueDays || {})) {
    if (!/^\d+$/.test(sourceId)) throw new Error("A valid Rentec lease ID is required.");
    const day = Number(rawDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error("Rent due day must be a whole number from 1 through 28.");
    leaseRentDueDays[sourceId] = day;
  }
  if (Object.keys(tenantEmails).length > 25 || Object.keys(leaseRentDueDays).length > 100) {
    throw new Error("Too many Rentec owner inputs were supplied.");
  }
  return Object.freeze({
    tenantEmails: Object.freeze(tenantEmails),
    leaseRentDueDays: Object.freeze(leaseRentDueDays),
  });
}

export function buildRentecOwnerInputRequirements({
  rentecProperties = [], rentecTenants = [], rentecLeases = [],
  ownerInputs = {}, asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  const inputs = sanitizeRentecOwnerInputs(ownerInputs);
  const propertyLabels = new Map(rentecProperties.map((row) => [
    String(row.property_id || row.id || ""),
    normalize(row.address) || normalize(row.nickname) || `Rentec property ${String(row.property_id || row.id || "")}`,
  ]));
  const tenantIds = new Set(rentecTenants.filter((row) => !archived(row)).map((row) => String(row.renter_id || row.id || "")));
  const propertyIds = new Set(rentecProperties.filter((row) => !archived(row)).map((row) => String(row.property_id || row.id || "")));
  const requirements = [];

  for (const row of rentecTenants) {
    const sourceId = String(row.renter_id || row.id || "");
    if (!sourceId || archived(row) || normalize(row.email) || inputs.tenantEmails[sourceId]) continue;
    requirements.push(Object.freeze({
      type: "tenant_email",
      sourceId,
      label: tenantLabel(row).slice(0, 160),
      prompt: "Renter email address",
    }));
  }

  for (const row of rentecLeases) {
    if (!activeLease(row, asOf)) continue;
    const sourceId = String(row.lease_id || row.id || "");
    const propertyId = String(row.property_id || "");
    const renterId = String(row.renter_id || "");
    const startDate = date(row.lease_begin || row.move_in);
    const rent = cents(row.recurring_rent);
    if (!sourceId || !startDate || rent <= 0 || !propertyIds.has(propertyId) || !tenantIds.has(renterId)) continue;
    if (inputs.leaseRentDueDays[sourceId]) continue;
    requirements.push(Object.freeze({
      type: "rent_due_day",
      sourceId,
      label: String(propertyLabels.get(propertyId) || `Rentec lease ${sourceId}`).slice(0, 160),
      prompt: "Monthly rent due day (1–28)",
    }));
  }

  return Object.freeze({
    mode: "preview_only",
    canCommit: false,
    requirements: Object.freeze(requirements.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))),
    remaining: Object.freeze({
      tenantEmails: requirements.filter((row) => row.type === "tenant_email").length,
      rentDueDays: requirements.filter((row) => row.type === "rent_due_day").length,
    }),
    warning: "Inputs are validated in memory for this preview and are not saved.",
  });
}
