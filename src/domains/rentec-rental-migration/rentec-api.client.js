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
  const address = String(row.address || "").trim();
  return String(address || name || `Rentec property ${id}`).slice(0, 100);
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

  async operationalEvidence() {
    const [properties, tenants, leases] = await Promise.all([
      this.get("/properties", { archived: true }),
      this.get("/tenants", { archived: true }),
      this.get("/leases", { start_date: "1900-01-01" }),
    ]);
    return Object.freeze({
      properties: Object.freeze((properties.data || []).map((row) => Object.freeze({
        property_id: String(row.property_id || row.id || ""),
        address: String(row.address || "").slice(0, 100),
        nickname: String(row.nickname || "").slice(0, 100),
        archived: row.archived,
      }))),
      tenants: Object.freeze((tenants.data || []).map((row) => Object.freeze({
        renter_id: String(row.renter_id || row.id || ""),
        email: String(row.email || "").trim().toLowerCase().slice(0, 254),
        f_name: String(row.f_name || "").slice(0, 100),
        l_name: String(row.l_name || "").slice(0, 100),
        company: String(row.company || "").slice(0, 160),
        phone: String(row.phone || "").slice(0, 40),
        mphone: String(row.mphone || "").slice(0, 40),
        archived: row.archived,
      }))),
      leases: Object.freeze((leases.data || []).map((row) => Object.freeze({
        lease_id: String(row.lease_id || row.id || ""),
        property_id: String(row.property_id || ""),
        renter_id: String(row.renter_id || ""),
        lease_begin: String(row.lease_begin || ""),
        lease_end: String(row.lease_end || ""),
        move_in: String(row.move_in || ""),
        move_out: String(row.move_out || ""),
        recurring_rent: Number(row.recurring_rent || 0),
      }))),
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

  // Unlike transactionPage() (which deliberately discards per-row identity behind privacy-preserving
  // fingerprints, for the legacy CSV-reconciliation flow), payment-reconciliation import needs the
  // transaction's own stable identity to match and de-duplicate against — so this method returns real
  // rows, but still only the fields needed for matching. It never returns the raw free-text
  // description/memo/check_num fields, which can carry tenant names or other PII irrelevant to
  // matching a payment to a charge.
  async transactionLedger({ propertyId, page = 1 }) {
    if (!/^\d+$/.test(String(propertyId)) || !Number.isInteger(page) || page < 1) throw new Error("A valid Rentec property and page are required.");
    const payload = await this.get("/transactions", { property_id: propertyId, start_date: "1900-01-01", page });
    const rows = payload.data || [];
    return Object.freeze({
      page: Number(payload.summary?.page || page),
      moreRecords: Boolean(payload.summary?.more_records),
      transactions: Object.freeze(rows.map((row) => Object.freeze({
        transactionId: String(row.transaction_id || row.split_id || ""),
        renterId: row.renter_id ? String(row.renter_id) : null,
        propertyId: String(row.property_id || propertyId),
        amountCents: cents(row.amount),
        transactionDate: String(row.transaction_time || "").slice(0, 10) || null,
        categoryName: String(row.category_name || "").trim(),
      })).filter((row) => row.transactionId)),
    });
  }

  // For the financial-history import specifically. Unlike transactionLedger() (payment matching)
  // and transactionPage() (legacy CSV reconciliation), this needs the six previously-unsupported
  // provenance fields (bank_id, owner_id, vendor_id, check_num, pmt_type, notes) so they can be
  // captured in financial_events.metadata. It still never returns the raw free-text
  // description/memo fields, which can carry tenant names or other PII not needed once a
  // transaction has been matched/classified by category.
  async financialHistoryTransactions({ propertyId, page = 1 }) {
    if (!/^\d+$/.test(String(propertyId)) || !Number.isInteger(page) || page < 1) throw new Error("A valid Rentec property and page are required.");
    const payload = await this.get("/transactions", { property_id: propertyId, start_date: "1900-01-01", page });
    const rows = payload.data || [];
    return Object.freeze({
      page: Number(payload.summary?.page || page),
      moreRecords: Boolean(payload.summary?.more_records),
      transactions: Object.freeze(rows.map((row) => Object.freeze({
        transactionId: row.transaction_id !== undefined && row.transaction_id !== null ? String(row.transaction_id) : null,
        splitId: row.split_id !== undefined && row.split_id !== null && row.split_id !== "" ? String(row.split_id) : null,
        propertyId: String(row.property_id || propertyId),
        renterId: row.renter_id ? String(row.renter_id) : null,
        amountCents: cents(row.amount),
        transactionDate: String(row.transaction_time || "").slice(0, 10) || null,
        categoryId: row.category_id !== undefined && row.category_id !== null ? String(row.category_id) : null,
        categoryName: String(row.category_name || "").trim(),
        bankId: row.bank_id !== undefined && row.bank_id !== null ? String(row.bank_id) : null,
        rentecOwnerId: row.owner_id !== undefined && row.owner_id !== null ? String(row.owner_id) : null,
        vendorId: row.vendor_id !== undefined && row.vendor_id !== null ? String(row.vendor_id) : null,
        checkNum: row.check_num !== undefined && row.check_num !== null && row.check_num !== "" ? String(row.check_num) : null,
        pmtType: row.pmt_type !== undefined && row.pmt_type !== null && row.pmt_type !== "" ? String(row.pmt_type) : null,
        notes: row.notes !== undefined && row.notes !== null && row.notes !== "" ? String(row.notes).slice(0, 500) : null,
      })).filter((row) => row.transactionId)),
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
