import { RESERVATION_INVENTORY_TYPES, normalizeReservationInventory } from "./availability";

export const BULK_INVENTORY_HEADERS = Object.freeze([
  "property_name", "unit_name", "space_type", "booking_status", "public_name",
  "maximum_guests", "minimum_nights", "maximum_nights", "turnover_buffer_hours",
  "nightly_rate", "cleaning_fee", "security_deposit", "lodging_tax_percent", "amenities",
]);

const TYPE_ALIASES = Object.freeze({
  "rv site": "rv_site", "rv spot": "rv_site", rv_site: "rv_site", cabin: "cabin",
  "furnished home": "furnished_home", furnished_home: "furnished_home",
  "vacation unit": "vacation_unit", vacation_unit: "vacation_unit",
  "glamping site": "glamping_site", glamping_site: "glamping_site",
  "tent site": "tent_site", tent_site: "tent_site", "parking space": "parking_space",
  parking_space: "parking_space", "storage space": "storage_space", storage_space: "storage_space",
  other: "other",
});

function parseCsv(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Choose a non-empty CSV file.");
  if (text.length > 1_000_000) throw new Error("CSV files are limited to 1 MB.");
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value); rows.push(row); row = []; value = ""; }
    else if (character !== "\r") value += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function cents(value, field, { positive = false } = {}) {
  const normalized = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`${field} must be a dollar amount.`);
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || (positive ? result < 1 : result < 0)) throw new Error(`${field} is invalid.`);
  return result;
}

function integer(value, field, { minimum = 0, optional = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (optional && !normalized) return null;
  if (!/^\d+$/.test(normalized)) throw new Error(`${field} must be a whole number.`);
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error(`${field} must be at least ${minimum}.`);
  return result;
}

function basisPoints(value) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("lodging_tax_percent must be a percentage.");
  const result = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(result) || result < 0 || result > 10000) throw new Error("lodging_tax_percent must be between 0 and 100.");
  return result;
}

function normalizedHeader(value) { return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_"); }
function key(value) { return String(value || "").trim().toLowerCase(); }

export function parseBulkInventoryCsv(csvText, { existingUnits = [] } = {}) {
  const raw = parseCsv(csvText);
  const headers = raw.shift()?.map(normalizedHeader) || [];
  const missing = ["property_name", "unit_name", "space_type", "public_name", "maximum_guests", "minimum_nights", "nightly_rate"]
    .filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);
  if (raw.length > 500) throw new Error("A single import is limited to 500 rows.");
  const existing = new Set(existingUnits.filter((unit) => unit.status !== "inactive").map((unit) => `${key(unit.property_id)}::${key(unit.label)}`));
  const seen = new Set();
  const rows = raw.map((cells, index) => {
    const source = Object.fromEntries(headers.map((header, cellIndex) => [header, String(cells[cellIndex] ?? "").trim()]));
    const errors = []; const rowNumber = index + 2;
    const propertyId = source.property_name; const unitLabel = source.unit_name;
    if (!propertyId) errors.push("property_name is required.");
    if (!unitLabel) errors.push("unit_name is required.");
    const duplicateKey = `${key(propertyId)}::${key(unitLabel)}`;
    if (seen.has(duplicateKey)) errors.push("Duplicate property_name and unit_name in this CSV.");
    else seen.add(duplicateKey);
    if (existing.has(duplicateKey)) errors.push("This property/unit already exists in Rental Manager.");
    const inventoryType = TYPE_ALIASES[key(source.space_type)];
    if (!inventoryType || !RESERVATION_INVENTORY_TYPES.includes(inventoryType)) errors.push("space_type is not supported.");
    if (source.booking_status && !["draft", "active", "paused", "inactive"].includes(source.booking_status)) errors.push("booking_status must be draft, active, paused, or inactive.");
    let inventory = null;
    try {
      inventory = normalizeReservationInventory({
        inventoryType: inventoryType || source.space_type,
        bookingStatus: source.booking_status || "draft",
        publicName: source.public_name,
        publicDescription: source.public_description || null,
        timezone: source.timezone || "America/Chicago",
        maximumGuests: integer(source.maximum_guests, "maximum_guests", { minimum: 1 }),
        minimumNights: integer(source.minimum_nights, "minimum_nights", { minimum: 1 }),
        maximumNights: integer(source.maximum_nights, "maximum_nights", { minimum: 1, optional: true }),
        turnoverBufferHours: integer(source.turnover_buffer_hours || "0", "turnover_buffer_hours"),
        amenities: String(source.amenities || "").split("|").map((item) => item.trim()).filter(Boolean),
        nightlyRateCents: cents(source.nightly_rate, "nightly_rate", { positive: true }),
        cleaningFeeCents: cents(source.cleaning_fee || "0", "cleaning_fee"),
        securityDepositCents: cents(source.security_deposit || "0", "security_deposit"),
        lodgingTaxBasisPoints: basisPoints(source.lodging_tax_percent || "0"),
      });
    } catch (error) { errors.push(error.message); }
    return Object.freeze({ rowNumber, propertyId, unitLabel, inventory, errors: Object.freeze(errors) });
  });
  return Object.freeze({
    rows: Object.freeze(rows), totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
  });
}

export const BULK_INVENTORY_TEMPLATE = `${BULK_INVENTORY_HEADERS.join(",")}\nPine Lake RV Park,Site 01,rv_site,draft,Pine Lake Site 01,6,1,30,24,55.00,10.00,100.00,8.25,50 amp|water|sewer|Wi-Fi\nPine Lake RV Park,Cabin 01,cabin,draft,Pine Lake Cabin 01,4,2,14,24,125.00,45.00,150.00,8.25,kitchen|Wi-Fi|fire pit\n`;
