import { buildRentecFieldCoverage, RENTEC_ATTACHMENT_CAPABILITIES } from "./rentec-field-coverage.js";
import { createHash } from "node:crypto";
import { buildApiTransactionReconciliationFingerprint } from "./rentec-legacy-reconciliation.preview.js";

const BASE_URL = "https://secure.rentecdirect.com/api/v3";
const cents = (value) => Math.round(Number(value || 0) * 100);
const extension = (filename = "") => {
  const match = String(filename).toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "(none)";
};
const propertyLabel = (row) => {
  const id = String(row.property_id || row.id || "");
  const name = String(row.nickname || "").trim();
  const address = [row.address, row.city, row.state].map((value) => String(value || "").trim()).filter(Boolean).join(", ");
  return String(name || address || `Rentec property ${id}`).slice(0, 100);
};

function fileAssociation(row) {
  if (row.renter_id) return "renter";
  if (row.property_id) return "property";
  if (row.transaction_id || row.split_id) return "transaction";
  if (row.workorder_id) return "work_order";
  if (row.vendor_id) return "vendor";
  if (row.owner_id) return "owner";
  return "unlinked";
}

function fileFingerprint(row) {
  return createHash("sha256").update(JSON.stringify([
    String(row.filename || "").trim().toLowerCase(),
    Math.max(0, Number(row.bytes || 0)),
    String(row.upload_date || ""),
    String(row.last_updated || ""),
  ])).digest("hex");
}

export class RentecApiClient {
  constructor({ apiKey, fetchImpl = fetch, baseUrl = BASE_URL } = {}) {
    if (!apiKey) throw new Error("Rentec API key is not configured.");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async get(path, parameters = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await this.fetchImpl(url, {
      headers: { "X-API-Key": this.apiKey, Accept: "application/json", "User-Agent": "FORGE-Rental-Migration/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Rentec API request failed with HTTP ${response.status}.`);
    return response.json();
  }

  async inventory() {
    const [properties, tenants, leases] = await Promise.all([
      this.get("/properties", { archived: true }),
      this.get("/tenants", { archived: true }),
      this.get("/leases", { start_date: "1900-01-01" }),
    ]);
    const propertyRows = properties.data || [];
    const tenantRows = tenants.data || [];
    const leaseRows = leases.data || [];
    return Object.freeze({
      propertyIds: Object.freeze(propertyRows.map((row) => String(row.property_id || row.id)).filter(Boolean)),
      propertyReferences: Object.freeze(propertyRows.map((row) => Object.freeze({
        id: String(row.property_id || row.id),
        label: propertyLabel(row),
      })).filter((row) => row.id)),
      tenantIds: Object.freeze(tenantRows.map((row) => String(row.renter_id || row.id)).filter(Boolean)),
      leaseIds: Object.freeze(leaseRows.map((row) => String(row.lease_id || row.id)).filter(Boolean)),
      properties: propertyRows.length,
      tenants: tenantRows.length,
      archivedTenants: tenantRows.filter((row) => row.archived === true || row.archived === 1 || row.archived === "1").length,
      leases: leaseRows.length,
      fieldCoverage: buildRentecFieldCoverage({ properties: propertyRows, tenants: tenantRows, leases: leaseRows }),
      attachmentCapabilities: RENTEC_ATTACHMENT_CAPABILITIES,
    });
  }

  async fileInventory({ associationType = "all", associationId = "" } = {}) {
    if (!['all', 'property', 'renter'].includes(associationType)) throw new Error("A supported Rentec file association is required.");
    if (associationType !== "all" && !/^\d+$/.test(String(associationId))) throw new Error("A valid Rentec file association ID is required.");
    const parameters = { age: "50000d" };
    if (associationType === "property") parameters.property_id = associationId;
    if (associationType === "renter") parameters.renter_id = associationId;
    const payload = await this.get("/files", parameters);
    const rows = payload.data || [];
    return Object.freeze({
      query: Object.freeze({ associationType, associationId: associationType === "all" ? "" : String(associationId) }),
      records: rows.length,
      capped: rows.length >= 100,
      files: Object.freeze(rows.map((row) => Object.freeze({
        id: fileFingerprint(row),
        bytes: Math.max(0, Number(row.bytes || 0)),
        extension: extension(row.filename),
        association: fileAssociation(row),
      }))),
    });
  }

  async transactionPage({ propertyId, propertyName = "", page = 1 }) {
    if (!/^\d+$/.test(String(propertyId)) || !Number.isInteger(page) || page < 1) throw new Error("A valid Rentec property and page are required.");
    if (typeof propertyName !== "string" || propertyName.length > 100) throw new Error("A valid Rentec property label is required.");
    const payload = await this.get("/transactions", { property_id: propertyId, start_date: "1900-01-01", page });
    const rows = payload.data || [];
    const byRenter = {};
    let unassigned = 0;
    let totalCents = 0;
    for (const row of rows) {
      totalCents += cents(row.amount);
      const renterId = row.renter_id ? String(row.renter_id) : "";
      if (renterId) byRenter[renterId] = (byRenter[renterId] || 0) + 1;
      else unassigned++;
    }
    return Object.freeze({
      records: rows.length,
      totalCents,
      unassignedTransactions: unassigned,
      renterTransactionCounts: Object.freeze(byRenter),
      page: Number(payload.summary?.page || page),
      moreRecords: Boolean(payload.summary?.more_records),
      startingBalanceCents: cents(payload.summary?.starting_balance),
      endingBalanceCents: cents(payload.summary?.ending_balance),
      fieldCoverage: buildRentecFieldCoverage({ transactions: rows }).transactions,
      reconciliationFingerprints: Object.freeze(rows.map((row) => buildApiTransactionReconciliationFingerprint(row, { propertyName }))),
    });
  }
}

export function createRentecApiClient(options = {}) {
  return new RentecApiClient({ apiKey: process.env.RENTEC_API_KEY, ...options });
}
