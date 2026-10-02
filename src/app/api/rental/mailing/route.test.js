import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/domains/rental-mailing/letterContext", () => ({ resolveLetterTemplateContext: vi.fn() }));
vi.mock("@/domains/rental-mailing/letterDocuments", () => ({ saveLetterDocumentCopy: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { resolveLetterTemplateContext } from "@/domains/rental-mailing/letterContext";
import { saveLetterDocumentCopy } from "@/domains/rental-mailing/letterDocuments";
import { GET, POST } from "./route";

// The owner/co-owner gate (isOwnerOrActiveCoOwner) runs unmocked and reads the
// mocked workspace_members table: a mutable memberRole fixture drives it.
let memberRole = null;

// Per-table chainable supabase stub.
function makeDb(tables = {}) {
  const calls = { insert: [], update: [] };
  const makeTable = (name) => {
    if (name === "workspace_members") {
      const memberTable = {
        select() { return memberTable; },
        eq() { return memberTable; },
        async maybeSingle() { return { data: memberRole ? { role: memberRole } : null, error: null }; },
      };
      return memberTable;
    }
    const config = tables[name] || {};
    const table = {
      select() { return table; },
      eq() { return table; },
      order() { return table; },
      in() { return table; },
      insert(rows) { calls.insert.push({ table: name, rows }); return table; },
      update(payload) { calls.update.push({ table: name, payload }); return table; },
      async maybeSingle() { return { data: config.oneRow ?? null, error: null }; },
      async single() {
        if (calls.insert.some((call) => call.table === name)) {
          return { data: config.insertedRow ?? config.oneRow ?? null, error: null };
        }
        return { data: config.updatedRow ?? null, error: null };
      },
      // An insert followed by .select() (no .single()) resolves to the
      // inserted rows, matching the real client.
      then(resolve) {
        const wasInsert = calls.insert.some((call) => call.table === name);
        resolve({ data: (wasInsert ? config.insertedRow : null) ?? config.listRows ?? [], error: null });
      },
    };
    return table;
  };
  return { db: { from: vi.fn((name) => makeTable(name)) }, calls };
}

const MAILING_TEMPLATE = {
  id: "tpl_mail", name: "Late rent notice", kind: "mailing", audience: "tenant",
  subject: "Past-due rent — {{property_label}}", body: "Dear {{tenant_name}}, you owe {{balance_due}}.",
};
const EMAIL_TEMPLATE = { ...MAILING_TEMPLATE, id: "tpl_email", kind: "email" };
const TENANTS = [
  { id: "t1", display_name: "Eric Carrillo" },
  { id: "t2", display_name: "Nicole Smith" },
];

const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  memberRole = null; // primary owner: no membership row
  resolveLetterTemplateContext.mockImplementation(async ({ tenantId }) => ({
    fields: {
      tenant_name: tenantId === "t1" ? "Eric Carrillo" : "Nicole Smith",
      tenant_address: "308 Paula\nHouston, TX 77000",
      balance_due: "$1,600.00",
      letter_date: "Oct 1, 2026",
    },
    leaseId: "lease_1",
  }));
  saveLetterDocumentCopy.mockResolvedValue("doc_1");
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("mailing batches collection route", () => {
  it("lists batches with per-status letter counts", async () => {
    const { db } = makeDb({
      rental_mail_batches: { listRows: [{ id: "b1", name: "October", created_at: "2026-10-01T00:00:00Z" }] },
      rental_mail_letters: { listRows: [
        { id: "l1", batch_id: "b1", status: "queued" },
        { id: "l2", batch_id: "b1", status: "mailed" },
        { id: "l3", batch_id: "b1", status: "delivered" },
      ] },
    });
    authAs(db);
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batches).toHaveLength(1);
    expect(body.batches[0].summary).toEqual({ total: 3, queued: 1, mailed: 1, delivered: 1 });
  });

  describe("owner/co-owner authorization", () => {
    // The R20 contract: composing mailings is owner/co-owner only. Staff --
    // manager, bookkeeper, read_only -- cannot create batches.
    const staffRoles = ["manager", "bookkeeper", "read_only"];
    it.each(staffRoles)("blocks %s from composing a batch with 403", async (role) => {
      memberRole = role;
      const { db, calls } = makeDb();
      authAs(db);
      const res = await post({ templateId: "tpl_mail", tenantIds: ["t1"] });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("owner or co-owner");
      expect(calls.insert).toHaveLength(0);
    });
    it("lets an active co_owner compose a batch", async () => {
      memberRole = "co_owner";
      const { db } = makeDb({
        rental_message_templates: { oneRow: MAILING_TEMPLATE },
        rental_tenants: { listRows: [TENANTS[0]] },
        rental_mail_batches: { insertedRow: { id: "b1", name: "October", created_at: "2026-10-01T00:00:00Z" } },
        rental_mail_letters: { insertedRow: [] },
      });
      authAs(db);
      const res = await post({ name: "October", templateId: "tpl_mail", tenantIds: ["t1"] });
      expect(res.status).toBe(201);
    });
  });

  it("400s when no template or no tenants are picked", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await post({})).status).toBe(400);
    expect((await post({ templateId: "tpl_mail", tenantIds: [] })).status).toBe(400);
  });

  it("404s an unknown template", async () => {
    const { db } = makeDb({ rental_message_templates: { oneRow: null } });
    authAs(db);
    const res = await post({ templateId: "nope", tenantIds: ["t1"] });
    expect(res.status).toBe(404);
  });

  it("400s a non-mailing template", async () => {
    const { db } = makeDb({ rental_message_templates: { oneRow: EMAIL_TEMPLATE } });
    authAs(db);
    const res = await post({ templateId: "tpl_email", tenantIds: ["t1"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a mailing template/);
  });

  it("404s unknown tenants", async () => {
    const { db } = makeDb({
      rental_message_templates: { oneRow: MAILING_TEMPLATE },
      rental_tenants: { listRows: [TENANTS[0]] },
    });
    authAs(db);
    const res = await post({ templateId: "tpl_mail", tenantIds: ["t1", "ghost"] });
    expect(res.status).toBe(404);
  });

  it("422s the whole batch when a tenant has no mailing address", async () => {
    const { db } = makeDb({
      rental_message_templates: { oneRow: MAILING_TEMPLATE },
      rental_tenants: { listRows: TENANTS },
    });
    authAs(db);
    resolveLetterTemplateContext.mockResolvedValueOnce({
      fields: { tenant_name: "Eric Carrillo", tenant_address: null },
      leaseId: "lease_1",
    });
    const res = await post({ templateId: "tpl_mail", tenantIds: ["t1"] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Eric Carrillo/);
    expect(db.from).not.toHaveBeenCalledWith("rental_mail_batches");
  });

  it("creates one queued letter per tenant with rendered bodies and document copies", async () => {
    const insertedBatch = { id: "rental_mail_batch_1", name: "October", created_at: "2026-10-01T00:00:00Z" };
    const insertedLetters = TENANTS.map((tenant, i) => ({
      id: `l${i}`, batch_id: "rental_mail_batch_1", template_id: "tpl_mail", tenant_id: tenant.id,
      tenant_name: tenant.display_name, recipient_address: "308 Paula\nHouston, TX 77000",
      return_address: null, subject: "Past-due rent — X", body: `Dear ${tenant.display_name}, you owe $1,600.00.`,
      letter_date: "2026-10-01", status: "queued", tracking_number: null,
      mailed_at: null, delivered_at: null, document_id: null, created_at: "2026-10-01T00:00:00Z",
    }));
    const { db, calls } = makeDb({
      rental_message_templates: { oneRow: MAILING_TEMPLATE },
      rental_tenants: { listRows: TENANTS },
      rental_mail_batches: { insertedRow: insertedBatch },
      rental_mail_letters: { insertedRow: insertedLetters },
    });
    authAs(db);
    const res = await post({ name: "October", templateId: "tpl_mail", tenantIds: ["t1", "t2"] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batch.letters).toHaveLength(2);
    expect(body.batch.letters[0].body).toContain("Eric Carrillo");
    expect(body.batch.letters[0].status).toBe("queued");
    expect(body.note).toMatch(/nothing was sent electronically/i);
    // One letter row per tenant, snapshots rendered (no {{tokens}} left).
    const letterInsert = calls.insert.find((call) => call.table === "rental_mail_letters");
    expect(letterInsert.rows).toHaveLength(2);
    for (const row of letterInsert.rows) {
      expect(row.status).toBe("queued");
      expect(row.body).not.toContain("{{");
    }
    // File-library copy attempted for each letter, then linked.
    expect(saveLetterDocumentCopy).toHaveBeenCalledTimes(2);
    const linkUpdates = calls.update.filter((call) => call.table === "rental_mail_letters");
    expect(linkUpdates).toHaveLength(2);
    expect(linkUpdates[0].payload.document_id).toBe("doc_1");
  });

  it("still succeeds when the file-library copy fails (body snapshot is the paper trail)", async () => {
    const { db } = makeDb({
      rental_message_templates: { oneRow: MAILING_TEMPLATE },
      rental_tenants: { listRows: [TENANTS[0]] },
      rental_mail_batches: { insertedRow: { id: "b1", name: "X", created_at: "2026-10-01T00:00:00Z" } },
      rental_mail_letters: { insertedRow: [{ id: "l1", batch_id: "b1", tenant_id: "t1", tenant_name: "Eric Carrillo", status: "queued", document_id: null, body: "Dear Eric Carrillo, you owe $1,600.00." }] },
    });
    authAs(db);
    saveLetterDocumentCopy.mockResolvedValueOnce(null);
    const res = await post({ templateId: "tpl_mail", tenantIds: ["t1"] });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batch.letters[0].documentId).toBeNull();
  });

  it("applies recipient-address overrides before the address check", async () => {
    const { db } = makeDb({
      rental_message_templates: { oneRow: MAILING_TEMPLATE },
      rental_tenants: { listRows: [TENANTS[0]] },
      rental_mail_batches: { insertedRow: { id: "b1", name: "X", created_at: "2026-10-01T00:00:00Z" } },
      rental_mail_letters: { insertedRow: [{ id: "l1", batch_id: "b1", tenant_id: "t1", tenant_name: "Eric Carrillo", status: "queued", body: "x" }] },
    });
    authAs(db);
    resolveLetterTemplateContext.mockResolvedValueOnce({
      fields: { tenant_name: "Eric Carrillo", tenant_address: null },
      leaseId: "lease_1",
    });
    const res = await post({ templateId: "tpl_mail", tenantIds: ["t1"], recipientAddresses: { t1: "PO Box 9\nHouston, TX" } });
    expect(res.status).toBe(201);
  });

  it("passes auth failures through", async () => {
    const denied = new Response(null, { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ response: denied });
    expect(await GET(new Request("https://t/"))).toBe(denied);
  });
});
