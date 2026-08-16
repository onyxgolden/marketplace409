// Never import the fake "Business Expenses" property — see the owner's memory
// notes: it's an LLC-expense-tracking workaround inside Rentec, not a real rental.
const SKIPPED_PROPERTY_LABELS = new Set(["business expenses"]);
const GENERATIONAL_SUFFIXES = new Set(["ii", "iii", "iv", "jr", "sr"]);

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') { value += '"'; index += 1; } else { quoted = false; }
      } else { value += character; }
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { row.push(value); value = ""; continue; }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(value); rows.push(row); row = []; value = "";
      continue;
    }
    value += character;
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
}

function slugifyPropertyLabel(label) {
  return String(label).trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function parseMoneyToCents(raw) {
  const cleaned = String(raw ?? "").replace(/[,$]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function parseDateToIso(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "" || trimmed.toUpperCase() === "N/A") return null;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function stripGenerationalSuffix(nameToken) {
  return GENERATIONAL_SUFFIXES.has(nameToken.toLowerCase()) ? "" : nameToken;
}

function normalizeForComparison(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

// "Johnson, James & Cheryl" -> [{ full: "James Johnson" }, { full: "Cheryl Johnson" }]
// "Riley II, Leonard" -> [{ full: "Leonard Riley II" }, generational-suffix-stripped variant too
function splitTenantLabelIntoNameCandidates(tenantLabel) {
  const commaIndex = tenantLabel.indexOf(",");
  if (commaIndex === -1) return [{ variants: [normalizeForComparison(tenantLabel)] }];
  const surname = tenantLabel.slice(0, commaIndex).trim();
  const strippedSurname = surname.split(/\s+/).filter((token) => !GENERATIONAL_SUFFIXES.has(token.toLowerCase())).join(" ");
  const firsts = tenantLabel.slice(commaIndex + 1).split("&").map((part) => part.trim()).filter(Boolean);
  return firsts.map((first) => ({
    variants: [
      normalizeForComparison(`${first} ${surname}`),
      normalizeForComparison(`${surname}, ${first}`),
      normalizeForComparison(`${surname} ${first}`),
      normalizeForComparison(`${first} ${strippedSurname}`),
    ].filter((variant, index, all) => all.indexOf(variant) === index),
  }));
}

function matchTenantsForLabel(tenantLabel, tenants) {
  const candidates = splitTenantLabelIntoNameCandidates(tenantLabel);
  const matched = [];
  for (const candidate of candidates) {
    const found = tenants.find((tenant) => candidate.variants.includes(normalizeForComparison(tenant.display_name)));
    if (found && !matched.some((item) => item.id === found.id)) matched.push(found);
  }
  return matched;
}

export function buildRentRollImportPlan(csvText, { units = [], tenants = [], leases = [] } = {}) {
  const csvRows = parseCsvRows(csvText);
  const dataRows = csvRows.slice(1).filter((cells) => {
    const property = String(cells[0] ?? "").trim().toLowerCase();
    return property !== "" && property !== "total";
  });

  const unitBySlug = new Map(units.map((unit) => [unit.property_id, unit]));

  const rows = dataRows.map((cells) => {
    const propertyLabel = String(cells[0] ?? "").trim();
    const tenantLabel = String(cells[1] ?? "").trim();
    const propertySlug = slugifyPropertyLabel(propertyLabel);
    const issues = [];

    if (SKIPPED_PROPERTY_LABELS.has(propertyLabel.toLowerCase())) {
      return Object.freeze({ propertyLabel, tenantLabel, action: "skip", reason: "Not a real rental property.", issues: Object.freeze([]) });
    }
    if (tenantLabel.toLowerCase() === "vacant") {
      return Object.freeze({ propertyLabel, tenantLabel, action: "skip", reason: "Vacant in the rent roll.", issues: Object.freeze([]) });
    }

    const unit = unitBySlug.get(propertySlug);
    if (!unit) {
      return Object.freeze({ propertyLabel, tenantLabel, action: "unmatched", reason: `No saved unit matches property "${propertyLabel}" (expected id "${propertySlug}").`, issues: Object.freeze([]) });
    }

    const matchedTenants = matchTenantsForLabel(tenantLabel, tenants);
    if (matchedTenants.length === 0) {
      return Object.freeze({ propertyLabel, tenantLabel, action: "unmatched", reason: `No saved tenant matches "${tenantLabel}".`, issues: Object.freeze([]) });
    }

    const startDate = parseDateToIso(cells[2]);
    const endDate = parseDateToIso(cells[3]);
    const depositCents = parseMoneyToCents(cells[4]);
    const rentCents = parseMoneyToCents(cells[5]);
    const tenantIds = Object.freeze(matchedTenants.map((tenant) => tenant.id));

    if (rentCents === null || rentCents <= 0) {
      return Object.freeze({ propertyLabel, tenantLabel, action: "unmatched", reason: "No valid rent amount in the CSV.", issues: Object.freeze([]) });
    }

    const existingLease = leases.find((lease) => lease.unit_id === unit.id && lease.status !== "ended" && lease.status !== "cancelled" && lease.status !== "terminated");

    if (existingLease) {
      if (!depositCents) {
        return Object.freeze({ propertyLabel, tenantLabel, action: "skip", reason: "Lease already on file and no deposit amount to record.", issues: Object.freeze([]) });
      }
      return Object.freeze({
        propertyLabel, tenantLabel, action: "add-deposit", unitId: unit.id, propertyId: unit.property_id,
        existingLeaseId: existingLease.id, primaryTenantId: tenantIds[0], depositCents,
        depositDate: startDate || existingLease.start_date, issues: Object.freeze(issues),
      });
    }

    if (!startDate) issues.push("No lease start date in the rent roll — defaulted to today; edit before activating if you know the real date.");
    issues.push("Rent due day defaulted to 1 — edit after import if this tenant's rent is actually due on a different day.");

    const resolvedStartDate = startDate || new Date().toISOString().slice(0, 10);
    return Object.freeze({
      propertyLabel, tenantLabel, action: "new-lease", unitId: unit.id, propertyId: unit.property_id, tenantIds,
      startDate: resolvedStartDate, endDate, monthlyRentCents: rentCents,
      depositCents: depositCents || null, depositDate: resolvedStartDate, issues: Object.freeze(issues),
    });
  });

  return Object.freeze({ rows: Object.freeze(rows) });
}
